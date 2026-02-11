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
import { AppErrorCode, toPublicErrorPayload } from "./core/errors.js";
import type { AuditEvent, AuditRiskTier } from "./gateway/audit-log.js";
import type {
    DiscordOperation,
    DomainMethod,
} from "./gateway/domain-registry.js";
import type { IdentityMode } from "./identity/local-encrypted-identity-store.js";
import { recordRequestMetric, withSpan } from "./observability/telemetry.js";

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

function parseJsonMaybe(payload: string): unknown {
    try {
        return JSON.parse(payload) as unknown;
    } catch {
        return payload;
    }
}

export type ParsedDiscordManageCallLike = {
    mode: IdentityMode;
    identityId: string;
    method: DomainMethod;
    operation: DiscordOperation;
    params: Record<string, unknown>;
    riskTier: AuditRiskTier;
};

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
                const parsedCall = parseDiscordManageCall(
                    message.params?.name,
                    message.params?.arguments,
                );
                const startedAt = Date.now();
                let result: string;

                try {
                    result = await identityWorkerPool.run(
                        parsedCall.identityId,
                        async () => {
                            await ensureIdentityForCall(
                                parsedCall.mode,
                                parsedCall.identityId,
                            );
                            return executeDiscordManageOperation(parsedCall);
                        },
                    );

                    writeAuditEvent({
                        identityId: parsedCall.identityId,
                        mode: parsedCall.mode,
                        method: parsedCall.method,
                        operation: parsedCall.operation,
                        riskTier: parsedCall.riskTier,
                        status: "success",
                        durationMs: Date.now() - startedAt,
                    });
                } catch (error) {
                    writeAuditEvent({
                        identityId: parsedCall.identityId,
                        mode: parsedCall.mode,
                        method: parsedCall.method,
                        operation: parsedCall.operation,
                        riskTier: parsedCall.riskTier,
                        status: "error",
                        durationMs: Date.now() - startedAt,
                        error:
                            error instanceof Error
                                ? error.message
                                : String(error),
                    });
                    throw error;
                }

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
                            structuredContent: {
                                operation: parsedCall.operation,
                                method: parsedCall.method,
                                mode: parsedCall.mode,
                                identityId: parsedCall.identityId,
                                result: parseJsonMaybe(result),
                            },
                        },
                    },
                    200,
                );
            } catch (error) {
                const payload = toPublicErrorPayload(error, AppErrorCode.Internal);
                return c.json(
                    {
                        jsonrpc: "2.0",
                        id: message.id,
                        error: {
                            code: -32000,
                            message: payload.message,
                            data: {
                                code: payload.code,
                            },
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
