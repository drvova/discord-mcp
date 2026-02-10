export type DiscordOperation = string;

export const DOMAIN_METHODS = [
    "server.read",
    "server.write",
    "channels.read",
    "channels.write",
    "messages.read",
    "messages.write",
    "members.read",
    "members.write",
    "roles.read",
    "roles.write",
    "automation.read",
    "automation.write",
] as const;

export type DomainMethod = (typeof DOMAIN_METHODS)[number];

const METHOD_SET = new Set<string>(DOMAIN_METHODS);

export const DYNAMIC_DISCORDJS_OPERATION_PREFIX = "discordjs.";
export const DISCORDJS_DISCOVERY_OPERATION = "discordjs.meta.symbols";

const DYNAMIC_OPERATION_SEGMENT_PATTERN = /^discordjs\.[^.]+\..+$/i;

const REMOVED_STATIC_OPERATION_SET = new Set<string>([
    "get_discordjs_symbols",
    "invoke_discordjs_symbol",
]);

const METHOD_OPERATION_GROUPS: Record<DomainMethod, readonly DiscordOperation[]> = {
    "server.read": [],
    "server.write": [],
    "channels.read": [],
    "channels.write": [],
    "messages.read": [],
    "messages.write": [],
    "members.read": [],
    "members.write": [],
    "roles.read": [],
    "roles.write": [],
    "automation.read": [DISCORDJS_DISCOVERY_OPERATION],
    "automation.write": [],
};

export function isDynamicDiscordJsOperation(operation: string): boolean {
    return operation
        .trim()
        .toLowerCase()
        .startsWith(DYNAMIC_DISCORDJS_OPERATION_PREFIX);
}

export function isDiscordJsDiscoveryOperation(operation: string): boolean {
    return (
        operation.trim().toLowerCase() === DISCORDJS_DISCOVERY_OPERATION
    );
}

export function isDiscordJsInvocationOperation(operation: string): boolean {
    const normalized = operation.trim();
    if (!DYNAMIC_OPERATION_SEGMENT_PATTERN.test(normalized)) {
        return false;
    }

    if (isDiscordJsDiscoveryOperation(normalized)) {
        return false;
    }

    const withoutPrefix = normalized.slice(
        DYNAMIC_DISCORDJS_OPERATION_PREFIX.length,
    );
    const separatorIndex = withoutPrefix.indexOf(".");
    if (separatorIndex <= 0) {
        return false;
    }

    const kind = withoutPrefix.slice(0, separatorIndex).toLowerCase();
    return kind !== "meta";
}

function staticMigrationError(operation: string): Error {
    return new Error(
        `Static operation '${operation}' has been removed. Use '${DISCORDJS_DISCOVERY_OPERATION}' for discovery or dynamic format 'discordjs.<kind>.<symbol>' for invocation.`,
    );
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

export function resolveOperationForMethod(
    method: DomainMethod,
    operation: string,
): DiscordOperation {
    const normalized = operation.trim();
    if (!normalized) {
        throw new Error("Operation cannot be empty.");
    }

    const lower = normalized.toLowerCase();
    if (REMOVED_STATIC_OPERATION_SET.has(lower)) {
        throw staticMigrationError(lower);
    }

    if (method === "automation.read") {
        if (isDiscordJsDiscoveryOperation(normalized)) {
            return DISCORDJS_DISCOVERY_OPERATION;
        }

        if (isDynamicDiscordJsOperation(normalized)) {
            throw new Error(
                `Operation '${operation}' is not valid for method 'automation.read'. Use '${DISCORDJS_DISCOVERY_OPERATION}'.`,
            );
        }

        throw new Error(
            `Unsupported operation '${operation}'. Use '${DISCORDJS_DISCOVERY_OPERATION}' for discovery.`,
        );
    }

    if (method === "automation.write") {
        if (isDiscordJsDiscoveryOperation(normalized)) {
            throw new Error(
                `Operation '${operation}' is not valid for method 'automation.write'. '${DISCORDJS_DISCOVERY_OPERATION}' requires method 'automation.read'.`,
            );
        }

        if (isDiscordJsInvocationOperation(normalized)) {
            return normalized;
        }

        if (isDynamicDiscordJsOperation(normalized)) {
            throw new Error(
                `Dynamic discord.js operation '${operation}' must use a non-'meta' kind and match 'discordjs.<kind>.<symbol>'.`,
            );
        }

        throw new Error(
            `Unsupported operation '${operation}'. Use dynamic format 'discordjs.<kind>.<symbol>' for invocation.`,
        );
    }

    if (isDynamicDiscordJsOperation(normalized)) {
        throw new Error(
            `Discord.js dynamic operation '${operation}' is only valid for methods 'automation.read' and 'automation.write'.`,
        );
    }

    throw new Error(
        `Unsupported operation '${operation}' for method '${method}'.`,
    );
}

export function getDomainMethodForOperation(
    operation: DiscordOperation,
): DomainMethod {
    if (isDiscordJsDiscoveryOperation(operation)) {
        return "automation.read";
    }

    if (isDiscordJsInvocationOperation(operation)) {
        return "automation.write";
    }

    const normalized = operation.trim().toLowerCase();
    if (REMOVED_STATIC_OPERATION_SET.has(normalized)) {
        throw staticMigrationError(normalized);
    }

    throw new Error(`No domain method mapped for operation '${operation}'.`);
}

export function getOperationsForMethod(
    method: DomainMethod,
): readonly DiscordOperation[] {
    return METHOD_OPERATION_GROUPS[method];
}
