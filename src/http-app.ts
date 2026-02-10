import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { Hono } from "hono";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { validator } from "hono/validator";
import { cors } from "hono/cors";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { HttpBindings } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { RESPONSE_ALREADY_SENT } from "@hono/node-server/utils/response";
import { z } from "zod";
import type { OAuthManager } from "./core/OAuthManager.js";
import type { AuditEvent, AuditRiskTier } from "./gateway/audit-log.js";
import type {
    DiscordOperation,
    DomainMethod,
} from "./gateway/domain-registry.js";
import type { IdentityMode } from "./identity/local-encrypted-identity-store.js";
import type {
    PlannedAction,
    WebUiRuntime,
} from "./web/runtime.js";

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

const OidcCallbackQuerySchema = z
    .object({
        code: z.string().min(1).optional(),
        state: z.string().min(1).optional(),
        error: z.string().optional(),
        error_description: z.string().optional(),
    })
    .superRefine((value, ctx) => {
        if (value.error) {
            return;
        }
        if (!value.code || !value.state) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message:
                    "OIDC callback requires either error fields or both code and state.",
            });
        }
    });

const OidcStartQuerySchema = z.object({
    returnTo: z.string().optional(),
    format: z.enum(["redirect", "json"]).optional(),
    workspaceId: z.string().trim().min(1).optional(),
});

const ApiKeyLoginSchema = z.object({
    apiKey: z.string().trim().min(1).max(256),
});

const SessionIdentityUpdateSchema = z.object({
    mode: z.enum(["bot", "user"]),
    rememberMode: z.boolean(),
});

const ChatCreateThreadSchema = z.object({
    title: z.string().trim().min(1).max(128).optional(),
});

const PlannedActionInputSchema: z.ZodType<PlannedAction> = z.object({
    id: z.string(),
    method: z.string() as unknown as z.ZodType<DomainMethod>,
    operation: z.string() as unknown as z.ZodType<DiscordOperation>,
    params: z.record(z.unknown()),
    rationale: z.string(),
    riskTier: z.enum(["low", "medium", "high"]),
    requiresConfirmation: z.boolean(),
});

const ChatPlanSchema = z.object({
    threadId: z.string().trim().min(1).optional(),
    message: z.string().trim().min(1).max(2000),
    mode: z.enum(["bot", "user"]).optional(),
    identityId: z.string().trim().min(1).max(128).optional(),
    rememberMode: z.boolean().optional(),
});

const ChatExecuteSchema = z.object({
    threadId: z.string().trim().min(1),
    mode: z.enum(["bot", "user"]).optional(),
    identityId: z.string().trim().min(1).max(128).optional(),
    confirmWrites: z.boolean().optional(),
    actions: z.array(PlannedActionInputSchema).min(1),
});

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

const oidcCallbackQueryValidator = validator("query", (value, c) => {
    const parsed = OidcCallbackQuerySchema.safeParse(value);
    if (!parsed.success) {
        return c.json(
            {
                error:
                    "OIDC callback requires either an error payload or both code and state query parameters",
            },
            400,
        );
    }
    return parsed.data;
});

const oidcStartQueryValidator = validator("query", (value, c) => {
    const parsed = OidcStartQuerySchema.safeParse(value);
    if (!parsed.success) {
        return c.json({ error: "Invalid OIDC query parameters" }, 400);
    }
    return parsed.data;
});

const apiKeyLoginValidator = validator("json", (value, c) => {
    const parsed = ApiKeyLoginSchema.safeParse(value);
    if (!parsed.success) {
        return c.json({ error: "Invalid API key login payload" }, 400);
    }
    return parsed.data;
});

const sessionIdentityValidator = validator("json", (value, c) => {
    const parsed = SessionIdentityUpdateSchema.safeParse(value);
    if (!parsed.success) {
        return c.json({ error: "Invalid session identity payload" }, 400);
    }
    return parsed.data;
});

const createThreadValidator = validator("json", (value, c) => {
    const parsed = ChatCreateThreadSchema.safeParse(value ?? {});
    if (!parsed.success) {
        return c.json({ error: "Invalid thread payload" }, 400);
    }
    return parsed.data;
});

const planChatValidator = validator("json", (value, c) => {
    const parsed = ChatPlanSchema.safeParse(value);
    if (!parsed.success) {
        return c.json({ error: "Invalid chat planning payload" }, 400);
    }
    return parsed.data;
});

const executeChatValidator = validator("json", (value, c) => {
    const parsed = ChatExecuteSchema.safeParse(value);
    if (!parsed.success) {
        return c.json({ error: "Invalid chat execution payload" }, 400);
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
    webUiRuntime: WebUiRuntime;
    webUiSessionCookieName: string;
    webUiSessionCookieTtlSeconds: number;
    webUiMountPath: string;
    webUiDistPath: string;
};

function normalizeMountPath(value: string): string {
    const trimmed = value.trim();
    if (!trimmed) {
        return "/app";
    }

    const withLeading = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
    return withLeading.replace(/\/+$/, "");
}

function normalizeReturnToPath(value: string | undefined, mountPath: string): string {
    if (!value || !value.trim()) {
        return `${mountPath}/`;
    }

    const candidate = value.trim();
    if (!candidate.startsWith("/")) {
        return `${mountPath}/`;
    }

    if (!candidate.startsWith(mountPath)) {
        return `${mountPath}/`;
    }

    return candidate;
}

function getRequestOrigin(c: Context<{ Bindings: HttpBindings }>): string {
    const forwardedProto = c.req.header("x-forwarded-proto");
    const forwardedHost = c.req.header("x-forwarded-host");
    const host = forwardedHost || c.req.header("host");
    if (host && forwardedProto) {
        const protocol = forwardedProto.split(",")[0]?.trim() || "http";
        return `${protocol}://${host}`;
    }
    if (host) {
        const protocol =
            c.req.url.startsWith("https://") || process.env.NODE_ENV === "production"
                ? "https"
                : "http";
        return `${protocol}://${host}`;
    }
    return new URL(c.req.url).origin;
}

function summarizeErrorForLog(
    error: unknown,
): {
    name?: string;
    message: string;
    stack?: string;
    code?: string;
} {
    if (error instanceof Error) {
        const maybeCode = (error as Error & { code?: unknown }).code;
        return {
            name: error.name,
            message: error.message,
            stack: error.stack,
            code: typeof maybeCode === "string" ? maybeCode : undefined,
        };
    }

    return {
        message: String(error),
    };
}

function logWebUiAuthError(
    stage: string,
    error: unknown,
    context?: Record<string, unknown>,
): void {
    console.error(`[web-ui auth] ${stage}`, {
        ...(context || {}),
        ...summarizeErrorForLog(error),
    });
}

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
        webUiRuntime,
        webUiSessionCookieName,
        webUiSessionCookieTtlSeconds,
        webUiMountPath,
        webUiDistPath,
    } = deps;

    const activeTransports = new Map<string, SSEServerTransport>();
    const app = new Hono<{ Bindings: HttpBindings }>();

    const mountPath = normalizeMountPath(webUiMountPath);
    const webDist = resolve(webUiDistPath);
    const webIndexPath = resolve(webDist, "index.html");
    const webIndexAvailable = existsSync(webIndexPath);

    const readWebIndex = async (): Promise<string> => {
        if (!webIndexAvailable) {
            throw new Error(
                `Web UI build not found. Expected index at ${webIndexPath}`,
            );
        }
        return readFile(webIndexPath, "utf8");
    };

    const getAuthenticatedSession = async (
        c: Context<{ Bindings: HttpBindings }>,
    ) => {
        const sessionId = getCookie(c, webUiSessionCookieName);
        if (!sessionId) {
            return null;
        }

        const session = await webUiRuntime.getSession(sessionId);
        if (!session) {
            deleteCookie(c, webUiSessionCookieName, { path: "/" });
            return null;
        }

        return session;
    };

    app.use(
        "*",
        cors({
            origin: "*",
            allowMethods: ["GET", "POST", "OPTIONS"],
            allowHeaders: ["Content-Type", "Authorization"],
        }),
    );

    app.onError((error, c) => {
        if (error instanceof HTTPException) {
            return error.getResponse();
        }

        console.error("HTTP request error:", error);
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
                        },
                    },
                    200,
                );
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
                webUi: {
                    mountPath,
                    built: webIndexAvailable,
                },
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
                logWebUiAuthError("discord.oauth.callback.failed", error, {
                    path: c.req.path,
                });
                const isBadRequest =
                    message.includes("state") ||
                    message.includes("requires both code and state");
                return c.json({ error: message }, isBadRequest ? 400 : 502);
            }
        },
    );

    app.get("/auth/oidc/start", oidcStartQueryValidator, async (c) => {
        const query = c.req.valid("query");
        const returnTo = normalizeReturnToPath(query.returnTo, mountPath);
        const workspaceId = query.workspaceId?.trim();
        const extraAuthorizationParams =
            workspaceId && workspaceId.length > 0
                ? { allowed_workspace_id: workspaceId }
                : undefined;

        try {
            if (
                !webUiRuntime.isOidcConfigured() &&
                webUiRuntime.isLocalDevAuthEnabled()
            ) {
                const session = await webUiRuntime.createLocalDevSession();
                setCookie(c, webUiSessionCookieName, session.sessionId, {
                    httpOnly: true,
                    secure: process.env.NODE_ENV === "production",
                    sameSite: "Lax",
                    path: "/",
                    maxAge: webUiSessionCookieTtlSeconds,
                });

                if (query.format === "json") {
                    return c.json(
                        {
                            mode: "dev",
                            session,
                            redirectTo: returnTo,
                        },
                        200,
                    );
                }
                return c.redirect(returnTo, 302);
            }

            const auth = await webUiRuntime.startOidcAuthentication({
                returnTo,
                extraAuthorizationParams,
            });
            if (query.format === "json") {
                return c.json(
                    {
                        authorizeUrl: auth.authorizeUrl,
                        expiresAt: auth.expiresAt,
                    },
                    200,
                );
            }
            return c.redirect(auth.authorizeUrl, 302);
        } catch (error) {
            const message =
                error instanceof Error ? error.message : String(error);
            logWebUiAuthError("oidc.start.failed", error, {
                path: c.req.path,
                returnTo,
                workspaceId: workspaceId || undefined,
            });
            return c.json({ error: message }, 500);
        }
    });

    app.get("/auth/codex/start", oidcStartQueryValidator, async (c) => {
        const query = c.req.valid("query");
        const returnTo = normalizeReturnToPath(query.returnTo, mountPath);
        const workspaceId = query.workspaceId?.trim();
        const extraAuthorizationParams =
            workspaceId && workspaceId.length > 0
                ? { allowed_workspace_id: workspaceId }
                : undefined;

        try {
            if (
                !webUiRuntime.isOidcConfigured() &&
                webUiRuntime.isLocalDevAuthEnabled()
            ) {
                const session = await webUiRuntime.createLocalDevSession();
                setCookie(c, webUiSessionCookieName, session.sessionId, {
                    httpOnly: true,
                    secure: process.env.NODE_ENV === "production",
                    sameSite: "Lax",
                    path: "/",
                    maxAge: webUiSessionCookieTtlSeconds,
                });

                if (query.format === "json") {
                    return c.json(
                        {
                            mode: "dev",
                            session,
                            redirectTo: returnTo,
                        },
                        200,
                    );
                }
                return c.redirect(returnTo, 302);
            }

            const redirectUri = `${getRequestOrigin(c)}/auth/callback`;
            const auth = await webUiRuntime.startOidcAuthentication({
                returnTo,
                redirectUri,
                extraAuthorizationParams,
            });
            if (query.format === "json") {
                return c.json(
                    {
                        authorizeUrl: auth.authorizeUrl,
                        expiresAt: auth.expiresAt,
                    },
                    200,
                );
            }
            return c.redirect(auth.authorizeUrl, 302);
        } catch (error) {
            const message =
                error instanceof Error ? error.message : String(error);
            logWebUiAuthError("codex.start.failed", error, {
                path: c.req.path,
                returnTo,
                workspaceId: workspaceId || undefined,
            });
            return c.json({ error: message }, 500);
        }
    });

    app.post("/auth/api-key/login", apiKeyLoginValidator, async (c) => {
        const payload = c.req.valid("json");

        try {
            const session = await webUiRuntime.createApiKeySession(payload.apiKey);
            setCookie(c, webUiSessionCookieName, session.sessionId, {
                httpOnly: true,
                secure: process.env.NODE_ENV === "production",
                sameSite: "Lax",
                path: "/",
                maxAge: webUiSessionCookieTtlSeconds,
            });

            return c.json({ session }, 200);
        } catch (error) {
            const message =
                error instanceof Error ? error.message : String(error);
            logWebUiAuthError("api_key.login.failed", error, {
                path: c.req.path,
            });
            return c.json({ error: message }, 400);
        }
    });

    const completeWebUiOidcCallback = async (
        c: Context<{ Bindings: HttpBindings }>,
        query: {
            code?: string;
            state?: string;
            error?: string;
            error_description?: string;
        },
    ) => {
        if (query.error) {
            const message = query.error_description
                ? `${query.error}: ${query.error_description}`
                : query.error;
            console.error("[web-ui auth] oidc.callback.provider_error", {
                path: c.req.path,
                error: query.error,
                description: query.error_description,
            });
            return c.redirect(
                `${mountPath}/?authError=${encodeURIComponent(message)}`,
                302,
            );
        }

        if (!query.code || !query.state) {
            return c.redirect(
                `${mountPath}/?authError=${encodeURIComponent(
                    "OIDC callback missing required code/state",
                )}`,
                302,
            );
        }

        try {
            const callback = await webUiRuntime.completeOidcAuthentication(
                query.code,
                query.state,
            );

            setCookie(c, webUiSessionCookieName, callback.session.sessionId, {
                httpOnly: true,
                secure: process.env.NODE_ENV === "production",
                sameSite: "Lax",
                path: "/",
                maxAge: webUiSessionCookieTtlSeconds,
            });

            const target = normalizeReturnToPath(callback.returnTo, mountPath);
            return c.redirect(target, 302);
        } catch (error) {
            const message =
                error instanceof Error ? error.message : String(error);
            logWebUiAuthError("oidc.callback.failed", error, {
                path: c.req.path,
            });
            return c.redirect(
                `${mountPath}/?authError=${encodeURIComponent(message)}`,
                302,
            );
        }
    };

    app.get("/auth/oidc/callback", oidcCallbackQueryValidator, async (c) =>
        completeWebUiOidcCallback(c, c.req.valid("query")),
    );
    app.get("/auth/codex/callback", oidcCallbackQueryValidator, async (c) =>
        completeWebUiOidcCallback(c, c.req.valid("query")),
    );
    app.get("/auth/callback", oidcCallbackQueryValidator, async (c) =>
        completeWebUiOidcCallback(c, c.req.valid("query")),
    );

    app.get("/api/session", async (c) => {
        const session = await getAuthenticatedSession(c);
        if (!session) {
            return c.json(
                {
                    authenticated: false,
                    oidcConfigured: webUiRuntime.isOidcConfigured(),
                    devAuthAvailable: webUiRuntime.isLocalDevAuthEnabled(),
                    missingOidcFields: webUiRuntime.getOidcMissingConfigFields(),
                },
                200,
            );
        }

        return c.json(
            {
                authenticated: true,
                session,
                oidcConfigured: webUiRuntime.isOidcConfigured(),
                devAuthAvailable: webUiRuntime.isLocalDevAuthEnabled(),
            },
            200,
        );
    });

    app.post("/api/session/logout", async (c) => {
        const sessionId = getCookie(c, webUiSessionCookieName);
        if (sessionId) {
            await webUiRuntime.deleteSession(sessionId);
        }

        deleteCookie(c, webUiSessionCookieName, { path: "/" });
        return c.json({ ok: true }, 200);
    });

    app.post("/api/session/identity", sessionIdentityValidator, async (c) => {
        const session = await getAuthenticatedSession(c);
        if (!session) {
            return c.json({ error: "Authentication required" }, 401);
        }

        const payload = c.req.valid("json");
        const updated = await webUiRuntime.updateSessionIdentityPreference(
            session.sessionId,
            payload.mode,
            payload.rememberMode,
        );

        return c.json({ session: updated }, 200);
    });

    app.get("/api/chat/threads", async (c) => {
        const session = await getAuthenticatedSession(c);
        if (!session) {
            return c.json({ error: "Authentication required" }, 401);
        }

        const threads = await webUiRuntime.listThreads(session.sessionId);
        return c.json({ threads }, 200);
    });

    app.post("/api/chat/threads", createThreadValidator, async (c) => {
        const session = await getAuthenticatedSession(c);
        if (!session) {
            return c.json({ error: "Authentication required" }, 401);
        }

        const payload = c.req.valid("json");
        const thread = await webUiRuntime.createThread(
            session.sessionId,
            payload.title,
        );
        return c.json({ thread }, 200);
    });

    app.get("/api/chat/threads/:threadId/messages", async (c) => {
        const session = await getAuthenticatedSession(c);
        if (!session) {
            return c.json({ error: "Authentication required" }, 401);
        }

        const threadId = c.req.param("threadId");
        if (!threadId) {
            return c.json({ error: "threadId is required" }, 400);
        }

        try {
            const messages = await webUiRuntime.listMessages(
                session.sessionId,
                threadId,
            );
            return c.json({ messages }, 200);
        } catch (error) {
            const message =
                error instanceof Error ? error.message : String(error);
            return c.json({ error: message }, 404);
        }
    });

    app.post("/api/chat/plan", planChatValidator, async (c) => {
        const session = await getAuthenticatedSession(c);
        if (!session) {
            return c.json({ error: "Authentication required" }, 401);
        }

        const payload = c.req.valid("json");
        const mode = payload.mode ?? (session.rememberMode ? session.defaultMode : null);
        if (!mode) {
            return c.json(
                {
                    error:
                        "Mode is required for planning when session preference is not remembered.",
                },
                400,
            );
        }

        const identityId = payload.identityId || `default-${mode}`;
        const rememberMode = payload.rememberMode ?? session.rememberMode;

        try {
            const planned = await webUiRuntime.planMessage({
                sessionId: session.sessionId,
                threadId: payload.threadId,
                message: payload.message,
                mode,
                identityId,
                rememberMode,
            });

            return c.json(
                {
                    thread: planned.thread,
                    userMessage: planned.userMessage,
                    assistantMessage: planned.assistantMessage,
                    plan: planned.plan,
                },
                200,
            );
        } catch (error) {
            const message =
                error instanceof Error ? error.message : String(error);
            return c.json({ error: message }, 400);
        }
    });

    app.post("/api/chat/execute", executeChatValidator, async (c) => {
        const session = await getAuthenticatedSession(c);
        if (!session) {
            return c.json({ error: "Authentication required" }, 401);
        }

        const payload = c.req.valid("json");
        const mode = payload.mode ?? (session.rememberMode ? session.defaultMode : null);
        if (!mode) {
            return c.json(
                {
                    error:
                        "Mode is required for execution when session preference is not remembered.",
                },
                400,
            );
        }

        const identityId = payload.identityId || `default-${mode}`;

        try {
            const executed = await webUiRuntime.executePlan({
                sessionId: session.sessionId,
                threadId: payload.threadId,
                mode,
                identityId,
                confirmWrites: payload.confirmWrites ?? false,
                actions: payload.actions,
            });

            return c.json(
                {
                    results: executed.results,
                    assistantMessage: executed.assistantMessage,
                },
                200,
            );
        } catch (error) {
            const message =
                error instanceof Error ? error.message : String(error);
            return c.json({ error: message }, 400);
        }
    });

    if (webIndexAvailable) {
        // Support SvelteKit static output under /app/_app/* and legacy Vite assets.
        const webAssetHandler = serveStatic({
            root: webDist,
            rewriteRequestPath: (path) => path.replace(mountPath, ""),
        });

        app.use(`${mountPath}/_app/*`, webAssetHandler);
        app.use(
            `${mountPath}/assets/*`,
            webAssetHandler,
        );
        app.use(`${mountPath}/favicon.ico`, webAssetHandler);
        app.use(`${mountPath}/robots.txt`, webAssetHandler);
        app.use(`${mountPath}/manifest.json`, webAssetHandler);
        app.use(`${mountPath}/service-worker.js`, webAssetHandler);

        app.get(mountPath, (c) => c.redirect(`${mountPath}/`, 302));
        app.get(`${mountPath}/`, async (c) => {
            return c.html(await readWebIndex(), 200);
        });
        app.get(`${mountPath}/*`, async (c) => {
            if (c.req.path.startsWith(`${mountPath}/assets/`)) {
                return c.notFound();
            }
            return c.html(await readWebIndex(), 200);
        });
    }

    app.all("*", (c) => {
        const host = c.req.header("host") || `localhost:${port}`;
        const uiState = webIndexAvailable
            ? `\n- ${mountPath}/ - Web chat UI`
            : `\n- ${mountPath}/ - Web chat UI (build missing: run npm --prefix web run build)`;

        return c.text(
            `Discord MCP Server\n\nMCP Remote Usage:\nnpx -y mcp-remote ${host}\n\nEndpoints:\n- GET /sse - SSE connection\n- POST /message - Message handling\n- GET /health - Health check\n- GET /oauth/discord/start - Generate OAuth install URL\n- GET /oauth/discord/callback - OAuth callback handler\n- GET /auth/codex/start - Start Codex-style login flow\n- GET /auth/codex/callback - Complete Codex-style login flow\n- GET /auth/oidc/start - Start OIDC login flow (alias)\n- GET /auth/oidc/callback - Complete OIDC login flow (alias)\n- GET /auth/callback - Codex-compatible callback alias\n- POST /auth/api-key/login - Start API key web session\n- GET /api/session - Current web session\n- GET /api/chat/threads - Chat thread list${uiState}\n\nActive connections: ${activeTransports.size}`,
            200,
        );
    });

    return app;
}

export type AppType = ReturnType<typeof createHttpApp>;
