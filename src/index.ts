#!/usr/bin/env node
import "dotenv/config";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { DiscordService } from "./discord-service.js";
import { DiscordController } from "./core/DiscordController.js";
import { OAuthManager } from "./core/OAuthManager.js";
import { writeAuditEvent } from "./gateway/audit-log.js";
import { getDiscordJsSymbolsCatalog } from "./gateway/discordjs-symbol-catalog.js";
import {
    DISCORD_OPERATIONS,
    DOMAIN_METHODS,
    type DomainMethod,
    type DiscordOperation,
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

async function createBotInviteLinkText(
    guildId?: string,
    disableGuildSelect?: boolean,
): Promise<string> {
    const auth = await getOAuthManager().createAuthorizeLink({
        guildId,
        disableGuildSelect,
    });

    return `Discord bot install URL (Administrator):
${auth.authorizeUrl}
- Permissions: Administrator (bit 8)
- Scopes: ${auth.scopes.join(", ")}
- Expires: ${auth.expiresAt}`;
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

const USER_MODE_BLOCKED_ACTIONS = new Set<string>([
    "invoke_discordjs_symbol",
]);

const HIGH_RISK_ACTIONS = new Set<string>([
    "invoke_discordjs_symbol",
]);

const ACTION_SCHEMA_NAME_OVERRIDES: Record<string, string> = {
    // Intentionally empty: static operations follow PascalCase + Schema naming.
};

type DiscordJsDynamicInvocationKind =
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

type ParsedDynamicDiscordJsOperation = {
    kind: DiscordJsDynamicInvocationKind;
    symbol: string;
};

const DYNAMIC_DISCORDJS_OPERATION_PREFIX = "discordjs.";

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

    const allowedKinds: DiscordJsDynamicInvocationKind[] = [
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

    if (!allowedKinds.includes(rawKind as DiscordJsDynamicInvocationKind)) {
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
        kind: rawKind as DiscordJsDynamicInvocationKind,
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
                        "Operation key. Static: get_discordjs_symbols | invoke_discordjs_symbol. Dynamic: discordjs.<kind>.<symbol> (for example: discordjs.function.channelMention or discordjs.function.Guild%23fetch).",
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

function toPascalCase(value: string): string {
    return value
        .split("_")
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join("");
}

function getActionSchema(action: string): GenericSchema {
    const schemaName =
        ACTION_SCHEMA_NAME_OVERRIDES[action] || `${toPascalCase(action)}Schema`;
    const schema = (schemas as Record<string, unknown>)[schemaName] as
        | GenericSchema
        | undefined;

    if (!schema || typeof schema.parse !== "function") {
        throw new Error(
            `Schema '${schemaName}' not found for action '${action}'.`,
        );
    }

    return schema;
}

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

const ACTION_PARAM_KEYS = new Map<string, string[]>();
for (const action of DISCORD_OPERATIONS) {
    const schema = getActionSchema(action);
    ACTION_PARAM_KEYS.set(action, getSchemaKeyOrder(schema));
}

function coerceArgsToParams(
    operation: DiscordOperation,
    rawArgs: unknown,
): Record<string, unknown> {
    if (Array.isArray(rawArgs)) {
        const paramKeys = ACTION_PARAM_KEYS.get(operation) || [];
        if (rawArgs.length > paramKeys.length) {
            throw new Error(
                `Operation '${operation}' received too many arguments. Expected at most ${paramKeys.length}, got ${rawArgs.length}.`,
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
    const schemaKeys = ACTION_PARAM_KEYS.get(operation) || [];

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

function inferRiskTier(operation: DiscordOperation): RiskTier {
    if (HIGH_RISK_ACTIONS.has(operation)) {
        return "high";
    }

    if (
        operation.startsWith("create_") ||
        operation.startsWith("edit_") ||
        operation.startsWith("set_") ||
        operation.startsWith("add_") ||
        operation.startsWith("remove_") ||
        operation.startsWith("move_") ||
        operation.startsWith("send_") ||
        operation.startsWith("pin_") ||
        operation.startsWith("unpin_") ||
        operation.startsWith("play_") ||
        operation.startsWith("upload_") ||
        operation === "crosspost_message" ||
        operation === "organize_channels"
    ) {
        return "medium";
    }

    return "low";
}

function enforceOperationPolicy(
    mode: IdentityMode,
    operation: DiscordOperation,
): RiskTier {
    if (mode === "user" && USER_MODE_BLOCKED_ACTIONS.has(operation)) {
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
    const dynamicOperation = parseDynamicDiscordJsOperation(rawOperation);

    let operation: DiscordOperation;
    let params: Record<string, unknown>;
    if (dynamicOperation) {
        if (method !== "automation.write") {
            throw new Error(
                `Dynamic discord.js operations require method 'automation.write'. Received '${method}'.`,
            );
        }

        operation = resolveOperationForMethod(method, "invoke_discordjs_symbol");

        const baseParams =
            rawParams !== undefined
                ? coerceDynamicDiscordJsArgs(rawParams)
                : coerceDynamicDiscordJsArgs(rawMethodArgs);

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
        operation = resolveOperationForMethod(method, rawOperation);
        params = normalizeParamsBySchemaOrder(
            operation,
            rawParams !== undefined
                ? coerceArgsToParams(operation, rawParams)
                : coerceArgsToParams(operation, rawMethodArgs),
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
            const response = await identityWorkerPool.run(
                parsedCall.identityId,
                async () => {
                    await ensureIdentityForCall(
                        parsedCall.mode,
                        parsedCall.identityId,
                    );
                    const { operation: action, params: args } = parsedCall;

                    switch (action) {
                        case "get_discordjs_symbols": {
                            const parsed =
                                schemas.GetDiscordjsSymbolsSchema.parse(args);
                            const catalog = await getDiscordJsSymbolsCatalog({
                                kinds: parsed.kinds,
                                query: parsed.query,
                                page: parsed.page,
                                pageSize: parsed.pageSize,
                                sort: parsed.sort,
                                includeKindCounts: parsed.includeKindCounts,
                            });
                            return {
                                content: [
                                    {
                                        type: "text",
                                        text: JSON.stringify(catalog, null, 2),
                                    },
                                ],
                            };
                        }

                        case "invoke_discordjs_symbol": {
                            const parsed =
                                schemas.InvokeDiscordjsSymbolSchema.parse(args);
                            const result = await discordService.invokeDiscordJsSymbol(
                                {
                                    symbol: parsed.symbol,
                                    kind: parsed.kind,
                                    invoke: parsed.invoke,
                                    dryRun: parsed.dryRun,
                                    allowWrite: parsed.allowWrite,
                                    policyMode: parsed.policyMode,
                                    args: parsed.args,
                                    target: parsed.target,
                                    context: parsed.context,
                                },
                            );
                            return { content: [{ type: "text", text: result }] };
                        }

                        default:
                            throw new Error(`Unsupported operation: ${action}`);
                    }
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
            // Start HTTP server
            const port = parseInt(useHttp) || 3000;

            // Map to store active transports by session ID
            const activeTransports = new Map();

            const httpServer = createServer(
                async (req: IncomingMessage, res: ServerResponse) => {
                const url = new URL(
                    req.url || "/",
                    `http://${req.headers.host}`,
                );

                // CORS headers
                res.setHeader("Access-Control-Allow-Origin", "*");
                res.setHeader(
                    "Access-Control-Allow-Methods",
                    "GET, POST, OPTIONS",
                );
                res.setHeader(
                    "Access-Control-Allow-Headers",
                    "Content-Type, Authorization",
                );

                if (req.method === "OPTIONS") {
                    res.writeHead(200);
                    res.end();
                    return;
                }

                try {
                    if (
                        req.method === "POST" &&
                        req.headers["content-type"]?.includes(
                            "application/json",
                        )
                    ) {
                        // Handle JSON-RPC over HTTP (mcp-remote style)
                        let body = "";
                        req.on("data", (chunk: Buffer) => {
                            body += chunk.toString();
                        });

                        req.on("end", async () => {
                            try {
                                const message = JSON.parse(body);

                                // Handle the JSON-RPC request directly
                                if (message.method === "initialize") {
                                    const response = {
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
                                    };
                                    res.writeHead(200, {
                                        "Content-Type": "application/json",
                                    });
                                    res.end(JSON.stringify(response));
                                } else if (message.method === "tools/list") {
                                    // Return complete tools list
                                    const tools = getAllTools();
                                    const response = {
                                        jsonrpc: "2.0",
                                        id: message.id,
                                        result: { tools },
                                    };
                                    res.writeHead(200, {
                                        "Content-Type": "application/json",
                                    });
                                    res.end(JSON.stringify(response));
                                } else if (message.method === "tools/call") {
                                    // Handle tool call by name
                                    try {
                                        const parsedCall =
                                            parseDiscordManageCall(
                                                message.params.name,
                                                message.params.arguments,
                                            );
                                        const startedAt = Date.now();
                                        let result: string;

                                        try {
                                            result =
                                                await identityWorkerPool.run(
                                                    parsedCall.identityId,
                                                    async () => {
                                                        await ensureIdentityForCall(
                                                            parsedCall.mode,
                                                            parsedCall.identityId,
                                                        );
                                                        const {
                                                            operation: action,
                                                            params: args,
                                                        } = parsedCall;
                                                        let result: string;

                                                        switch (action) {
                                                            case "get_discordjs_symbols": {
                                                                const parsed =
                                                                    schemas.GetDiscordjsSymbolsSchema.parse(
                                                                        args,
                                                                    );
                                                                const catalog =
                                                                    await getDiscordJsSymbolsCatalog(
                                                                        {
                                                                            kinds: parsed.kinds,
                                                                            query: parsed.query,
                                                                            page: parsed.page,
                                                                            pageSize:
                                                                                parsed.pageSize,
                                                                            sort: parsed.sort,
                                                                            includeKindCounts:
                                                                                parsed.includeKindCounts,
                                                                        },
                                                                    );
                                                                result = JSON.stringify(
                                                                    catalog,
                                                                    null,
                                                                    2,
                                                                );
                                                                break;
                                                            }
                                                            case "invoke_discordjs_symbol": {
                                                                const parsed =
                                                                    schemas.InvokeDiscordjsSymbolSchema.parse(
                                                                        args,
                                                                    );
                                                                result =
                                                                    await discordService.invokeDiscordJsSymbol(
                                                                        {
                                                                            symbol: parsed.symbol,
                                                                            kind: parsed.kind,
                                                                            invoke: parsed.invoke,
                                                                            dryRun: parsed.dryRun,
                                                                            allowWrite:
                                                                                parsed.allowWrite,
                                                                            policyMode:
                                                                                parsed.policyMode,
                                                                            args: parsed.args,
                                                                            target: parsed.target,
                                                                            context: parsed.context,
                                                                        },
                                                                    );
                                                                break;
                                                            }

                                                            default:
                                                                throw new Error(
                                                                    `Unsupported operation: ${action}`,
                                                                );
                                                        }
                                                        return result;
                                                    },
                                                );

                                            writeAuditEvent({
                                                identityId:
                                                    parsedCall.identityId,
                                                mode: parsedCall.mode,
                                                method: parsedCall.method,
                                                operation: parsedCall.operation,
                                                riskTier: parsedCall.riskTier,
                                                status: "success",
                                                durationMs:
                                                    Date.now() - startedAt,
                                            });
                                        } catch (error) {
                                            writeAuditEvent({
                                                identityId:
                                                    parsedCall.identityId,
                                                mode: parsedCall.mode,
                                                method: parsedCall.method,
                                                operation: parsedCall.operation,
                                                riskTier: parsedCall.riskTier,
                                                status: "error",
                                                durationMs:
                                                    Date.now() - startedAt,
                                                error:
                                                    error instanceof Error
                                                        ? error.message
                                                        : String(error),
                                            });
                                            throw error;
                                        }

                                        const response = {
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
                                        };
                                        res.writeHead(200, {
                                            "Content-Type": "application/json",
                                        });
                                        res.end(JSON.stringify(response));
                                    } catch (error) {
                                        const response = {
                                            jsonrpc: "2.0",
                                            id: message.id,
                                            error: {
                                                code: -32000,
                                                message:
                                                    error instanceof Error
                                                        ? error.message
                                                        : String(error),
                                            },
                                        };
                                        res.writeHead(200, {
                                            "Content-Type": "application/json",
                                        });
                                        res.end(JSON.stringify(response));
                                    }
                                } else {
                                    // Unknown method
                                    const response = {
                                        jsonrpc: "2.0",
                                        id: message.id,
                                        error: {
                                            code: -32601,
                                            message: "Method not found",
                                        },
                                    };
                                    res.writeHead(200, {
                                        "Content-Type": "application/json",
                                    });
                                    res.end(JSON.stringify(response));
                                }
                            } catch (error) {
                                const response = {
                                    jsonrpc: "2.0",
                                    id: null,
                                    error: {
                                        code: -32700,
                                        message: "Parse error",
                                    },
                                };
                                res.writeHead(400, {
                                    "Content-Type": "application/json",
                                });
                                res.end(JSON.stringify(response));
                            }
                        });
                    } else if (
                        url.pathname === "/sse" &&
                        req.method === "GET"
                    ) {
                        // SSE connection
                        const transport = new SSEServerTransport(
                            "/message",
                            res,
                        );
                        activeTransports.set(transport.sessionId, transport);
                        await server.connect(transport);
                        await transport.start();
                        transport.onclose = () => {
                            activeTransports.delete(transport.sessionId);
                        };
                    } else if (
                        url.pathname === "/message" &&
                        req.method === "POST"
                    ) {
                        // Handle POST messages from mcp-remote
                        let body = "";
                        req.on("data", (chunk: Buffer) => {
                            body += chunk.toString();
                        });

                        req.on("end", async () => {
                            try {
                                // Get session ID from URL params or headers
                                const sessionId =
                                    url.searchParams.get("sessionId") ||
                                    req.headers["x-session-id"];
                                const transport =
                                    activeTransports.get(sessionId);

                                if (transport) {
                                    const message = JSON.parse(body);
                                    await transport.handleMessage(message);
                                    res.writeHead(200, {
                                        "Content-Type": "application/json",
                                    });
                                    res.end(JSON.stringify({ success: true }));
                                } else {
                                    res.writeHead(404, {
                                        "Content-Type": "application/json",
                                    });
                                    res.end(
                                        JSON.stringify({
                                            error: "Session not found",
                                        }),
                                    );
                                }
                            } catch (error) {
                                res.writeHead(400, {
                                    "Content-Type": "application/json",
                                });
                                res.end(
                                    JSON.stringify({
                                        error:
                                            error instanceof Error
                                                ? error.message
                                                : String(error),
                                    }),
                                );
                            }
                        });
                    } else if (
                        url.pathname === "/health" &&
                        req.method === "GET"
                    ) {
                        // Health check
                        res.writeHead(200, {
                            "Content-Type": "application/json",
                        });
                        res.end(
                            JSON.stringify({
                                status: "ok",
                                server: "discord-mcp",
                                activeConnections: activeTransports.size,
                            }),
                        );
                    } else if (
                        url.pathname === "/oauth/discord/start" &&
                        req.method === "GET"
                    ) {
                        try {
                            const disableGuildSelect = parseBooleanQuery(
                                url.searchParams.get("disableGuildSelect"),
                            );
                            const auth = await getOAuthManager().createAuthorizeLink(
                                {
                                    guildId:
                                        url.searchParams.get("guildId") ||
                                        undefined,
                                    disableGuildSelect,
                                },
                            );

                            res.writeHead(200, {
                                "Content-Type": "application/json",
                            });
                            res.end(
                                JSON.stringify({
                                    authorizeUrl: auth.authorizeUrl,
                                    expiresAt: auth.expiresAt,
                                    scopes: auth.scopes,
                                    permissions: auth.permissions,
                                }),
                            );
                        } catch (error) {
                            res.writeHead(500, {
                                "Content-Type": "application/json",
                            });
                            res.end(
                                JSON.stringify({
                                    error:
                                        error instanceof Error
                                            ? error.message
                                            : String(error),
                                }),
                            );
                        }
                    } else if (
                        url.pathname === "/oauth/discord/callback" &&
                        req.method === "GET"
                    ) {
                        const code = url.searchParams.get("code");
                        const state = url.searchParams.get("state");

                        if (!code || !state) {
                            res.writeHead(400, {
                                "Content-Type": "application/json",
                            });
                            res.end(
                                JSON.stringify({
                                    error: "OAuth callback requires code and state query parameters",
                                }),
                            );
                            return;
                        }

                        try {
                            const callbackResult =
                                await getOAuthManager().completeCallback(
                                    code,
                                    state,
                                );

                            res.writeHead(200, {
                                "Content-Type": "application/json",
                            });
                            res.end(
                                JSON.stringify({
                                    status: "ok",
                                    ...callbackResult,
                                }),
                            );
                        } catch (error) {
                            const message =
                                error instanceof Error
                                    ? error.message
                                    : String(error);
                            const isBadRequest =
                                message.includes("state") ||
                                message.includes("requires both code and state");
                            res.writeHead(isBadRequest ? 400 : 502, {
                                "Content-Type": "application/json",
                            });
                            res.end(JSON.stringify({ error: message }));
                        }
                    } else {
                        // Default response with mcp-remote instructions
                        res.writeHead(200, { "Content-Type": "text/plain" });
                        res.end(`Discord MCP Server

MCP Remote Usage:
npx -y mcp-remote ${req.headers.host}

Endpoints:
- GET /sse - SSE connection
- POST /message - Message handling
- GET /health - Health check
- GET /oauth/discord/start - Generate OAuth install URL
- GET /oauth/discord/callback - OAuth callback handler

Active connections: ${activeTransports.size}`);
                    }
                } catch (error) {
                    console.error("HTTP request error:", error);
                    res.writeHead(500, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ error: "Internal server error" }));
                }
                },
            );

            httpServer.listen(port, () => {
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
            });
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
