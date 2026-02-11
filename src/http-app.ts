import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { validator } from "hono/validator";
import { cors } from "hono/cors";
import type { HttpBindings } from "@hono/node-server";
import { RESPONSE_ALREADY_SENT } from "@hono/node-server/utils/response";
import { z } from "zod";
import { Logger } from "./core/Logger.js";
import type { OAuthManager } from "./core/OAuthManager.js";
import type { AuditEvent, AuditRiskTier } from "./gateway/audit-log.js";
import type {
    DiscordOperation,
    DomainMethod,
} from "./gateway/domain-registry.js";
import type { IdentityMode } from "./identity/local-encrypted-identity-store.js";
import {
    recordDiscordOperationMetric,
    recordRequestMetric,
    withSpan,
} from "./observability/telemetry.js";

const JsonRpcHttpMessageSchema = z.object({
    id: z.unknown().optional(),
    method: z.string().optional(),
    params: z
        .object({
            name: z.unknown().optional(),
            arguments: z.unknown().optional(),
        })
        .optional(),
});

const OAuthStartQuerySchema = z.object({
    guildId: z.string().optional(),
    disableGuildSelect: z
        .enum(["true", "false", "1", "0", "yes", "no"])
        .optional(),
});

const OAuthCallbackQuerySchema = z.object({
    code: z.string().min(1),
    state: z.string().min(1),
});

const logger = Logger.getInstance().child("http");

const jsonRpcBodyValidator = validator("json", (value, c) => {
    const parsed = JsonRpcHttpMessageSchema.safeParse(value);
    if (!parsed.success) {
        return c.json(
            {
                jsonrpc: "2.0",
                id: null,
                error: {
                    code: -32700,
                    message: "Parse error",
                },
            },
            400,
        );
    }
    return parsed.data;
});

const oauthStartQueryValidator = validator("query", (value, c) => {
    const parsed = OAuthStartQuerySchema.safeParse(value);
    if (!parsed.success) {
        return c.json({ error: "Invalid query parameters" }, 400);
    }
    return parsed.data;
});

const oauthCallbackQueryValidator = validator("query", (value, c) => {
    const parsed = OAuthCallbackQuerySchema.safeParse(value);
    if (!parsed.success) {
        return c.json(
            {
                error:
                    "OAuth callback requires code and state query parameters",
            },
            400,
        );
    }
    return parsed.data;
});

export type ParsedDiscordManageCallLike = {
    mode: IdentityMode;
    identityId: string;
    method: DomainMethod;
    operation: DiscordOperation;
    params: Record<string, unknown>;
    riskTier: AuditRiskTier;
    compatTranslated: boolean;
    translatedFromOperation?: string;
    legacyOperation?: string;
    legacyAutoRewriteApplied: boolean;
    legacyRewriteCount?: number;
    legacyMigrationSuggestedOperation?: DiscordOperation;
    legacyMigrationSuggestedParams?: Record<string, unknown>;
};

type LegacyMigrationErrorLike = {
    payload: {
        error: {
            code: "LEGACY_OPERATION_REMOVED";
            message: string;
            legacyOperation: string;
            rewriteCount: number;
            suggested: {
                operation: DiscordOperation;
                params: Record<string, unknown>;
            };
            docsRef: string;
        };
    };
    auditContext: {
        identityId: string;
        mode: IdentityMode;
        method: DomainMethod;
        operation: DiscordOperation;
        riskTier: AuditRiskTier;
    };
};

function asLegacyMigrationError(error: unknown): LegacyMigrationErrorLike | null {
    if (!error || typeof error !== "object") {
        return null;
    }

    const candidate = error as Partial<LegacyMigrationErrorLike>;
    if (
        !candidate.payload ||
        !candidate.auditContext ||
        typeof candidate.payload !== "object" ||
        typeof candidate.auditContext !== "object"
    ) {
        return null;
    }

    const payloadError = (candidate.payload as { error?: unknown }).error;
    if (!payloadError || typeof payloadError !== "object") {
        return null;
    }

    const errorRecord = payloadError as Record<string, unknown>;
    if (errorRecord.code !== "LEGACY_OPERATION_REMOVED") {
        return null;
    }

    return candidate as LegacyMigrationErrorLike;
}

type IdentityWorkerPoolLike = {
    run<T>(
        identityId: string,
        task: () => Promise<T>,
    ): Promise<T>;
};

type HttpAppDependencies = {
    port: number;
    server: Server;
    identityWorkerPool: IdentityWorkerPoolLike;
    parseDiscordManageCall: (
        name: unknown,
        rawArgs: unknown,
    ) => ParsedDiscordManageCallLike;
    ensureIdentityForCall: (
        mode: IdentityMode,
        identityId: string,
    ) => Promise<void>;
    executeDiscordManageOperation: (
        parsedCall: ParsedDiscordManageCallLike,
    ) => Promise<string>;
    writeAuditEvent: (event: AuditEvent) => void;
    getOAuthManager: () => OAuthManager;
    parseBooleanQuery: (value: string | null) => boolean | undefined;
    getAllTools: () => unknown[];
};

export function createHttpApp(deps: HttpAppDependencies) {
    const {
        port,
        server,
        identityWorkerPool,
        parseDiscordManageCall,
        ensureIdentityForCall,
        executeDiscordManageOperation,
        writeAuditEvent,
        getOAuthManager,
        parseBooleanQuery,
        getAllTools,
    } = deps;

    const activeTransports = new Map<string, SSEServerTransport>();
    const app = new Hono<{ Bindings: HttpBindings }>();

    app.use(
        "*",
        cors({
            origin: "*",
            allowMethods: ["GET", "POST", "OPTIONS"],
            allowHeaders: ["Content-Type", "Authorization"],
        }),
    );

    app.use("*", async (c, next) => {
        const startedAt = Date.now();
        const method = c.req.method;
        const route = c.req.path;
        let status: "success" | "error" = "success";

        try {
            await withSpan(
                "http.request",
                {
                    "http.method": method,
                    "http.route": route,
                },
                async (span) => {
                    await next();
                    span.setAttribute("http.status_code", c.res.status);
                },
            );
        } catch (error) {
            status = "error";
            throw error;
        } finally {
            recordRequestMetric(
                {
                    "mcp.transport": "http",
                    "http.method": method,
                    "http.route": route,
                    "http.status_code": c.res.status || (status === "error" ? 500 : 200),
                    "mcp.status": status,
                },
                Date.now() - startedAt,
            );
        }
    });

    app.onError((error, c) => {
        if (error instanceof HTTPException) {
            return error.getResponse();
        }

        logger.error("HTTP request error", {
            path: c.req.path,
            method: c.req.method,
            error,
        });
        return c.json({ error: "Internal server error" }, 500);
    });

    app.post("/", jsonRpcBodyValidator, async (c) => {
        const message = c.req.valid("json");

        if (message.method === "initialize") {
            return c.json(
                {
                    jsonrpc: "2.0",
                    id: message.id,
                    result: {
                        protocolVersion: "2024-11-05",
                        capabilities: {
                            tools: {},
                        },
                        serverInfo: {
                            name: "discord-mcp-server",
                            version: "0.0.1",
                        },
                    },
                },
                200,
            );
        }

        if (message.method === "tools/list") {
            return c.json(
                {
                    jsonrpc: "2.0",
                    id: message.id,
                    result: { tools: getAllTools() },
                },
                200,
            );
        }

        if (message.method === "tools/call") {
            try {
                const startedAt = Date.now();
                let parsedCall: ParsedDiscordManageCallLike | undefined;

                try {
                    parsedCall = parseDiscordManageCall(
                        message.params?.name,
                        message.params?.arguments,
                    );
                    const currentCall = parsedCall;
                    let result: string;

                    result = await identityWorkerPool.run(
                        currentCall.identityId,
                        async () => {
                            await ensureIdentityForCall(
                                currentCall.mode,
                                currentCall.identityId,
                            );
                            return executeDiscordManageOperation(currentCall);
                        },
                    );

                    writeAuditEvent({
                        identityId: currentCall.identityId,
                        mode: currentCall.mode,
                        method: currentCall.method,
                        operation: currentCall.operation,
                        riskTier: currentCall.riskTier,
                        status: "success",
                        durationMs: Date.now() - startedAt,
                        compatTranslated: currentCall.compatTranslated,
                        legacyOperation: currentCall.legacyOperation,
                        legacyRewriteCount: currentCall.legacyRewriteCount,
                        migrationBlocked: false,
                    });
                    return c.json(
                        {
                            jsonrpc: "2.0",
                            id: message.id,
                            result: {
                                content: [
                                    {
                                        type: "text",
                                        text: result,
                                    },
                                ],
                            },
                        },
                        200,
                    );
                } catch (error) {
                    const legacyError = asLegacyMigrationError(error);
                    if (legacyError) {
                        const operationType = legacyError.auditContext.operation
                            .toLowerCase()
                            .startsWith("discord.exec.")
                            ? "execution"
                            : "metadata";
                        recordDiscordOperationMetric(
                            {
                                "discord.layer": "router",
                                "discord.mode": legacyError.auditContext.mode,
                                "discord.method": legacyError.auditContext.method,
                                "discord.operation":
                                    legacyError.auditContext.operation,
                                "discord.operation_type": operationType,
                                "discord.risk_tier":
                                    legacyError.auditContext.riskTier,
                                "discord.status": "error",
                                "discord.compat_translated": "false",
                                "discord.legacy_operation_used": "true",
                                "discord.legacy_auto_rewrite": "false",
                                "discord.legacy_rewrite_blocked": "true",
                                "mcp.transport": "http",
                            },
                            Date.now() - startedAt,
                        );
                        writeAuditEvent({
                            identityId: legacyError.auditContext.identityId,
                            mode: legacyError.auditContext.mode,
                            method: legacyError.auditContext.method,
                            operation: legacyError.auditContext.operation,
                            riskTier: legacyError.auditContext.riskTier,
                            status: "error",
                            durationMs: Date.now() - startedAt,
                            compatTranslated: false,
                            legacyOperation:
                                legacyError.payload.error.legacyOperation,
                            legacyRewriteCount:
                                legacyError.payload.error.rewriteCount,
                            migrationBlocked: true,
                            error: legacyError.payload.error.message,
                        });
                        return c.json(
                            {
                                jsonrpc: "2.0",
                                id: message.id,
                                error: {
                                    code: -32000,
                                    message: legacyError.payload.error.code,
                                    data: legacyError.payload,
                                },
                            },
                            200,
                        );
                    }

                    if (!parsedCall) {
                        throw error;
                    }

                    writeAuditEvent({
                        identityId: parsedCall.identityId,
                        mode: parsedCall.mode,
                        method: parsedCall.method,
                        operation: parsedCall.operation,
                        riskTier: parsedCall.riskTier,
                        status: "error",
                        durationMs: Date.now() - startedAt,
                        compatTranslated: parsedCall.compatTranslated,
                        legacyOperation: parsedCall.legacyOperation,
                        legacyRewriteCount: parsedCall.legacyRewriteCount,
                        migrationBlocked: false,
                        error:
                            error instanceof Error
                                ? error.message
                                : String(error),
                    });
                    throw error;
                }
            } catch (error) {
                return c.json(
                    {
                        jsonrpc: "2.0",
                        id: message.id,
                        error: {
                            code: -32000,
                            message:
                                error instanceof Error
                                    ? error.message
                                    : String(error),
                        },
                    },
                    200,
                );
            }
        }

        return c.json(
            {
                jsonrpc: "2.0",
                id: message.id,
                error: {
                    code: -32601,
                    message: "Method not found",
                },
            },
            200,
        );
    });

    app.get("/sse", async (c) => {
        const transport = new SSEServerTransport(
            "/message",
            c.env.outgoing,
        );
        activeTransports.set(transport.sessionId, transport);
        transport.onclose = () => {
            activeTransports.delete(transport.sessionId);
        };
        await server.connect(transport);
        return RESPONSE_ALREADY_SENT;
    });

    app.post("/message", validator("json", (value) => value), async (c) => {
        const sessionId =
            c.req.query("sessionId") || c.req.header("x-session-id");
        const transport = sessionId
            ? activeTransports.get(sessionId)
            : undefined;
        if (!transport) {
            return c.json({ error: "Session not found" }, 404);
        }

        try {
            const message = c.req.valid("json");
            await transport.handleMessage(message);
            return c.json({ success: true }, 200);
        } catch (error) {
            return c.json(
                {
                    error:
                        error instanceof Error
                            ? error.message
                            : String(error),
                },
                400,
            );
        }
    });

    app.get("/health", (c) => {
        return c.json(
            {
                status: "ok",
                server: "discord-mcp",
                activeConnections: activeTransports.size,
            },
            200,
        );
    });

    app.get("/oauth/discord/start", oauthStartQueryValidator, async (c) => {
        try {
            const query = c.req.valid("query");
            const disableGuildSelect = parseBooleanQuery(
                query.disableGuildSelect || null,
            );
            const auth = await getOAuthManager().createAuthorizeLink({
                guildId: query.guildId || undefined,
                disableGuildSelect,
            });

            return c.json(
                {
                    authorizeUrl: auth.authorizeUrl,
                    expiresAt: auth.expiresAt,
                    scopes: auth.scopes,
                    permissions: auth.permissions,
                },
                200,
            );
        } catch (error) {
            return c.json(
                {
                    error:
                        error instanceof Error
                            ? error.message
                            : String(error),
                },
                500,
            );
        }
    });

    app.get(
        "/oauth/discord/callback",
        oauthCallbackQueryValidator,
        async (c) => {
            const query = c.req.valid("query");

            try {
                const callbackResult = await getOAuthManager().completeCallback(
                    query.code,
                    query.state,
                );

                return c.json(
                    {
                        status: "ok",
                        ...callbackResult,
                    },
                    200,
                );
            } catch (error) {
                const message =
                    error instanceof Error ? error.message : String(error);
                logger.warn("discord.callback.failed", {
                    path: c.req.path,
                    message,
                    error,
                });
                const isBadRequest =
                    message.includes("state") ||
                    message.includes("requires both code and state");
                return c.json({ error: message }, isBadRequest ? 400 : 502);
            }
        },
    );

    app.all("*", (c) => {
        const host = c.req.header("host") || `localhost:${port}`;

        return c.text(
            `Discord MCP Server\n\nMCP Remote Usage:\nnpx -y mcp-remote ${host}\n\nEndpoints:\n- GET /sse - SSE connection\n- POST /message - Message handling\n- GET /health - Health check\n- GET /oauth/discord/start - Generate OAuth install URL\n- GET /oauth/discord/callback - OAuth callback handler\n\nActive connections: ${activeTransports.size}`,
            404,
        );
    });

    return app;
}

export type AppType = ReturnType<typeof createHttpApp>;
