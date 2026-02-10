#!/usr/bin/env node
import "dotenv/config";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { serve } from "@hono/node-server";
import { DiscordService } from "./discord-service.js";
import { DiscordController } from "./core/DiscordController.js";
import { OAuthManager } from "./core/OAuthManager.js";
import { writeAuditEvent } from "./gateway/audit-log.js";
import { getDiscordJsSymbolsCatalog } from "./gateway/discordjs-symbol-catalog.js";
import { createHttpApp } from "./http-app.js";
import { WebUiRuntime } from "./web/runtime.js";
import {
    DISCORDJS_DISCOVERY_OPERATION,
    DYNAMIC_DISCORDJS_OPERATION_PREFIX,
    DOMAIN_METHODS,
    type DomainMethod,
    type DiscordOperation,
    isDiscordJsDiscoveryOperation,
    isDiscordJsInvocationOperation,
    resolveDomainMethod,
    resolveOperationForMethod,
} from "./gateway/domain-registry.js";
import { IdentityWorkerPool } from "./gateway/identity-worker-pool.js";
import {
    LocalEncryptedIdentityStore,
    type IdentityMode,
} from "./identity/local-encrypted-identity-store.js";
import * as schemas from "./types.js";

const server = new Server(
    {
        name: "discord-mcp-server",
        version: "0.0.1",
    },
    {
        capabilities: {
            tools: {},
        },
    },
);

let discordService: DiscordService;
let discordController: DiscordController;
let oauthManager: OAuthManager | null = null;
const identityStore = new LocalEncryptedIdentityStore();
const identityWorkerPool = new IdentityWorkerPool();

function getOAuthManager(): OAuthManager {
    if (!oauthManager) {
        throw new Error(
            "OAuth manager is not initialized.",
        );
    }
    return oauthManager;
}

function parseBooleanQuery(value: string | null): boolean | undefined {
    if (value === null) {
        return undefined;
    }

    const normalized = value.toLowerCase();
    if (normalized === "true" || normalized === "1" || normalized === "yes") {
        return true;
    }
    if (normalized === "false" || normalized === "0" || normalized === "no") {
        return false;
    }
    return undefined;
}

function parsePositiveInt(
    value: string | undefined,
    fallback: number,
): number {
    const parsed = Number.parseInt(value || "", 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return fallback;
    }
    return parsed;
}

// Initialize Discord service
async function initializeDiscord() {
    discordController = new DiscordController();
    await discordController.initialize();
    discordService = discordController.getDiscordService();
}

type RiskTier = "low" | "medium" | "high";

type ParsedDiscordManageCall = {
    mode: IdentityMode;
    identityId: string;
    method: DomainMethod;
    operation: DiscordOperation;
    params: Record<string, unknown>;
    riskTier: RiskTier;
};

type DiscordJsInvocationKind =
    | "class"
    | "enum"
    | "interface"
    | "function"
    | "type"
    | "const"
    | "variable"
    | "event"
    | "namespace"
    | "external";

type DiscordJsDynamicOperationKind = DiscordJsInvocationKind | "meta";

type ParsedDynamicDiscordJsOperation = {
    kind: DiscordJsDynamicOperationKind;
    symbol: string;
};

function parseDynamicDiscordJsOperation(
    operation: string,
): ParsedDynamicDiscordJsOperation | null {
    const normalized = operation.trim();
    if (
        !normalized
            .toLowerCase()
            .startsWith(DYNAMIC_DISCORDJS_OPERATION_PREFIX)
    ) {
        return null;
    }

    const withoutPrefix = normalized.slice(
        DYNAMIC_DISCORDJS_OPERATION_PREFIX.length,
    );
    const separatorIndex = withoutPrefix.indexOf(".");
    if (separatorIndex <= 0) {
        throw new Error(
            `Dynamic discord.js operation '${operation}' must match 'discordjs.<kind>.<symbol>'.`,
        );
    }

    const rawKind = withoutPrefix.slice(0, separatorIndex).toLowerCase();
    const encodedSymbol = withoutPrefix.slice(separatorIndex + 1);
    if (!encodedSymbol.trim()) {
        throw new Error(
            `Dynamic discord.js operation '${operation}' is missing symbol name after kind.`,
        );
    }

    const allowedKinds: DiscordJsDynamicOperationKind[] = [
        "meta",
        "class",
        "enum",
        "interface",
        "function",
        "type",
        "const",
        "variable",
        "event",
        "namespace",
        "external",
    ];

    if (!allowedKinds.includes(rawKind as DiscordJsDynamicOperationKind)) {
        throw new Error(
            `Unsupported discord.js dynamic kind '${rawKind}'. Supported kinds: ${allowedKinds.join(", ")}.`,
        );
    }

    let symbol = encodedSymbol;
    try {
        symbol = decodeURIComponent(encodedSymbol);
    } catch {
        symbol = encodedSymbol;
    }

    return {
        kind: rawKind as DiscordJsDynamicOperationKind,
        symbol,
    };
}

function coerceDynamicDiscordJsArgs(rawArgs: unknown): Record<string, unknown> {
    if (Array.isArray(rawArgs)) {
        return {
            args: rawArgs,
        };
    }

    if (rawArgs && typeof rawArgs === "object") {
        return rawArgs as Record<string, unknown>;
    }

    throw new Error(
        "Dynamic discord.js operations require 'params' or 'args' as an object or array.",
    );
}

// Complete tools list for both stdio and HTTP
const getAllTools = () => [
    {
        name: "discord_manage",
        description:
            "Comprehensive Discord server management tool - dynamic discord.js operation router",
        inputSchema: {
            type: "object",
            properties: {
                mode: {
                    type: "string",
                    enum: ["bot", "user"],
                    description:
                        "Execution identity mode. Defaults to 'bot' when omitted.",
                },
                identityId: {
                    type: "string",
                    description:
                        "Identity record ID (for example: default-bot or default-user).",
                },
                method: {
                    type: "string",
                    enum: DOMAIN_METHODS,
                    description: "Domain method (read/write split API surface).",
                },
                operation: {
                    type: "string",
                    description:
                        "Operation key. Discovery: discordjs.meta.symbols (method automation.read). Invocation: discordjs.<kind>.<symbol> (method automation.write, for example: discordjs.function.channelMention or discordjs.function.Guild%23fetch).",
                },
                params: {
                    type: "object",
                    description:
                        "Named parameters object (recommended for lower cognitive load).",
                    additionalProperties: true,
                },
                args: {
                    type: ["array", "object"],
                    description:
                        "Ordered args array (preferred) or keyed args object.",
                    additionalProperties: true,
                },
                context: {
                    type: "object",
                    description: "Optional request metadata for tracing/idempotency.",
                    additionalProperties: true,
                },
            },
            required: ["method", "operation"],
            additionalProperties: false,
        },
    },
];

type GenericSchema = {
    parse: (value: unknown) => unknown;
    shape?:
        | Record<string, unknown>
        | (() => Record<string, unknown>);
    _def?: {
        shape?: () => Record<string, unknown>;
    };
};

function getSchemaKeyOrder(schema: GenericSchema): string[] {
    const directShape =
        typeof schema.shape === "function" ? schema.shape() : schema.shape;
    if (directShape && typeof directShape === "object") {
        return Object.keys(directShape);
    }

    const defShape = schema._def?.shape;
    if (typeof defShape === "function") {
        const shape = defShape();
        if (shape && typeof shape === "object") {
            return Object.keys(shape);
        }
    }

    return [];
}

const DISCOVERY_PARAM_KEYS = getSchemaKeyOrder(
    schemas.GetDiscordjsSymbolsSchema as unknown as GenericSchema,
);
const INVOCATION_PARAM_KEYS = getSchemaKeyOrder(
    schemas.InvokeDiscordjsSymbolSchema as unknown as GenericSchema,
);

function coerceArgsToParams(
    rawArgs: unknown,
    paramKeys: string[],
    operationLabel: string,
): Record<string, unknown> {
    if (Array.isArray(rawArgs)) {
        if (rawArgs.length > paramKeys.length) {
            throw new Error(
                `Operation '${operationLabel}' received too many arguments. Expected at most ${paramKeys.length}, got ${rawArgs.length}.`,
            );
        }

        const params: Record<string, unknown> = {};
        for (let index = 0; index < rawArgs.length; index += 1) {
            const key = paramKeys[index];
            if (!key) {
                continue;
            }
            params[key] = rawArgs[index];
        }
        return params;
    }

    if (rawArgs && typeof rawArgs === "object") {
        return rawArgs as Record<string, unknown>;
    }

    throw new Error(
        "discord_manage requires 'args' as an array (preferred) or keyed object.",
    );
}

function normalizeParamsBySchemaOrder(
    operation: DiscordOperation,
    params: Record<string, unknown>,
): Record<string, unknown> {
    const ordered: Record<string, unknown> = {};
    const knownKeys = new Set<string>();
    const schemaKeys = isDiscordJsDiscoveryOperation(operation)
        ? DISCOVERY_PARAM_KEYS
        : INVOCATION_PARAM_KEYS;

    for (const key of schemaKeys) {
        if (key in params) {
            ordered[key] = params[key];
            knownKeys.add(key);
        }
    }

    for (const [key, value] of Object.entries(params)) {
        if (!knownKeys.has(key)) {
            ordered[key] = value;
        }
    }

    return ordered;
}

function coerceDiscoveryDiscordJsArgs(rawArgs: unknown): Record<string, unknown> {
    return coerceArgsToParams(
        rawArgs,
        DISCOVERY_PARAM_KEYS,
        DISCORDJS_DISCOVERY_OPERATION,
    );
}

function inferRiskTier(operation: DiscordOperation): RiskTier {
    if (isDiscordJsInvocationOperation(operation)) {
        return "high";
    }

    return "low";
}

function enforceOperationPolicy(
    mode: IdentityMode,
    operation: DiscordOperation,
): RiskTier {
    if (mode === "user" && isDiscordJsInvocationOperation(operation)) {
        throw new Error(
            `Operation '${operation}' is blocked for user mode. Use bot mode for this operation.`,
        );
    }

    const riskTier = inferRiskTier(operation);
    const blockHighRisk = process.env.DISCORD_MCP_BLOCK_HIGH_RISK === "true";
    if (riskTier === "high" && blockHighRisk) {
        throw new Error(
            `Operation '${operation}' is blocked by strict policy (DISCORD_MCP_BLOCK_HIGH_RISK=true).`,
        );
    }

    return riskTier;
}

async function ensureIdentityForCall(
    mode: IdentityMode,
    identityId: string,
): Promise<void> {
    const identity = identityStore.getIdentity(identityId);
    if (!identity) {
        const known = identityStore.listIdentityIds();
        throw new Error(
            `Unknown identityId '${identityId}'. Known identities: ${known.join(", ") || "none"}.`,
        );
    }

    if (identity.mode !== mode) {
        throw new Error(
            `Identity '${identityId}' is configured for mode '${identity.mode}', not '${mode}'.`,
        );
    }

    const current = discordService.getCurrentAuthConfig();
    if (current.tokenType === mode && current.token === identity.token) {
        return;
    }

    await discordService.switchToken({
        tokenType: mode,
        token: identity.token,
    });
}

function parseDiscordManageCall(
    name: unknown,
    rawArgs: unknown,
): ParsedDiscordManageCall {
    if (name !== "discord_manage") {
        throw new Error(
            `Unknown tool: ${String(name)}. Only 'discord_manage' is exposed.`,
        );
    }

    if (!rawArgs || typeof rawArgs !== "object" || Array.isArray(rawArgs)) {
        throw new Error(
            "discord_manage arguments must be an object with 'mode', 'identityId', 'method', 'operation', and 'params' or 'args'.",
        );
    }

    const args = rawArgs as Record<string, unknown>;
    const mode = (args.mode || "bot") as IdentityMode;
    const identityId =
        (typeof args.identityId === "string" && args.identityId.trim()) ||
        `default-${mode}`;
    const rawMethod = args.method;
    const rawOperation = args.operation;
    const rawParams = args.params;
    const rawMethodArgs = args.args;

    if (mode !== "bot" && mode !== "user") {
        throw new Error("discord_manage requires 'mode' to be either 'bot' or 'user'.");
    }

    if (typeof rawMethod !== "string") {
        throw new Error("discord_manage requires 'method' as a string.");
    }

    if (typeof rawOperation !== "string") {
        throw new Error("discord_manage requires 'operation' as a string.");
    }

    if (rawParams === undefined && rawMethodArgs === undefined) {
        throw new Error(
            "discord_manage requires either 'params' (recommended) or 'args'.",
        );
    }

    const method = resolveDomainMethod(rawMethod);
    const operation = resolveOperationForMethod(method, rawOperation);
    const dynamicOperation = parseDynamicDiscordJsOperation(operation);
    if (!dynamicOperation) {
        throw new Error(
            `Operation '${operation}' is not a valid dynamic discord.js operation.`,
        );
    }

    let params: Record<string, unknown>;
    if (isDiscordJsDiscoveryOperation(operation)) {
        params = normalizeParamsBySchemaOrder(
            operation,
            rawParams !== undefined
                ? coerceDiscoveryDiscordJsArgs(rawParams)
                : coerceDiscoveryDiscordJsArgs(rawMethodArgs),
        );
    } else if (isDiscordJsInvocationOperation(operation)) {
        const baseParams =
            rawParams !== undefined
                ? coerceDynamicDiscordJsArgs(rawParams)
                : coerceDynamicDiscordJsArgs(rawMethodArgs);

        if (dynamicOperation.kind === "meta") {
            throw new Error(
                `Operation '${operation}' cannot use kind 'meta' for invocation.`,
            );
        }

        const dynamicInvokeParams: Record<string, unknown> = {
            ...baseParams,
            symbol: dynamicOperation.symbol,
            kind: dynamicOperation.kind,
        };

        const explicitInvoke = dynamicInvokeParams.invoke;
        if (explicitInvoke === undefined) {
            dynamicInvokeParams.invoke = dynamicOperation.kind === "function";
        }

        params = normalizeParamsBySchemaOrder(operation, dynamicInvokeParams);
    } else {
        throw new Error(
            `Unsupported discord.js operation '${operation}'.`,
        );
    }

    const riskTier = enforceOperationPolicy(mode, operation);

    return {
        mode,
        identityId,
        method,
        operation,
        params,
        riskTier,
    };
}

async function executeDiscordManageOperation(
    parsedCall: ParsedDiscordManageCall,
): Promise<string> {
    const { operation, params } = parsedCall;

    if (isDiscordJsDiscoveryOperation(operation)) {
        const parsed = schemas.GetDiscordjsSymbolsSchema.parse(params);
        const catalog = await getDiscordJsSymbolsCatalog({
            kinds: parsed.kinds,
            query: parsed.query,
            page: parsed.page,
            pageSize: parsed.pageSize,
            sort: parsed.sort,
            includeKindCounts: parsed.includeKindCounts,
        });
        return JSON.stringify(catalog, null, 2);
    }

    if (isDiscordJsInvocationOperation(operation)) {
        const parsed = schemas.InvokeDiscordjsSymbolSchema.parse(params);
        return await discordService.invokeDiscordJsSymbol({
            symbol: parsed.symbol,
            kind: parsed.kind,
            invoke: parsed.invoke,
            dryRun: parsed.dryRun,
            allowWrite: parsed.allowWrite,
            policyMode: parsed.policyMode,
            args: parsed.args,
            target: parsed.target,
            context: parsed.context,
        });
    }

    throw new Error(`Unsupported operation: ${operation}`);
}

// Tool definitions
server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
        tools: getAllTools(),
    };
});

// Tool request handler
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
        const parsedCall = parseDiscordManageCall(
            request.params.name,
            request.params.arguments,
        );
        const startedAt = Date.now();

        try {
            const result = await identityWorkerPool.run(
                parsedCall.identityId,
                async () => {
                    await ensureIdentityForCall(
                        parsedCall.mode,
                        parsedCall.identityId,
                    );
                    return executeDiscordManageOperation(parsedCall);
                },
            );
            const response = {
                content: [{ type: "text", text: result }],
            };

            writeAuditEvent({
                identityId: parsedCall.identityId,
                mode: parsedCall.mode,
                method: parsedCall.method,
                operation: parsedCall.operation,
                riskTier: parsedCall.riskTier,
                status: "success",
                durationMs: Date.now() - startedAt,
            });

            return response;
        } catch (error) {
            writeAuditEvent({
                identityId: parsedCall.identityId,
                mode: parsedCall.mode,
                method: parsedCall.method,
                operation: parsedCall.operation,
                riskTier: parsedCall.riskTier,
                status: "error",
                durationMs: Date.now() - startedAt,
                error: error instanceof Error ? error.message : String(error),
            });
            throw error;
        }
    } catch (error) {
        const errorMessage =
            error instanceof Error ? error.message : String(error);
        return {
            content: [{ type: "text", text: `Error: ${errorMessage}` }],
            isError: true,
        };
    }
});

// Main function
async function main() {
    try {
        // Initialize Discord first
        await initializeDiscord();
        identityStore.ensureDefaultsFromEnv();

        // Check if we should use HTTP transport
        const useHttp = process.env.MCP_HTTP_PORT || process.env.PORT;
        const config = discordController.getConfigManager().getConfig();
        const oauthClientId =
            config.oauth.clientId || discordService.getBotApplicationId();

        oauthManager = new OAuthManager({
            ...config.oauth,
            clientId: oauthClientId,
        });

        if (useHttp) {
            const missingOAuthConfig =
                oauthManager.getMissingFullFlowConfigFields();
            if (missingOAuthConfig.length > 0) {
                throw new Error(
                    `Missing OAuth configuration for startup callback flow: ${missingOAuthConfig.join(", ")}`,
                );
            }

            const startupInvite = await oauthManager.createAuthorizeLink({
                guildId: config.oauth.defaultGuildId,
            });
            console.error(
                `Discord bot install URL (Administrator): ${startupInvite.authorizeUrl}`,
            );
            console.error(
                `OAuth callback URI: ${config.oauth.redirectUri}`,
            );
        } else {
            console.error(
                "OAuth startup install link skipped: HTTP mode is disabled (set MCP_HTTP_PORT to enable callback flow).",
            );
        }

        if (useHttp) {
            const webUiMountPath = process.env.DISCORD_WEB_UI_MOUNT_PATH || "/app";
            const webUiDistPath = process.env.DISCORD_WEB_UI_DIST_PATH || "./web/dist";
            const webUiStorePath =
                process.env.DISCORD_WEB_UI_STORE_PATH || "./data/web-ui-state.json";
            const webUiSessionCookieName =
                process.env.DISCORD_WEB_UI_SESSION_COOKIE_NAME ||
                "discord_mcp_web_session";
            const webUiSessionCookieTtlSeconds = parsePositiveInt(
                process.env.DISCORD_WEB_UI_SESSION_TTL_SECONDS,
                60 * 60 * 24 * 7,
            );
            const oidcStateTtlSeconds = parsePositiveInt(
                process.env.DISCORD_WEB_OIDC_STATE_TTL_SECONDS,
                600,
            );
            const plannerMaxActions = parsePositiveInt(
                process.env.DISCORD_WEB_PLANNER_MAX_ACTIONS,
                3,
            );
            const oidcScopes = (
                process.env.DISCORD_WEB_OIDC_SCOPES || "openid profile email"
            )
                .split(/\s+/)
                .map((scope) => scope.trim())
                .filter((scope) => scope.length > 0);

            const webUiRuntime = new WebUiRuntime(
                {
                    storePath: webUiStorePath,
                    sessionTtlSeconds: webUiSessionCookieTtlSeconds,
                    oidcStateTtlSeconds,
                    oidc: {
                        issuer: process.env.DISCORD_WEB_OIDC_ISSUER,
                        authorizationEndpoint:
                            process.env.DISCORD_WEB_OIDC_AUTHORIZATION_ENDPOINT,
                        tokenEndpoint: process.env.DISCORD_WEB_OIDC_TOKEN_ENDPOINT,
                        userinfoEndpoint:
                            process.env.DISCORD_WEB_OIDC_USERINFO_ENDPOINT,
                        clientId: process.env.DISCORD_WEB_OIDC_CLIENT_ID,
                        clientSecret: process.env.DISCORD_WEB_OIDC_CLIENT_SECRET,
                        redirectUri: process.env.DISCORD_WEB_OIDC_REDIRECT_URI,
                        scopes: oidcScopes,
                        pkceRequired:
                            process.env.DISCORD_WEB_OIDC_PKCE_REQUIRED !== "false",
                    },
                    planner: {
                        apiKey: process.env.DISCORD_WEB_PLANNER_API_KEY,
                        baseUrl: process.env.DISCORD_WEB_PLANNER_BASE_URL,
                        model:
                            process.env.DISCORD_WEB_PLANNER_MODEL ||
                            "gpt-4o-mini",
                        maxActions: plannerMaxActions,
                    },
                },
                async (request) => {
                    const parsedCall = parseDiscordManageCall("discord_manage", {
                        mode: request.mode,
                        identityId: request.identityId,
                        method: request.method,
                        operation: request.operation,
                        params: request.params,
                    });
                    const startedAt = Date.now();

                    try {
                        const result = await identityWorkerPool.run(
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

                        return { text: result };
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
                },
            );

            const port = Number.parseInt(useHttp, 10) || 3000;
            const app = createHttpApp({
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
            });
            serve({ fetch: app.fetch, port });

            console.error(
                `Discord MCP server running on HTTP port ${port}`,
            );
            console.error(`SSE endpoint: http://localhost:${port}/sse`);
            console.error(`Health check: http://localhost:${port}/health`);
            console.error(
                `OAuth start: http://localhost:${port}/oauth/discord/start`,
            );
            console.error(
                `OAuth callback: http://localhost:${port}/oauth/discord/callback`,
            );
            console.error(
                `Web UI: http://localhost:${port}${webUiMountPath}/`,
            );
            console.error(
                `Codex-style auth start: http://localhost:${port}/auth/codex/start`,
            );
            console.error(
                `OIDC alias start: http://localhost:${port}/auth/oidc/start`,
            );
            if (!webUiRuntime.isOidcConfigured()) {
                console.error(
                    `OIDC config missing fields: ${webUiRuntime.getOidcMissingConfigFields().join(", ")}`,
                );
            }
        } else {
            // Start stdio server (default)
            const transport = new StdioServerTransport();
            await server.connect(transport);
            console.error("Discord MCP server running on stdio");
        }
    } catch (error) {
        console.error("Failed to start Discord MCP server:", error);
        process.exit(1);
    }
}

// Graceful shutdown
process.on("SIGINT", async () => {
    console.error("Shutting down Discord MCP server...");
    if (discordService) {
        await discordService.destroy();
    }
    process.exit(0);
});

process.on("SIGTERM", async () => {
    console.error("Shutting down Discord MCP server...");
    if (discordService) {
        await discordService.destroy();
    }
    process.exit(0);
});

// Run the server
main().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
});
