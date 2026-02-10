import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { HttpBindings } from "@hono/node-server";
import { RESPONSE_ALREADY_SENT } from "@hono/node-server/utils/response";
import type { OAuthManager } from "./core/OAuthManager.js";
import type { AuditEvent, AuditRiskTier } from "./gateway/audit-log.js";
import type {
    DomainMethod,
    DiscordOperation,
} from "./gateway/domain-registry.js";
import type { IdentityMode } from "./identity/local-encrypted-identity-store.js";

type JsonRpcHttpMessage = {
    id?: unknown;
    method?: string;
    params?: {
        name?: unknown;
        arguments?: unknown;
    };
};

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

    app.onError((error, c) => {
        console.error("HTTP request error:", error);
        return c.json({ error: "Internal server error" }, 500);
    });

    app.post("/", async (c) => {
        try {
            const message = await c.req.json<JsonRpcHttpMessage>();

            if (message.method === "initialize") {
                return c.json({
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
                });
            }

            if (message.method === "tools/list") {
                return c.json({
                    jsonrpc: "2.0",
                    id: message.id,
                    result: { tools: getAllTools() },
                });
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

                    return c.json({
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
                    });
                } catch (error) {
                    return c.json({
                        jsonrpc: "2.0",
                        id: message.id,
                        error: {
                            code: -32000,
                            message:
                                error instanceof Error
                                    ? error.message
                                    : String(error),
                        },
                    });
                }
            }

            return c.json({
                jsonrpc: "2.0",
                id: message.id,
                error: {
                    code: -32601,
                    message: "Method not found",
                },
            });
        } catch {
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

    app.post("/message", async (c) => {
        const sessionId =
            c.req.query("sessionId") || c.req.header("x-session-id");
        const transport = sessionId
            ? activeTransports.get(sessionId)
            : undefined;
        if (!transport) {
            return c.json({ error: "Session not found" }, 404);
        }

        try {
            const message = await c.req.json();
            await transport.handleMessage(message);
            return c.json({ success: true });
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
        return c.json({
            status: "ok",
            server: "discord-mcp",
            activeConnections: activeTransports.size,
        });
    });

    app.get("/oauth/discord/start", async (c) => {
        try {
            const disableGuildSelect = parseBooleanQuery(
                c.req.query("disableGuildSelect") || null,
            );
            const auth = await getOAuthManager().createAuthorizeLink({
                guildId: c.req.query("guildId") || undefined,
                disableGuildSelect,
            });

            return c.json({
                authorizeUrl: auth.authorizeUrl,
                expiresAt: auth.expiresAt,
                scopes: auth.scopes,
                permissions: auth.permissions,
            });
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

    app.get("/oauth/discord/callback", async (c) => {
        const code = c.req.query("code");
        const state = c.req.query("state");

        if (!code || !state) {
            return c.json(
                {
                    error:
                        "OAuth callback requires code and state query parameters",
                },
                400,
            );
        }

        try {
            const callbackResult = await getOAuthManager().completeCallback(
                code,
                state,
            );

            return c.json({
                status: "ok",
                ...callbackResult,
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            const isBadRequest =
                message.includes("state") ||
                message.includes("requires both code and state");
            return c.json({ error: message }, isBadRequest ? 400 : 502);
        }
    });

    app.all("*", (c) => {
        const host = c.req.header("host") || `localhost:${port}`;
        return c.text(`Discord MCP Server

MCP Remote Usage:
npx -y mcp-remote ${host}

Endpoints:
- GET /sse - SSE connection
- POST /message - Message handling
- GET /health - Health check
- GET /oauth/discord/start - Generate OAuth install URL
- GET /oauth/discord/callback - OAuth callback handler

Active connections: ${activeTransports.size}`);
    });

    return app;
}

export type AppType = ReturnType<typeof createHttpApp>;
