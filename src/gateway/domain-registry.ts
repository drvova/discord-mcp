export const DISCORD_OPERATIONS = [
    "get_discordjs_symbols",
    "invoke_discordjs_symbol",
] as const;

export type StaticDiscordOperation = (typeof DISCORD_OPERATIONS)[number];
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

const DOMAIN_OPERATION_GROUPS: Record<
    DomainMethod,
    readonly StaticDiscordOperation[]
> = {
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
    "automation.read": ["get_discordjs_symbols"],
    "automation.write": ["invoke_discordjs_symbol"],
};

const STATIC_OPERATION_SET = new Set<string>(DISCORD_OPERATIONS);
const METHOD_SET = new Set<string>(DOMAIN_METHODS);

const STATIC_OPERATION_TO_METHOD = new Map<StaticDiscordOperation, DomainMethod>();
for (const method of DOMAIN_METHODS) {
    for (const operation of DOMAIN_OPERATION_GROUPS[method]) {
        if (STATIC_OPERATION_TO_METHOD.has(operation)) {
            throw new Error(
                `Domain registry configuration error: operation '${operation}' is mapped more than once.`,
            );
        }
        STATIC_OPERATION_TO_METHOD.set(operation, method);
    }
}

const unmappedOperations = DISCORD_OPERATIONS.filter(
    (operation) => !STATIC_OPERATION_TO_METHOD.has(operation),
);
if (unmappedOperations.length > 0) {
    throw new Error(
        `Domain registry configuration error: unmapped operations: ${unmappedOperations.join(", ")}`,
    );
}

export const DYNAMIC_DISCORDJS_OPERATION_PREFIX = "discordjs.";

export function isDynamicDiscordJsOperation(operation: string): boolean {
    return operation
        .trim()
        .toLowerCase()
        .startsWith(DYNAMIC_DISCORDJS_OPERATION_PREFIX);
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
    if (STATIC_OPERATION_SET.has(lower)) {
        const op = lower as StaticDiscordOperation;
        const expectedMethod = STATIC_OPERATION_TO_METHOD.get(op);
        if (expectedMethod !== method) {
            throw new Error(
                `Operation '${op}' is not valid for method '${method}'. Expected method '${expectedMethod}'.`,
            );
        }
        return op;
    }

    if (isDynamicDiscordJsOperation(normalized)) {
        if (method !== "automation.write") {
            throw new Error(
                `Dynamic discord.js operation '${operation}' is only valid for method 'automation.write'.`,
            );
        }
        return normalized;
    }

    throw new Error(
        `Unsupported operation '${operation}'. Use static operations (${DISCORD_OPERATIONS.join(", ")}) or dynamic format 'discordjs.<kind>.<symbol>'.`,
    );
}

export function getDomainMethodForOperation(
    operation: DiscordOperation,
): DomainMethod {
    if (isDynamicDiscordJsOperation(operation)) {
        return "automation.write";
    }

    const normalized = operation.trim().toLowerCase();
    const method = STATIC_OPERATION_TO_METHOD.get(
        normalized as StaticDiscordOperation,
    );
    if (!method) {
        throw new Error(`No domain method mapped for operation '${operation}'.`);
    }
    return method;
}

export function getOperationsForMethod(
    method: DomainMethod,
): readonly DiscordOperation[] {
    return DOMAIN_OPERATION_GROUPS[method];
}
