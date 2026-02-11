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
import { Logger } from "./core/Logger.js";
import { OAuthManager } from "./core/OAuthManager.js";
import { writeAuditEvent } from "./gateway/audit-log.js";
import {
    getDiscordPackageSymbolsCatalog,
    listLoadedDiscordRuntimePackages,
    type DiscordJsSymbol,
} from "./gateway/discordjs-symbol-catalog.js";
import { createHttpApp } from "./http-app.js";
import {
    DISCORD_EXEC_BATCH_OPERATION,
    DISCORD_EXEC_INVOKE_OPERATION,
    DISCORD_META_PACKAGES_OPERATION,
    DISCORD_META_PREFLIGHT_OPERATION,
    DISCORD_META_SYMBOLS_OPERATION,
    DOMAIN_METHODS,
    getDomainMethodForOperation,
    isDiscordExecBatchOperation,
    isDiscordExecInvokeOperation,
    isDiscordMetaPackagesOperation,
    isDiscordMetaPreflightOperation,
    isDiscordMetaSymbolsOperation,
    isDiscordWriteOperation,
    resolveDomainMethod,
    resolveOperation,
    resolveOperationForMethod,
    type DiscordOperation,
    type DomainMethod,
} from "./gateway/domain-registry.js";
import { IdentityWorkerPool } from "./gateway/identity-worker-pool.js";
import {
    LocalEncryptedIdentityStore,
    type IdentityMode,
} from "./identity/local-encrypted-identity-store.js";
import {
    recordDiscordOperationMetric,
    recordRequestMetric,
    withSpan,
} from "./observability/telemetry.js";
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
const logger = Logger.getInstance().child("server");

type RiskTier = "low" | "medium" | "high";

type ParsedDiscordManageCall = {
    mode: IdentityMode;
    identityId: string;
    method: DomainMethod;
    operation: DiscordOperation;
    params: Record<string, unknown>;
    riskTier: RiskTier;
};

type GenericSchema = {
    parse: (value: unknown) => unknown;
    shape?:
        | Record<string, unknown>
        | (() => Record<string, unknown>);
    _def?: {
        shape?: () => Record<string, unknown>;
    };
};

const OPERATION_SCHEMA_BY_NAME: Record<string, GenericSchema> = {
    [DISCORD_META_PACKAGES_OPERATION]:
        schemas.DiscordMetaPackagesSchema as unknown as GenericSchema,
    [DISCORD_META_SYMBOLS_OPERATION]:
        schemas.DiscordMetaSymbolsSchema as unknown as GenericSchema,
    [DISCORD_META_PREFLIGHT_OPERATION]:
        schemas.DiscordMetaPreflightSchema as unknown as GenericSchema,
    [DISCORD_EXEC_INVOKE_OPERATION]:
        schemas.DiscordExecInvokeSchema as unknown as GenericSchema,
    [DISCORD_EXEC_BATCH_OPERATION]:
        schemas.DiscordExecBatchSchema as unknown as GenericSchema,
};

function getOAuthManager(): OAuthManager {
    if (!oauthManager) {
        throw new Error("OAuth manager is not initialized.");
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

async function initializeDiscord() {
    discordController = new DiscordController();
    await discordController.initialize();
    discordService = discordController.getDiscordService();
}

function getSchemaForOperation(operation: DiscordOperation): GenericSchema {
    const schema = OPERATION_SCHEMA_BY_NAME[operation];
    if (!schema) {
        throw new Error(`No schema is registered for operation '${operation}'.`);
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
        `discord_manage operation '${operationLabel}' requires 'params' or 'args' as an object or array.`,
    );
}

function coerceOperationArgs(
    rawArgs: unknown,
    operation: DiscordOperation,
): Record<string, unknown> {
    const schema = getSchemaForOperation(operation);
    const paramKeys = getSchemaKeyOrder(schema);
    return coerceArgsToParams(rawArgs, paramKeys, operation);
}

function normalizeParamsBySchemaOrder(
    operation: DiscordOperation,
    params: Record<string, unknown>,
): Record<string, unknown> {
    const schemaKeys = getSchemaKeyOrder(getSchemaForOperation(operation));
    const ordered: Record<string, unknown> = {};
    const knownKeys = new Set<string>();

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

function inferRiskTier(
    operation: DiscordOperation,
    params: Record<string, unknown>,
): RiskTier {
    if (!isDiscordWriteOperation(operation)) {
        return "low";
    }

    if (isDiscordExecInvokeOperation(operation)) {
        const dryRun = params.dryRun;
        return dryRun === false ? "high" : "medium";
    }

    if (isDiscordExecBatchOperation(operation)) {
        const dryRun = params.dryRun;
        return dryRun === false ? "high" : "medium";
    }

    return "high";
}

function enforceOperationPolicy(
    mode: IdentityMode,
    operation: DiscordOperation,
    params: Record<string, unknown>,
): RiskTier {
    if (mode === "user" && isDiscordWriteOperation(operation)) {
        throw new Error(
            `Operation '${operation}' is blocked for user mode. Use bot mode for this operation.`,
        );
    }

    const riskTier = inferRiskTier(operation, params);
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
            "discord_manage arguments must be an object with 'mode', 'identityId', 'operation', and 'params' or 'args'.",
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

    if (typeof rawOperation !== "string") {
        throw new Error("discord_manage requires 'operation' as a string.");
    }

    if (rawParams === undefined && rawMethodArgs === undefined) {
        throw new Error(
            "discord_manage requires either 'params' (recommended) or 'args'.",
        );
    }

    const operation = resolveOperation(rawOperation);

    let method: DomainMethod;
    if (typeof rawMethod === "string" && rawMethod.trim()) {
        method = resolveDomainMethod(rawMethod);
        resolveOperationForMethod(method, operation);
    } else {
        method = getDomainMethodForOperation(operation);
    }

    const baseParams =
        rawParams !== undefined
            ? coerceOperationArgs(rawParams, operation)
            : coerceOperationArgs(rawMethodArgs, operation);
    const normalizedParams = normalizeParamsBySchemaOrder(operation, baseParams);
    const parsedParams = getSchemaForOperation(operation).parse(
        normalizedParams,
    ) as Record<string, unknown>;

    const riskTier = enforceOperationPolicy(mode, operation, parsedParams);

    return {
        mode,
        identityId,
        method,
        operation,
        params: parsedParams,
        riskTier,
    };
}

function parseJsonMaybe(payload: string): unknown {
    try {
        return JSON.parse(payload) as unknown;
    } catch {
        return payload;
    }
}

function toPolicyRiskTier(behaviorClass: string): RiskTier {
    switch (behaviorClass) {
        case "dangerous":
        case "admin":
            return "high";
        case "write":
            return "medium";
        default:
            return "low";
    }
}

function inferInvocationTargetMode(symbol: DiscordJsSymbol): string {
    if (symbol.name.includes("#")) {
        return "instance";
    }
    if (symbol.name.includes(".")) {
        return "static";
    }
    return "export";
}

function inferDefaultStatus(symbol: DiscordJsSymbol): string {
    if (!symbol.invokable && symbol.origin === "types") {
        return "types_only";
    }

    if (symbol.kind !== "function" || !symbol.invokable) {
        return "metadata_only";
    }

    if (
        symbol.behaviorClass === "write" ||
        symbol.behaviorClass === "admin" ||
        symbol.behaviorClass === "dangerous"
    ) {
        return "blocked_by_policy_default";
    }

    return "ready";
}

function toOperationalMatrix(symbol: DiscordJsSymbol): Record<string, unknown> {
    const requiresAllowWrite =
        symbol.behaviorClass === "write" ||
        symbol.behaviorClass === "admin" ||
        symbol.behaviorClass === "dangerous";

    return {
        identity: {
            packageAlias: symbol.packageAlias,
            packageName: symbol.packageName,
            moduleVersion: symbol.moduleVersion,
            name: symbol.name,
            kind: symbol.kind,
            origin: symbol.origin,
        },
        callability: {
            invokable: symbol.invokable,
            invocationMode: inferInvocationTargetMode(symbol),
            hasRuntimeBinding: symbol.origin === "runtime",
        },
        operation: {
            operationClass: symbol.behaviorClass,
            riskTier: toPolicyRiskTier(symbol.behaviorClass),
            policyDefault: "strict",
        },
        requirements: {
            requiresAllowWrite,
            requiredTarget:
                symbol.kind === "function" ? inferInvocationTargetMode(symbol) : "none",
            requiredContext:
                symbol.kind === "function" && symbol.name.includes("#")
                    ? ["target/context"]
                    : [],
        },
        executionHints: {
            suggestedOperation: symbol.packageOperationKey,
            docsPath: symbol.docsPath,
            aliasOf: symbol.aliasOf,
        },
        status: inferDefaultStatus(symbol),
    };
}

function getAllTools() {
    return [
        {
            name: "discord_manage",
            description:
                "Discord runtime control surface. Operations: discord.meta.packages, discord.meta.symbols, discord.meta.preflight, discord.exec.invoke, discord.exec.batch",
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
                        description:
                            "Optional method override. If provided, operation/method compatibility is validated.",
                    },
                    operation: {
                        type: "string",
                        enum: [
                            DISCORD_META_PACKAGES_OPERATION,
                            DISCORD_META_SYMBOLS_OPERATION,
                            DISCORD_META_PREFLIGHT_OPERATION,
                            DISCORD_EXEC_INVOKE_OPERATION,
                            DISCORD_EXEC_BATCH_OPERATION,
                        ],
                        description:
                            "Operation key from the unified Discord runtime protocol.",
                    },
                    params: {
                        type: "object",
                        description: "Named operation parameters (recommended).",
                        additionalProperties: true,
                    },
                    args: {
                        type: ["array", "object"],
                        description:
                            "Ordered args array (mapped to schema order) or keyed args object.",
                        additionalProperties: true,
                    },
                    context: {
                        type: "object",
                        description: "Optional request metadata for tracing/idempotency.",
                        additionalProperties: true,
                    },
                },
                required: ["operation"],
                additionalProperties: false,
            },
        },
    ];
}

async function executeBatchOperation(
    params: Record<string, unknown>,
): Promise<string> {
    const parsed = schemas.DiscordExecBatchSchema.parse(params);
    const mode = parsed.mode ?? "best_effort";
    const defaultDryRun = parsed.dryRun ?? true;
    const normalizedItems = parsed.items.map((item) => ({
        ...item,
        invoke: item.invoke ?? true,
        dryRun: item.dryRun ?? defaultDryRun,
        allowWrite: item.allowWrite ?? false,
    }));

    if (mode === "all_or_none" && normalizedItems.some((item) => item.dryRun === false)) {
        const preflights = [] as Array<Record<string, unknown>>;
        let blocked = false;

        for (let index = 0; index < normalizedItems.length; index += 1) {
            const item = normalizedItems[index];
            const preflightRaw = await discordService.invokeDiscordJsSymbol({
                packageAlias: item.packageAlias,
                symbol: item.symbol,
                kind: item.kind,
                invoke: item.invoke,
                dryRun: true,
                allowWrite: item.allowWrite,
                policyMode: item.policyMode,
                args: item.args,
                target: item.target,
                context: item.context,
            });
            const preflightParsed = parseJsonMaybe(preflightRaw);
            const canExecute =
                typeof preflightParsed === "object" &&
                preflightParsed !== null &&
                (preflightParsed as Record<string, unknown>).callable === true &&
                (preflightParsed as Record<string, unknown>).policyDecision === "allow";

            if (!canExecute) {
                blocked = true;
            }

            preflights.push({
                index,
                canExecute,
                preflight: preflightParsed,
            });
        }

        if (blocked) {
            return JSON.stringify(
                {
                    mode,
                    executed: false,
                    reason: "Preflight failed for one or more batch items.",
                    preflights,
                },
                null,
                2,
            );
        }
    }

    const results: Array<Record<string, unknown>> = [];
    let successCount = 0;
    let errorCount = 0;

    for (let index = 0; index < normalizedItems.length; index += 1) {
        const item = normalizedItems[index];
        try {
            const raw = await discordService.invokeDiscordJsSymbol({
                packageAlias: item.packageAlias,
                symbol: item.symbol,
                kind: item.kind,
                invoke: item.invoke,
                dryRun: item.dryRun,
                allowWrite: item.allowWrite,
                policyMode: item.policyMode,
                args: item.args,
                target: item.target,
                context: item.context,
            });

            results.push({
                index,
                status: "success",
                dryRun: item.dryRun,
                result: parseJsonMaybe(raw),
            });
            successCount += 1;
        } catch (error) {
            results.push({
                index,
                status: "error",
                dryRun: item.dryRun,
                error: error instanceof Error ? error.message : String(error),
            });
            errorCount += 1;

            if (mode === "all_or_none") {
                break;
            }
        }
    }

    return JSON.stringify(
        {
            mode,
            total: normalizedItems.length,
            successCount,
            errorCount,
            results,
        },
        null,
        2,
    );
}

async function executeDiscordManageOperation(
    parsedCall: ParsedDiscordManageCall,
): Promise<string> {
    const { operation, params } = parsedCall;
    const startedAt = Date.now();
    let status: "success" | "error" = "success";
    const operationType = isDiscordWriteOperation(operation)
        ? "execution"
        : "metadata";

    try {
        return await withSpan(
            "discord_manage.execute",
            {
                "discord.mode": parsedCall.mode,
                "discord.method": parsedCall.method,
                "discord.operation": parsedCall.operation,
                "discord.operation_type": operationType,
                "discord.identity_id": parsedCall.identityId,
            },
            async () => {
                if (isDiscordMetaPackagesOperation(operation)) {
                    const parsed = schemas.DiscordMetaPackagesSchema.parse(params);
                    const allPackages = await listLoadedDiscordRuntimePackages();
                    const selectors = [
                        ...(parsed.package ? [parsed.package] : []),
                        ...(parsed.packages || []),
                    ];
                    if (selectors.length === 0) {
                        return JSON.stringify(
                            {
                                package: "discord.packages",
                                packageCount: allPackages.length,
                                packages: allPackages,
                            },
                            null,
                            2,
                        );
                    }

                    const normalizedSelectors = selectors.map((selector) =>
                        selector.trim().toLowerCase(),
                    );
                    const filteredPackages = allPackages.filter(
                        (entry) =>
                            normalizedSelectors.includes(entry.packageAlias) ||
                            normalizedSelectors.includes(entry.packageName.toLowerCase()),
                    );

                    return JSON.stringify(
                        {
                            package: "discord.packages",
                            packageCount: filteredPackages.length,
                            packages: filteredPackages,
                        },
                        null,
                        2,
                    );
                }

                if (isDiscordMetaSymbolsOperation(operation)) {
                    const parsed = schemas.DiscordMetaSymbolsSchema.parse(params);
                    const packageSelector = parsed.packageAlias || parsed.package;
                    const includeOperationalMatrix =
                        parsed.includeOperationalMatrix ?? true;

                    const catalog = await getDiscordPackageSymbolsCatalog({
                        kinds: parsed.kinds,
                        query: parsed.query,
                        page: parsed.page,
                        pageSize: parsed.pageSize,
                        sort: parsed.sort,
                        includeKindCounts: parsed.includeKindCounts,
                        package: packageSelector,
                        packages: parsed.packages,
                        includeAliases: parsed.includeAliases,
                    });

                    const items = includeOperationalMatrix
                        ? catalog.items.map((item) => ({
                              ...item,
                              operationalMatrix: toOperationalMatrix(item),
                          }))
                        : catalog.items;

                    return JSON.stringify(
                        {
                            ...catalog,
                            items,
                        },
                        null,
                        2,
                    );
                }

                if (isDiscordMetaPreflightOperation(operation)) {
                    const parsed = schemas.DiscordMetaPreflightSchema.parse(params);
                    const preflightRaw = await discordService.invokeDiscordJsSymbol({
                        packageAlias: parsed.packageAlias,
                        symbol: parsed.symbol,
                        kind: parsed.kind,
                        invoke: true,
                        dryRun: true,
                        allowWrite: parsed.allowWrite ?? false,
                        policyMode: parsed.policyMode,
                        args: parsed.args,
                        target: parsed.target,
                        context: parsed.context,
                    });
                    const preflightResult = parseJsonMaybe(preflightRaw);
                    if (typeof preflightResult === "object" && preflightResult !== null) {
                        const record = preflightResult as Record<string, unknown>;
                        const canExecute =
                            record.callable === true &&
                            record.policyDecision === "allow";
                        return JSON.stringify(
                            {
                                ...record,
                                canExecute,
                            },
                            null,
                            2,
                        );
                    }

                    return JSON.stringify(
                        {
                            canExecute: false,
                            result: preflightResult,
                        },
                        null,
                        2,
                    );
                }

                if (isDiscordExecInvokeOperation(operation)) {
                    const parsed = schemas.DiscordExecInvokeSchema.parse(params);
                    return await discordService.invokeDiscordJsSymbol({
                        packageAlias: parsed.packageAlias,
                        symbol: parsed.symbol,
                        kind: parsed.kind,
                        invoke: parsed.invoke ?? true,
                        dryRun: parsed.dryRun ?? true,
                        allowWrite: parsed.allowWrite ?? false,
                        policyMode: parsed.policyMode,
                        args: parsed.args,
                        target: parsed.target,
                        context: parsed.context,
                    });
                }

                if (isDiscordExecBatchOperation(operation)) {
                    return await executeBatchOperation(params);
                }

                throw new Error(`Unsupported operation: ${operation}`);
            },
        );
    } catch (error) {
        status = "error";
        throw error;
    } finally {
        recordDiscordOperationMetric(
            {
                "discord.layer": "router",
                "discord.mode": parsedCall.mode,
                "discord.method": parsedCall.method,
                "discord.operation": parsedCall.operation,
                "discord.operation_type": operationType,
                "discord.risk_tier": parsedCall.riskTier,
                "discord.status": status,
            },
            Date.now() - startedAt,
        );
    }
}

server.setRequestHandler(ListToolsRequestSchema, async () => {
    const startedAt = Date.now();
    let status: "success" | "error" = "success";
    try {
        return await withSpan(
            "mcp.tools.list",
            { "mcp.transport": "stdio" },
            async () => ({
                tools: getAllTools(),
            }),
        );
    } catch (error) {
        status = "error";
        throw error;
    } finally {
        recordRequestMetric(
            {
                "mcp.transport": "stdio",
                "mcp.method": "tools/list",
                "mcp.status": status,
            },
            Date.now() - startedAt,
        );
    }
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const startedAt = Date.now();
    let status: "success" | "error" = "success";
    try {
        return await withSpan(
            "mcp.tools.call",
            {
                "mcp.transport": "stdio",
                "mcp.tool_name":
                    typeof request.params.name === "string"
                        ? request.params.name
                        : "unknown",
            },
            async () => {
                const parsedCall = parseDiscordManageCall(
                    request.params.name,
                    request.params.arguments,
                );
                const operationStartedAt = Date.now();

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
                        durationMs: Date.now() - operationStartedAt,
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
                        durationMs: Date.now() - operationStartedAt,
                        error: error instanceof Error ? error.message : String(error),
                    });
                    throw error;
                }
            },
        );
    } catch (error) {
        status = "error";
        const errorMessage =
            error instanceof Error ? error.message : String(error);
        return {
            content: [{ type: "text", text: `Error: ${errorMessage}` }],
            isError: true,
        };
    } finally {
        recordRequestMetric(
            {
                "mcp.transport": "stdio",
                "mcp.method": "tools/call",
                "mcp.status": status,
            },
            Date.now() - startedAt,
        );
    }
});

async function main() {
    try {
        await initializeDiscord();
        identityStore.ensureDefaultsFromEnv();
        const runtimePackages = await listLoadedDiscordRuntimePackages();
        logger.info(
            `Runtime packages loaded: ${runtimePackages.map((entry) => `${entry.packageAlias}@${entry.version}`).join(", ")}`,
        );

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

            try {
                const startupInvite = await oauthManager.createAuthorizeLink({
                    guildId: config.oauth.defaultGuildId,
                });
                logger.info(
                    `Discord bot install URL (Administrator): ${startupInvite.authorizeUrl}`,
                );
                logger.info(`OAuth callback URI: ${config.oauth.redirectUri}`);
            } catch (error) {
                const message =
                    error instanceof Error ? error.message : String(error);
                logger.warn(`OAuth startup install link unavailable: ${message}`);
            }

            if (missingOAuthConfig.length > 0) {
                logger.warn(
                    `OAuth callback flow is partially configured. Missing: ${missingOAuthConfig.join(", ")}`,
                );
                logger.warn(
                    "Server startup will continue so HTTP routes remain available.",
                );
            }
        } else {
            logger.info(
                "OAuth startup install link skipped: HTTP mode is disabled (set MCP_HTTP_PORT to enable callback flow).",
            );
        }

        if (useHttp) {
            const httpPort = Number.parseInt(useHttp, 10) || 3000;
            const port = httpPort;
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
            });
            serve({ fetch: app.fetch, port });

            logger.info(`Discord MCP server running on HTTP port ${port}`);
            logger.info(`SSE endpoint: http://localhost:${port}/sse`);
            logger.info(`Health check: http://localhost:${port}/health`);
            logger.info(`OAuth start: http://localhost:${port}/oauth/discord/start`);
            logger.info(
                `OAuth callback: http://localhost:${port}/oauth/discord/callback`,
            );
        } else {
            const transport = new StdioServerTransport();
            await server.connect(transport);
            logger.info("Discord MCP server running on stdio");
        }
    } catch (error) {
        logger.error("Failed to start Discord MCP server", error);
        process.exit(1);
    }
}

process.on("SIGINT", async () => {
    logger.info("Shutting down Discord MCP server...");
    if (discordService) {
        await discordService.destroy();
    }
    process.exit(0);
});

process.on("SIGTERM", async () => {
    logger.info("Shutting down Discord MCP server...");
    if (discordService) {
        await discordService.destroy();
    }
    process.exit(0);
});

main().catch((error) => {
    logger.error("Fatal error", error);
    process.exit(1);
});
