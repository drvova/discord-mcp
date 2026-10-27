import { createHash } from "node:crypto";
import type { AnyZodObject } from "zod";
import type { DiscordService } from "../discord-service.js";
import { Logger } from "../core/Logger.js";
import {
    getDiscordCatalogMetadata,
    getDiscordPackageSymbolsCatalog,
    listLoadedDiscordRuntimePackages,
    refreshDiscordRuntimeCatalog,
    type DiscordJsSymbol,
} from "./discordjs-symbol-catalog.js";
import {
    DISCORD_EXEC_BATCH_OPERATION,
    DISCORD_EXEC_INVOKE_OPERATION,
    DISCORD_META_PACKAGES_OPERATION,
    DISCORD_META_PREFLIGHT_OPERATION,
    DISCORD_META_REFRESH_OPERATION,
    DISCORD_META_SYMBOLS_OPERATION,
    getDomainMethodForOperation,
    isDiscordExecBatchOperation,
    isDiscordExecInvokeOperation,
    isDiscordMetaPackagesOperation,
    isDiscordMetaPreflightOperation,
    isDiscordMetaRefreshOperation,
    isDiscordMetaSymbolsOperation,
    isDiscordWriteOperation,
    resolveOperation,
    type DiscordOperation,
    type DomainMethod,
} from "./domain-registry.js";
import type { IdentityMode } from "../identity/local-encrypted-identity-store.js";
import {
    recordDiscordOperationMetric,
    withSpan,
} from "../observability/telemetry.js";
import * as schemas from "../types.js";

// The pre-existing per-operation capability code. It is not registered as an
// MCP tool; the `run` tool reaches it from code as `ops.<name>(params)`.

let discordService: DiscordService;
const logger = Logger.getInstance().child("discord-operations");

export function bindDiscordOperationsService(service: DiscordService): void {
    discordService = service;
}

export type RiskTier = "low" | "medium" | "high";

export type PreparedDiscordOperation = {
    mode: IdentityMode;
    identityId: string;
    method: DomainMethod;
    operation: DiscordOperation;
    params: Record<string, unknown>;
    riskTier: RiskTier;
};

export type PreflightEvaluation = {
    payload: Record<string, unknown>;
    canExecute: boolean;
    blockingReasons: string[];
    preflightToken: string;
};

const OPERATION_SCHEMA_BY_NAME: Record<DiscordOperation, AnyZodObject> = {
    [DISCORD_META_PACKAGES_OPERATION]: schemas.DiscordMetaPackagesSchema,
    [DISCORD_META_SYMBOLS_OPERATION]: schemas.DiscordMetaSymbolsSchema,
    [DISCORD_META_PREFLIGHT_OPERATION]: schemas.DiscordMetaPreflightSchema,
    [DISCORD_META_REFRESH_OPERATION]: schemas.DiscordMetaRefreshSchema,
    [DISCORD_EXEC_INVOKE_OPERATION]: schemas.DiscordExecInvokeSchema,
    [DISCORD_EXEC_BATCH_OPERATION]: schemas.DiscordExecBatchSchema,
};

function getSchemaForOperation(operation: DiscordOperation): AnyZodObject {
    const schema = OPERATION_SCHEMA_BY_NAME[operation];
    if (!schema) {
        throw new Error(`No schema is registered for operation '${operation}'.`);
    }
    return schema;
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

// Validates an ops.<name>(params) call against its schema and the identity
// policy (no writes in user mode; DISCORD_MCP_BLOCK_HIGH_RISK).
export function prepareDiscordOperation(input: {
    mode: IdentityMode;
    identityId: string;
    operation: string;
    params?: Record<string, unknown>;
}): PreparedDiscordOperation {
    const operation = resolveOperation(input.operation);
    const params = getSchemaForOperation(operation).parse(
        input.params ?? {},
    ) as Record<string, unknown>;

    return {
        mode: input.mode,
        identityId: input.identityId,
        method: getDomainMethodForOperation(operation),
        operation,
        params,
        riskTier: enforceOperationPolicy(input.mode, operation, params),
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
            suggestedOperation: symbol.operationKey,
            suggestedParams:
                symbol.kind === "function"
                    ? {
                          packageAlias: symbol.packageAlias,
                          symbol: symbol.name,
                          kind: symbol.kind,
                      }
                    : {
                          packageAlias: symbol.packageAlias,
                          kinds: [symbol.kind],
                          query: symbol.name,
                      },
            docsPath: symbol.docsPath,
            aliasOf: symbol.aliasOf,
        },
        status: inferDefaultStatus(symbol),
    };
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

export async function executeDiscordOperation(
    parsedCall: PreparedDiscordOperation,
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
            "discord.operation.execute",
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
                    const catalogMetadata = await getDiscordCatalogMetadata();
                    const allPackages = await listLoadedDiscordRuntimePackages();
                    const selectors = [
                        ...(parsed.package ? [parsed.package] : []),
                        ...(parsed.packages || []),
                    ];
                    if (selectors.length === 0) {
                        return JSON.stringify(
                            {
                                package: "discord.packages",
                                catalogFingerprint:
                                    catalogMetadata.catalogFingerprint,
                                catalogBuiltAt: catalogMetadata.catalogBuiltAt,
                                isFresh: catalogMetadata.isFresh,
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
                            catalogFingerprint:
                                catalogMetadata.catalogFingerprint,
                            catalogBuiltAt: catalogMetadata.catalogBuiltAt,
                            isFresh: catalogMetadata.isFresh,
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

                if (isDiscordMetaRefreshOperation(operation)) {
                    const parsed = schemas.DiscordMetaRefreshSchema.parse(params);
                    const refreshResult = await refreshDiscordRuntimeCatalog({
                        force: parsed.force ?? true,
                        includeDiff: parsed.includeDiff ?? true,
                    });
                    return JSON.stringify(
                        {
                            package: "discord.packages",
                            catalogFingerprint:
                                refreshResult.catalogFingerprint,
                            catalogBuiltAt: refreshResult.catalogBuiltAt,
                            isFresh: refreshResult.isFresh,
                            didRebuild: refreshResult.didRebuild,
                            packageCount: refreshResult.packageCount,
                            symbolCount: refreshResult.symbolCount,
                            changedPackages: refreshResult.changedPackages,
                            addedSymbols: refreshResult.addedSymbols,
                            removedSymbols: refreshResult.removedSymbols,
                            kindCountsDelta: refreshResult.kindCountsDelta,
                        },
                        null,
                        2,
                    );
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

export async function runDiscordOperation(input: {
    mode: IdentityMode;
    identityId: string;
    operation: string;
    params?: Record<string, unknown>;
}): Promise<unknown> {
    return parseJsonMaybe(
        await executeDiscordOperation(prepareDiscordOperation(input)),
    );
}
