export type DiscordOperation = string;

export const DOMAIN_METHODS = ["automation.read", "automation.write"] as const;
export type DomainMethod = (typeof DOMAIN_METHODS)[number];

const METHOD_SET = new Set<string>(DOMAIN_METHODS);

export const DISCORD_META_PACKAGES_OPERATION = "discord.meta.packages";
export const DISCORD_META_SYMBOLS_OPERATION = "discord.meta.symbols";
export const DISCORD_META_PREFLIGHT_OPERATION = "discord.meta.preflight";
export const DISCORD_EXEC_INVOKE_OPERATION = "discord.exec.invoke";
export const DISCORD_EXEC_BATCH_OPERATION = "discord.exec.batch";

const VALID_OPERATIONS = new Set<string>([
    DISCORD_META_PACKAGES_OPERATION,
    DISCORD_META_SYMBOLS_OPERATION,
    DISCORD_META_PREFLIGHT_OPERATION,
    DISCORD_EXEC_INVOKE_OPERATION,
    DISCORD_EXEC_BATCH_OPERATION,
]);

const READ_OPERATION_SET = new Set<string>([
    DISCORD_META_PACKAGES_OPERATION,
    DISCORD_META_SYMBOLS_OPERATION,
    DISCORD_META_PREFLIGHT_OPERATION,
]);

const WRITE_OPERATION_SET = new Set<string>([
    DISCORD_EXEC_INVOKE_OPERATION,
    DISCORD_EXEC_BATCH_OPERATION,
]);

const METHOD_OPERATION_GROUPS: Record<DomainMethod, readonly DiscordOperation[]> = {
    "automation.read": [
        DISCORD_META_PACKAGES_OPERATION,
        DISCORD_META_SYMBOLS_OPERATION,
        DISCORD_META_PREFLIGHT_OPERATION,
    ],
    "automation.write": [
        DISCORD_EXEC_INVOKE_OPERATION,
        DISCORD_EXEC_BATCH_OPERATION,
    ],
};

export function isDiscordMetaOperation(operation: string): boolean {
    return operation.trim().toLowerCase().startsWith("discord.meta.");
}

export function isDiscordExecOperation(operation: string): boolean {
    return operation.trim().toLowerCase().startsWith("discord.exec.");
}

export function isDiscordMetaPackagesOperation(operation: string): boolean {
    return (
        operation.trim().toLowerCase() === DISCORD_META_PACKAGES_OPERATION
    );
}

export function isDiscordMetaSymbolsOperation(operation: string): boolean {
    return operation.trim().toLowerCase() === DISCORD_META_SYMBOLS_OPERATION;
}

export function isDiscordMetaPreflightOperation(operation: string): boolean {
    return (
        operation.trim().toLowerCase() === DISCORD_META_PREFLIGHT_OPERATION
    );
}

export function isDiscordExecInvokeOperation(operation: string): boolean {
    return operation.trim().toLowerCase() === DISCORD_EXEC_INVOKE_OPERATION;
}

export function isDiscordExecBatchOperation(operation: string): boolean {
    return operation.trim().toLowerCase() === DISCORD_EXEC_BATCH_OPERATION;
}

export function isDiscordReadOperation(operation: string): boolean {
    return READ_OPERATION_SET.has(operation.trim().toLowerCase());
}

export function isDiscordWriteOperation(operation: string): boolean {
    return WRITE_OPERATION_SET.has(operation.trim().toLowerCase());
}

export function resolveDomainMethod(method: string): DomainMethod {
    const normalized = method.trim().toLowerCase();
    if (!METHOD_SET.has(normalized)) {
        throw new Error(
            `Unsupported method '${method}'. Valid methods: ${DOMAIN_METHODS.join(", ")}`,
        );
    }

    return normalized as DomainMethod;
}

export function resolveOperation(operation: string): DiscordOperation {
    const normalized = operation.trim().toLowerCase();
    if (!normalized) {
        throw new Error("Operation cannot be empty.");
    }

    if (!VALID_OPERATIONS.has(normalized)) {
        throw new Error(
            `Unsupported operation '${operation}'. Valid operations: ${Array.from(VALID_OPERATIONS).join(", ")}.`,
        );
    }

    return normalized;
}

export function resolveOperationForMethod(
    method: DomainMethod,
    operation: string,
): DiscordOperation {
    const normalizedOperation = resolveOperation(operation);
    const methodMatches =
        (method === "automation.read" &&
            READ_OPERATION_SET.has(normalizedOperation)) ||
        (method === "automation.write" &&
            WRITE_OPERATION_SET.has(normalizedOperation));

    if (!methodMatches) {
        const allowed = METHOD_OPERATION_GROUPS[method];
        throw new Error(
            `Operation '${operation}' is not valid for method '${method}'. Valid operations: ${allowed.join(", ")}`,
        );
    }

    return normalizedOperation;
}

export function getDomainMethodForOperation(
    operation: DiscordOperation,
): DomainMethod {
    const normalized = resolveOperation(operation);
    if (READ_OPERATION_SET.has(normalized)) {
        return "automation.read";
    }
    if (WRITE_OPERATION_SET.has(normalized)) {
        return "automation.write";
    }

    throw new Error(`No domain method mapped for operation '${operation}'.`);
}

export function getOperationsForMethod(
    method: DomainMethod,
): readonly DiscordOperation[] {
    return METHOD_OPERATION_GROUPS[method];
}

