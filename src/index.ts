#!/usr/bin/env node
import "dotenv/config";
import { createHash } from "node:crypto";
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

const LEGACY_DISCORDJS_DISCOVERY_OPERATION = "discordjs.meta.symbols";
const LEGACY_DISCORDPKG_DISCOVERY_OPERATION = "discordpkg.meta.symbols";
const LEGACY_DISCORDJS_INVOKE_PATTERN = /^discordjs\.([^.]+)\.(.+)$/i;
const LEGACY_DISCORDPKG_INVOKE_PATTERN = /^discordpkg\.([^.]+)\.([^.]+)\.(.+)$/i;

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
    compatTranslated: boolean;
    translatedFromOperation?: string;
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

type LegacyTranslation = {
    operationCandidate: string;
    injectedParams: Record<string, unknown>;
    treatArrayAsInvokeArgs: boolean;
    translatedFromOperation: string;
};

type PreflightEvaluation = {
    payload: Record<string, unknown>;
    canExecute: boolean;
    blockingReasons: string[];
    preflightToken: string;
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

function coerceLegacyPayload(rawPayload: unknown): Record<string, unknown> {
    if (Array.isArray(rawPayload)) {
        return { args: rawPayload };
    }

    if (rawPayload && typeof rawPayload === "object") {
        return rawPayload as Record<string, unknown>;
    }

    throw new Error(
        "Legacy dynamic operations require payload as object or array.",
    );
}

function decodeOperationSymbol(encodedSymbol: string): string {
    try {
        return decodeURIComponent(encodedSymbol);
    } catch {
        return encodedSymbol;
    }
}

function normalizeLegacyKindToken(rawKind: string): string {
    const normalized = rawKind.trim().toLowerCase();
    switch (normalized) {
        case "classes":
            return "class";
        case "functions":
            return "function";
        case "enums":
            return "enum";
        case "interfaces":
            return "interface";
        case "types":
            return "type";
        case "variables":
            return "variable";
        case "constants":
        case "consts":
            return "const";
        default:
            return normalized;
    }
}

function translateLegacyOperation(
    rawOperation: string,
): LegacyTranslation | null {
    const normalized = rawOperation.trim();
    const lower = normalized.toLowerCase();

    if (lower === LEGACY_DISCORDJS_DISCOVERY_OPERATION) {
        return {
            operationCandidate: DISCORD_META_SYMBOLS_OPERATION,
            injectedParams: { packageAlias: "discordjs" },
            treatArrayAsInvokeArgs: false,
            translatedFromOperation: normalized,
        };
    }

    if (lower === LEGACY_DISCORDPKG_DISCOVERY_OPERATION) {
        return {
            operationCandidate: DISCORD_META_SYMBOLS_OPERATION,
            injectedParams: {},
            treatArrayAsInvokeArgs: false,
            translatedFromOperation: normalized,
        };
    }

    const discordJsInvokeMatch = normalized.match(LEGACY_DISCORDJS_INVOKE_PATTERN);
    if (discordJsInvokeMatch) {
        const rawKind = normalizeLegacyKindToken(discordJsInvokeMatch[1]);
        const encodedSymbol = discordJsInvokeMatch[2];
        if (rawKind === "meta") {
            return {
                operationCandidate: DISCORD_META_SYMBOLS_OPERATION,
                injectedParams: { packageAlias: "discordjs" },
                treatArrayAsInvokeArgs: false,
                translatedFromOperation: normalized,
            };
        }

        return {
            operationCandidate: DISCORD_EXEC_INVOKE_OPERATION,
            injectedParams: {
                packageAlias: "discordjs",
                kind: rawKind,
                symbol: decodeOperationSymbol(encodedSymbol),
                invoke: rawKind === "function",
            },
            treatArrayAsInvokeArgs: true,
            translatedFromOperation: normalized,
        };
    }

    const discordPkgInvokeMatch = normalized.match(LEGACY_DISCORDPKG_INVOKE_PATTERN);
    if (discordPkgInvokeMatch) {
        const packageAlias = discordPkgInvokeMatch[1].trim().toLowerCase();
        const rawKind = normalizeLegacyKindToken(discordPkgInvokeMatch[2]);
        const encodedSymbol = discordPkgInvokeMatch[3];

        if (packageAlias === "meta" || rawKind === "meta") {
            return {
                operationCandidate: DISCORD_META_SYMBOLS_OPERATION,
                injectedParams: {},
                treatArrayAsInvokeArgs: false,
                translatedFromOperation: normalized,
            };
        }

        return {
            operationCandidate: DISCORD_EXEC_INVOKE_OPERATION,
            injectedParams: {
                packageAlias,
                kind: rawKind,
                symbol: decodeOperationSymbol(encodedSymbol),
                invoke: rawKind === "function",
            },
            treatArrayAsInvokeArgs: true,
            translatedFromOperation: normalized,
        };
    }

    return null;
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

    const rawPayload = rawParams !== undefined ? rawParams : rawMethodArgs;
    const translation = translateLegacyOperation(rawOperation);

    const operationCandidate = translation
        ? translation.operationCandidate
        : rawOperation;
    const operation = resolveOperation(operationCandidate);

    let method: DomainMethod;
    if (typeof rawMethod === "string" && rawMethod.trim()) {
        method = resolveDomainMethod(rawMethod);
        resolveOperationForMethod(method, operation);
    } else {
        method = getDomainMethodForOperation(operation);
    }

    let baseParams: Record<string, unknown>;
    if (translation?.treatArrayAsInvokeArgs) {
        baseParams = coerceLegacyPayload(rawPayload);
    } else {
        baseParams = coerceOperationArgs(rawPayload, operation);
    }

    if (translation) {
        baseParams = {
            ...baseParams,
            ...translation.injectedParams,
        };
    }

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
        compatTranslated: Boolean(translation),
        translatedFromOperation: translation?.translatedFromOperation,
    };
}

function parseJsonMaybe(payload: string): unknown {
    try {
        return JSON.parse(payload) as unknown;
    } catch {
        return payload;
    }
}

function stableSerialize(value: unknown): string {
    if (value === null || value === undefined) {
        return "null";
    }

    if (typeof value !== "object") {
        return JSON.stringify(value);
    }

    if (Array.isArray(value)) {
        return `[${value.map((item) => stableSerialize(item)).join(",")}]`;
    }

    const objectValue = value as Record<string, unknown>;
    const keys = Object.keys(objectValue).sort((a, b) => a.localeCompare(b));
    const pairs = keys.map((key) => `${JSON.stringify(key)}:${stableSerialize(objectValue[key])}`);
    return `{${pairs.join(",")}}`;
}

function buildPreflightToken(input: {
    packageAlias: string;
    symbol: string;
    kind?: string;
    target?: unknown;
    context?: unknown;
    args?: unknown;
    allowWrite?: unknown;
    policyMode?: unknown;
}): string {
    const digest = createHash("sha256")
        .update(stableSerialize(input))
        .digest("hex");
    return `pf_${digest.slice(0, 40)}`;
}

function toNumber(value: unknown): number {
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
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

function buildResponseWithMetadata(
    payload: unknown,
    metadata: Record<string, unknown>,
): string {
    if (payload && typeof payload === "object" && !Array.isArray(payload)) {
        return JSON.stringify(
            {
                ...(payload as Record<string, unknown>),
                ...metadata,
            },
            null,
            2,
        );
    }

    return JSON.stringify(
        {
            result: payload,
            ...metadata,
        },
        null,
        2,
    );
}

async function evaluatePreflight(input: {
    packageAlias: string;
    symbol: string;
    kind?:
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
    target?:
        | "auto"
        | "client"
        | "guild"
        | "channel"
        | "thread"
        | "message"
        | "user"
        | "member"
        | "role"
        | "emoji"
        | "sticker"
        | "event"
        | "invite"
        | "webhook"
        | "guild_manager"
        | "channel_manager"
        | "user_manager"
        | "member_manager"
        | "role_manager"
        | "emoji_manager"
        | "sticker_manager"
        | "scheduled_event_manager"
        | "message_manager"
        | "thread_manager"
        | "application_command_manager"
        | "application_emoji_manager";
    context?: Record<string, unknown>;
    args?: unknown[];
    allowWrite?: boolean;
    policyMode?: "strict" | "permissive";
    strictContextCheck?: boolean;
    strictArgCheck?: boolean;
}): Promise<PreflightEvaluation> {
    const strictContextCheck = input.strictContextCheck ?? true;
    const strictArgCheck = input.strictArgCheck ?? false;
    const preflightToken = buildPreflightToken({
        packageAlias: input.packageAlias,
        symbol: input.symbol,
        kind: input.kind,
        target: input.target,
        context: input.context,
        args: input.args,
        allowWrite: input.allowWrite,
        policyMode: input.policyMode,
    });

    const preflightRaw = await discordService.invokeDiscordJsSymbol({
        packageAlias: input.packageAlias,
        symbol: input.symbol,
        kind: input.kind,
        invoke: true,
        dryRun: true,
        allowWrite: input.allowWrite ?? false,
        policyMode: input.policyMode,
        args: input.args,
        target: input.target,
        context: input.context,
    });

    const parsed = parseJsonMaybe(preflightRaw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        const blockingReasons = [
            "Preflight produced a non-object payload and cannot be evaluated safely.",
        ];
        return {
            payload: {
                canExecute: false,
                blockingReasons,
                strictContextCheck,
                strictArgCheck,
                preflightToken,
                preflightResult: parsed,
            },
            canExecute: false,
            blockingReasons,
            preflightToken,
        };
    }

    const record = parsed as Record<string, unknown>;
    const blockingReasons: string[] = [];

    if (record.callable !== true) {
        blockingReasons.push(
            "Symbol is not callable for execution in the current resolution context.",
        );
    }

    if (record.policyDecision !== "allow") {
        blockingReasons.push(
            typeof record.blockedReason === "string" && record.blockedReason
                ? record.blockedReason
                : "Policy decision is not allow.",
        );
    }

    if (strictContextCheck) {
        const invocationMode =
            typeof record.invocationMode === "string"
                ? record.invocationMode
                : "metadata";
        const contextRequirements = Array.isArray(record.contextRequirements)
            ? record.contextRequirements
            : [];
        const resolvedTarget =
            record.resolvedTarget && typeof record.resolvedTarget === "object"
                ? (record.resolvedTarget as Record<string, unknown>)
                : null;
        const targetResolved =
            resolvedTarget && typeof resolvedTarget.resolved === "boolean"
                ? resolvedTarget.resolved
                : true;

        if (
            !targetResolved &&
            (invocationMode === "instance" || contextRequirements.length > 0)
        ) {
            blockingReasons.push(
                "Target/context resolution is incomplete under strictContextCheck.",
            );
        }
    }

    if (strictArgCheck) {
        const requiredArgCount = toNumber(record.requiredArgCount);
        const providedArgCount = toNumber(
            record.providedArgCount ?? record.argCount,
        );
        if (requiredArgCount > providedArgCount) {
            blockingReasons.push(
                `Provided args (${providedArgCount}) are fewer than required args (${requiredArgCount}).`,
            );
        }
    }

    const canExecute = blockingReasons.length === 0;
    return {
        payload: {
            ...record,
            strictContextCheck,
            strictArgCheck,
            canExecute,
            blockingReasons,
            preflightToken,
        },
        canExecute,
        blockingReasons,
        preflightToken,
    };
}

async function runWithConcurrency<TItem, TResult>(
    items: readonly TItem[],
    limit: number,
    worker: (item: TItem, index: number) => Promise<TResult>,
): Promise<TResult[]> {
    const results = new Array<TResult>(items.length);
    let nextIndex = 0;

    const runWorker = async (): Promise<void> => {
        while (true) {
            const index = nextIndex;
            nextIndex += 1;
            if (index >= items.length) {
                return;
            }
            results[index] = await worker(items[index], index);
        }
    };

    const workerCount = Math.min(limit, Math.max(items.length, 1));
    await Promise.all(
        Array.from({ length: workerCount }, () => runWorker()),
    );

    return results;
}

function getAllTools() {
    return [
        {
            name: "discord_manage",
            description:
                "Discord runtime control surface. vNext operations: discord.meta.packages, discord.meta.symbols, discord.meta.preflight, discord.exec.invoke, discord.exec.batch. Legacy discordjs/discordpkg dynamic operations are translated for compatibility.",
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
                        description:
                            "vNext operations: discord.meta.packages, discord.meta.symbols, discord.meta.preflight, discord.exec.invoke, discord.exec.batch. Legacy translations are also accepted.",
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

async function executeInvokeOperation(
    parsed: ReturnType<typeof schemas.DiscordExecInvokeSchema.parse>,
    preflightOverride?: PreflightEvaluation,
): Promise<{ raw: string; preflight?: PreflightEvaluation }> {
    const normalized = {
        packageAlias: parsed.packageAlias,
        symbol: parsed.symbol,
        kind: parsed.kind,
        invoke: parsed.invoke ?? true,
        dryRun: parsed.dryRun ?? true,
        requirePreflightPass:
            parsed.requirePreflightPass ?? (parsed.dryRun === false),
        preflightToken: parsed.preflightToken,
        allowWrite: parsed.allowWrite ?? false,
        policyMode: parsed.policyMode,
        args: parsed.args,
        target: parsed.target,
        context: parsed.context,
    };

    if (normalized.dryRun) {
        const raw = await discordService.invokeDiscordJsSymbol({
            packageAlias: normalized.packageAlias,
            symbol: normalized.symbol,
            kind: normalized.kind,
            invoke: normalized.invoke,
            dryRun: true,
            allowWrite: normalized.allowWrite,
            policyMode: normalized.policyMode,
            args: normalized.args,
            target: normalized.target,
            context: normalized.context,
        });

        return { raw };
    }

    let preflight: PreflightEvaluation | undefined;
    if (normalized.requirePreflightPass) {
        preflight =
            preflightOverride ||
            (await evaluatePreflight({
                packageAlias: normalized.packageAlias,
                symbol: normalized.symbol,
                kind: normalized.kind,
                target: normalized.target,
                context: normalized.context,
                args: normalized.args,
                allowWrite: normalized.allowWrite,
                policyMode: normalized.policyMode,
                strictContextCheck: true,
                strictArgCheck: false,
            }));

        if (
            normalized.preflightToken &&
            normalized.preflightToken !== preflight.preflightToken
        ) {
            throw new Error(
                `preflightToken mismatch for symbol '${normalized.symbol}'. Run preflight again and use the latest token.`,
            );
        }

        if (!preflight.canExecute) {
            throw new Error(
                `Preflight blocked execution for '${normalized.symbol}': ${preflight.blockingReasons.join(" | ")}`,
            );
        }
    }

    const raw = await discordService.invokeDiscordJsSymbol({
        packageAlias: normalized.packageAlias,
        symbol: normalized.symbol,
        kind: normalized.kind,
        invoke: normalized.invoke,
        dryRun: false,
        allowWrite: normalized.allowWrite,
        policyMode: normalized.policyMode,
        args: normalized.args,
        target: normalized.target,
        context: normalized.context,
    });

    return { raw, preflight };
}

async function executeBatchOperation(
    params: Record<string, unknown>,
): Promise<string> {
    const parsed = schemas.DiscordExecBatchSchema.parse(params);
    const mode = parsed.mode ?? "best_effort";
    const defaultDryRun = parsed.dryRun ?? true;
    const haltOnPolicyBlock = parsed.haltOnPolicyBlock ?? mode === "all_or_none";
    const maxParallelism = parsed.maxParallelism ?? 4;

    const normalizedItems = parsed.items.map((item) => ({
        ...item,
        invoke: item.invoke ?? true,
        dryRun: item.dryRun ?? defaultDryRun,
        requirePreflightPass:
            item.requirePreflightPass ?? (item.dryRun === false ? true : false),
        allowWrite: item.allowWrite ?? false,
    }));

    const preflights: Array<Record<string, unknown>> = [];
    const preflightByIndex = new Map<number, PreflightEvaluation>();

    if (haltOnPolicyBlock) {
        for (let index = 0; index < normalizedItems.length; index += 1) {
            const item = normalizedItems[index];
            const preflight = await evaluatePreflight({
                packageAlias: item.packageAlias,
                symbol: item.symbol,
                kind: item.kind,
                target: item.target,
                context: item.context,
                args: item.args,
                allowWrite: item.allowWrite,
                policyMode: item.policyMode,
                strictContextCheck: true,
                strictArgCheck: false,
            });
            preflightByIndex.set(index, preflight);
            preflights.push({
                index,
                canExecute: preflight.canExecute,
                blockingReasons: preflight.blockingReasons,
                preflightToken: preflight.preflightToken,
                preflight: preflight.payload,
            });
        }

        if (preflights.some((entry) => entry.canExecute !== true)) {
            return JSON.stringify(
                {
                    mode,
                    haltedOnPolicyBlock: true,
                    executed: false,
                    reason:
                        "Preflight blocked one or more batch items before execution.",
                    preflights,
                },
                null,
                2,
            );
        }
    }

    if (mode === "all_or_none") {
        const results: Array<Record<string, unknown>> = [];
        let successCount = 0;
        let errorCount = 0;

        for (let index = 0; index < normalizedItems.length; index += 1) {
            const item = normalizedItems[index];
            try {
                const { raw, preflight } = await executeInvokeOperation(
                    item,
                    preflightByIndex.get(index),
                );
                results.push({
                    index,
                    status: "success",
                    dryRun: item.dryRun,
                    result: parseJsonMaybe(raw),
                    preflightToken: preflight?.preflightToken,
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
                break;
            }
        }

        return JSON.stringify(
            {
                mode,
                haltOnPolicyBlock,
                total: normalizedItems.length,
                successCount,
                errorCount,
                results,
                ...(preflights.length > 0 ? { preflights } : {}),
            },
            null,
            2,
        );
    }

    const results = await runWithConcurrency(
        normalizedItems,
        maxParallelism,
        async (item, index) => {
            try {
                const { raw, preflight } = await executeInvokeOperation(
                    item,
                    preflightByIndex.get(index),
                );
                return {
                    index,
                    status: "success",
                    dryRun: item.dryRun,
                    result: parseJsonMaybe(raw),
                    preflightToken: preflight?.preflightToken,
                } satisfies Record<string, unknown>;
            } catch (error) {
                return {
                    index,
                    status: "error",
                    dryRun: item.dryRun,
                    error: error instanceof Error ? error.message : String(error),
                } satisfies Record<string, unknown>;
            }
        },
    );

    const successCount = results.filter((item) => item.status === "success").length;
    const errorCount = results.length - successCount;

    return JSON.stringify(
        {
            mode,
            haltOnPolicyBlock,
            maxParallelism,
            total: normalizedItems.length,
            successCount,
            errorCount,
            results,
            ...(preflights.length > 0 ? { preflights } : {}),
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
    let preflightCanExecute: boolean | undefined;
    let blockingReasonCount: number | undefined;
    let batchMode: "best_effort" | "all_or_none" | undefined;
    const operationType = isDiscordWriteOperation(operation)
        ? "execution"
        : "metadata";

    try {
        const rawResult = await withSpan(
            "discord_manage.execute",
            {
                "discord.mode": parsedCall.mode,
                "discord.method": parsedCall.method,
                "discord.operation": parsedCall.operation,
                "discord.operation_type": operationType,
                "discord.identity_id": parsedCall.identityId,
                "discord.compat_translated": String(parsedCall.compatTranslated),
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
                    const evaluation = await evaluatePreflight({
                        packageAlias: parsed.packageAlias,
                        symbol: parsed.symbol,
                        kind: parsed.kind,
                        target: parsed.target,
                        context: parsed.context,
                        args: parsed.args,
                        allowWrite: parsed.allowWrite ?? false,
                        policyMode: parsed.policyMode,
                        strictContextCheck: parsed.strictContextCheck,
                        strictArgCheck: parsed.strictArgCheck,
                    });
                    preflightCanExecute = evaluation.canExecute;
                    blockingReasonCount = evaluation.blockingReasons.length;
                    return JSON.stringify(evaluation.payload, null, 2);
                }

                if (isDiscordExecInvokeOperation(operation)) {
                    const parsed = schemas.DiscordExecInvokeSchema.parse(params);
                    const result = await executeInvokeOperation(parsed);
                    if (result.preflight) {
                        preflightCanExecute = result.preflight.canExecute;
                        blockingReasonCount = result.preflight.blockingReasons.length;
                    }
                    return result.raw;
                }

                if (isDiscordExecBatchOperation(operation)) {
                    const parsedBatch = schemas.DiscordExecBatchSchema.parse(params);
                    batchMode = parsedBatch.mode ?? "best_effort";
                    return await executeBatchOperation(params);
                }

                throw new Error(`Unsupported operation: ${operation}`);
            },
        );

        const parsedResult = parseJsonMaybe(rawResult);
        if (parsedCall.compatTranslated) {
            return buildResponseWithMetadata(parsedResult, {
                compatTranslated: true,
                translatedFromOperation: parsedCall.translatedFromOperation,
                translatedToOperation: parsedCall.operation,
            });
        }

        return rawResult;
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
                "discord.compat_translated": String(parsedCall.compatTranslated),
                ...(preflightCanExecute !== undefined
                    ? {
                          "discord.preflight.can_execute": String(
                              preflightCanExecute,
                          ),
                      }
                    : {}),
                ...(batchMode ? { "discord.batch.mode": batchMode } : {}),
            },
            Date.now() - startedAt,
        );

        if (blockingReasonCount !== undefined) {
            logger.debug("Preflight blocking reason count recorded", {
                operation: parsedCall.operation,
                blockingReasonCount,
            });
        }
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

                    writeAuditEvent({
                        identityId: parsedCall.identityId,
                        mode: parsedCall.mode,
                        method: parsedCall.method,
                        operation: parsedCall.operation,
                        riskTier: parsedCall.riskTier,
                        status: "success",
                        durationMs: Date.now() - operationStartedAt,
                        compatTranslated: parsedCall.compatTranslated,
                    });

                    return {
                        content: [{ type: "text", text: result }],
                    };
                } catch (error) {
                    writeAuditEvent({
                        identityId: parsedCall.identityId,
                        mode: parsedCall.mode,
                        method: parsedCall.method,
                        operation: parsedCall.operation,
                        riskTier: parsedCall.riskTier,
                        status: "error",
                        durationMs: Date.now() - operationStartedAt,
                        compatTranslated: parsedCall.compatTranslated,
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
