import { dirname, join } from "node:path";
import { createRequire } from "node:module";

export type DiscordJsSymbolKind =
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

export type DiscordJsSymbolSort = "name_asc" | "name_desc";

export type DiscordJsSymbolBehaviorClass =
    | "read"
    | "write"
    | "admin"
    | "dangerous"
    | "unknown";

export type DiscordJsSymbol = {
    name: string;
    kind: DiscordJsSymbolKind;
    source: "discord.js";
    origin: "runtime";
    behaviorClass: DiscordJsSymbolBehaviorClass;
    invokable: boolean;
    operationKey: string;
    docsPath?: string;
    declaredOn?: string;
    aliasOf?: string;
};

export type GetDiscordJsSymbolsOptions = {
    kinds?: DiscordJsSymbolKind[];
    query?: string;
    page?: number;
    pageSize?: number;
    sort?: DiscordJsSymbolSort;
    includeKindCounts?: boolean;
};

type DiscordJsKindCounts = Partial<Record<DiscordJsSymbolKind, number>>;

export type DiscordJsSymbolCatalog = {
    package: "discord.js";
    version: string;
    kinds: DiscordJsSymbolKind[];
    total: number;
    page: number;
    pageSize: number;
    items: DiscordJsSymbol[];
    kindCounts?: DiscordJsKindCounts;
};

type DiscordJsCatalogCache = {
    version: string;
    symbols: DiscordJsSymbol[];
};

const require = createRequire(import.meta.url);

const ALL_KINDS: DiscordJsSymbolKind[] = [
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

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 50;

let catalogCache: DiscordJsCatalogCache | null = null;

const DANGEROUS_TOKENS = new Set([
    "ban",
    "bulkdelete",
    "delete",
    "destroy",
    "drop",
    "nuke",
    "purge",
    "prune",
    "terminate",
    "wipe",
]);

const ADMIN_TOKENS = new Set([
    "automod",
    "kick",
    "permission",
    "permissions",
    "role",
    "timeout",
    "unban",
    "webhook",
]);

const WRITE_TOKENS = new Set([
    "add",
    "archive",
    "clear",
    "create",
    "edit",
    "join",
    "leave",
    "lock",
    "move",
    "pin",
    "remove",
    "send",
    "set",
    "stop",
    "sync",
    "unlock",
    "unpin",
    "unarchive",
    "update",
    "upload",
]);

const READ_TOKENS = new Set([
    "calc",
    "calculate",
    "fetch",
    "find",
    "format",
    "get",
    "has",
    "is",
    "list",
    "parse",
    "read",
    "resolve",
    "search",
    "tojson",
    "view",
]);

function resolveDiscordJsMetadata(): { version: string } {
    const moduleEntryPath = require.resolve("discord.js");
    const packageDir = dirname(dirname(moduleEntryPath));
    const packageJsonPath = join(packageDir, "package.json");
    const packageJson = require(packageJsonPath) as {
        version?: string;
    };

    if (!packageJson.version) {
        throw new Error("Unable to resolve installed discord.js version.");
    }

    return {
        version: packageJson.version,
    };
}

function docsKindLabel(kind: DiscordJsSymbolKind): string {
    switch (kind) {
        case "class":
            return "Class";
        case "enum":
            return "Enum";
        case "interface":
            return "Interface";
        case "function":
            return "Function";
        case "type":
            return "TypeAlias";
        case "const":
        case "variable":
            return "Variable";
        case "event":
            return "Event";
        case "namespace":
            return "Namespace";
        case "external":
            return "External";
        default:
            return "Class";
    }
}

function tokenizeSymbolName(name: string): string[] {
    return name
        .replace(/[.#]/g, " ")
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .replace(/[^A-Za-z0-9]+/g, " ")
        .trim()
        .toLowerCase()
        .split(/\s+/)
        .filter(Boolean);
}

function hasAnyToken(tokens: string[], vocabulary: Set<string>): boolean {
    for (const token of tokens) {
        if (vocabulary.has(token)) {
            return true;
        }
    }
    return false;
}

export function classifyDiscordJsSymbolBehavior(
    name: string,
    kind: DiscordJsSymbolKind,
): DiscordJsSymbolBehaviorClass {
    if (
        kind === "event" ||
        kind === "const" ||
        kind === "variable" ||
        kind === "enum"
    ) {
        return "read";
    }
    if (kind !== "function") {
        return "unknown";
    }

    const tokens = tokenizeSymbolName(name);
    if (tokens.length === 0) {
        return "unknown";
    }

    if (hasAnyToken(tokens, DANGEROUS_TOKENS)) {
        return "dangerous";
    }
    if (hasAnyToken(tokens, ADMIN_TOKENS)) {
        return "admin";
    }
    if (hasAnyToken(tokens, WRITE_TOKENS)) {
        return "write";
    }
    if (hasAnyToken(tokens, READ_TOKENS)) {
        return "read";
    }

    return "unknown";
}

function toDocsPath(version: string, name: string, kind: DiscordJsSymbolKind): string {
    const methodInstanceMatch = name.match(
        /^([A-Za-z_$][A-Za-z0-9_$]*)#([A-Za-z_$][A-Za-z0-9_$]*)$/,
    );
    if (kind === "function" && methodInstanceMatch) {
        const className = methodInstanceMatch[1];
        const methodName = methodInstanceMatch[2];
        return `/docs/packages/discord.js/${version}/${className}:Class#${methodName}`;
    }

    const methodStaticMatch = name.match(
        /^([A-Za-z_$][A-Za-z0-9_$]*)\.([A-Za-z_$][A-Za-z0-9_$]*)$/,
    );
    if (kind === "function" && methodStaticMatch) {
        const className = methodStaticMatch[1];
        const methodName = methodStaticMatch[2];
        return `/docs/packages/discord.js/${version}/${className}:Class#${methodName}`;
    }

    return `/docs/packages/discord.js/${version}/${name}:${docsKindLabel(kind)}`;
}

function createSymbol(
    version: string,
    name: string,
    kind: DiscordJsSymbolKind,
    metadata: {
        declaredOn?: string;
        aliasOf?: string;
    } = {},
): DiscordJsSymbol {
    return {
        name,
        kind,
        source: "discord.js",
        origin: "runtime",
        behaviorClass: classifyDiscordJsSymbolBehavior(name, kind),
        invokable: kind === "function",
        operationKey: `discordjs.${kind}.${encodeURIComponent(name)}`,
        docsPath: toDocsPath(version, name, kind),
        declaredOn: metadata.declaredOn,
        aliasOf: metadata.aliasOf,
    };
}

function isIdentifier(value: string): boolean {
    return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(value);
}

function addSymbol(
    symbolMap: Map<string, DiscordJsSymbol>,
    version: string,
    name: string,
    kind: DiscordJsSymbolKind,
    metadata: {
        declaredOn?: string;
        aliasOf?: string;
    } = {},
): void {
    const trimmedName = name.trim();
    if (!trimmedName) {
        return;
    }

    const key = `${kind}:${trimmedName}`;
    if (symbolMap.has(key)) {
        return;
    }

    symbolMap.set(key, createSymbol(version, trimmedName, kind, metadata));
}

function addMethodSymbol(
    symbolMap: Map<string, DiscordJsSymbol>,
    version: string,
    className: string,
    methodName: string,
    isStatic: boolean,
    metadata: {
        declaredOn?: string;
        aliasOf?: string;
    } = {},
): void {
    if (!isIdentifier(className) || !isIdentifier(methodName)) {
        return;
    }
    if (methodName === "constructor") {
        return;
    }

    const compositeName = isStatic
        ? `${className}.${methodName}`
        : `${className}#${methodName}`;

    addSymbol(symbolMap, version, compositeName, "function", {
        declaredOn: metadata.declaredOn,
        aliasOf: metadata.aliasOf,
    });
}

function addTopLevelRuntimeExportSymbol(
    symbolMap: Map<string, DiscordJsSymbol>,
    version: string,
    exportName: string,
    value: unknown,
): void {
    const runtimeKind = runtimeKindForValue(value);
    if (!runtimeKind || !isIdentifier(exportName)) {
        return;
    }

    addSymbol(symbolMap, version, exportName, runtimeKind);
    if (runtimeKind === "const") {
        addSymbol(symbolMap, version, exportName, "variable");
    }
}

function isClassConstructor(value: unknown): value is new (...args: unknown[]) => unknown {
    if (typeof value !== "function") {
        return false;
    }

    const source = Function.prototype.toString.call(value);
    return source.startsWith("class ");
}

function runtimeKindForValue(value: unknown): DiscordJsSymbolKind | null {
    if (typeof value === "function") {
        return isClassConstructor(value) ? "class" : "function";
    }

    if (value !== undefined) {
        return "const";
    }

    return null;
}

function addInstanceMethodSymbolsFromRuntimeClass(
    symbolMap: Map<string, DiscordJsSymbol>,
    version: string,
    exportedClassName: string,
    classValue: new (...args: unknown[]) => unknown,
): void {
    const seenCanonical = new Set<string>();
    let prototypeCursor = classValue.prototype;

    while (prototypeCursor && prototypeCursor !== Object.prototype) {
        const ownerName =
            typeof prototypeCursor.constructor?.name === "string" &&
            isIdentifier(prototypeCursor.constructor.name)
                ? prototypeCursor.constructor.name
                : exportedClassName;

        const propertyNames = Object.getOwnPropertyNames(prototypeCursor);
        for (const propertyName of propertyNames) {
            if (propertyName === "constructor" || !isIdentifier(propertyName)) {
                continue;
            }

            const descriptor = Object.getOwnPropertyDescriptor(
                prototypeCursor,
                propertyName,
            );
            if (!descriptor || typeof descriptor.value !== "function") {
                continue;
            }

            const canonicalSymbol = `${ownerName}#${propertyName}`;
            if (!seenCanonical.has(canonicalSymbol)) {
                addMethodSymbol(
                    symbolMap,
                    version,
                    ownerName,
                    propertyName,
                    false,
                    {
                        declaredOn: ownerName,
                    },
                );
                seenCanonical.add(canonicalSymbol);
            }

            if (ownerName !== exportedClassName) {
                addMethodSymbol(
                    symbolMap,
                    version,
                    exportedClassName,
                    propertyName,
                    false,
                    {
                        declaredOn: ownerName,
                        aliasOf: canonicalSymbol,
                    },
                );
            }
        }

        prototypeCursor = Object.getPrototypeOf(prototypeCursor);
    }
}

function addStaticMethodSymbolsFromRuntimeClass(
    symbolMap: Map<string, DiscordJsSymbol>,
    version: string,
    exportedClassName: string,
    classValue: new (...args: unknown[]) => unknown,
): void {
    const seenCanonical = new Set<string>();
    let constructorCursor: unknown = classValue;

    while (
        constructorCursor &&
        typeof constructorCursor === "function" &&
        constructorCursor !== Function.prototype
    ) {
        const ownerName =
            typeof (constructorCursor as { name?: unknown }).name === "string" &&
            isIdentifier((constructorCursor as { name: string }).name)
                ? (constructorCursor as { name: string }).name
                : exportedClassName;

        const propertyNames = Object.getOwnPropertyNames(constructorCursor);
        for (const propertyName of propertyNames) {
            if (
                propertyName === "length" ||
                propertyName === "name" ||
                propertyName === "prototype" ||
                !isIdentifier(propertyName)
            ) {
                continue;
            }

            const descriptor = Object.getOwnPropertyDescriptor(
                constructorCursor,
                propertyName,
            );
            if (!descriptor || typeof descriptor.value !== "function") {
                continue;
            }

            const canonicalSymbol = `${ownerName}.${propertyName}`;
            if (!seenCanonical.has(canonicalSymbol)) {
                addMethodSymbol(
                    symbolMap,
                    version,
                    ownerName,
                    propertyName,
                    true,
                    {
                        declaredOn: ownerName,
                    },
                );
                seenCanonical.add(canonicalSymbol);
            }

            if (ownerName !== exportedClassName) {
                addMethodSymbol(
                    symbolMap,
                    version,
                    exportedClassName,
                    propertyName,
                    true,
                    {
                        declaredOn: ownerName,
                        aliasOf: canonicalSymbol,
                    },
                );
            }
        }

        constructorCursor = Object.getPrototypeOf(constructorCursor);
    }
}

function extractRuntimeEventNames(
    runtimeExports: Record<string, unknown>,
): Set<string> {
    const eventNames = new Set<string>();
    const eventContainers = [
        "Events",
        "ShardEvents",
        "WebSocketShardEvents",
        "GatewayDispatchEvents",
    ];

    for (const containerName of eventContainers) {
        const value = runtimeExports[containerName];
        if (!value || typeof value !== "object") {
            continue;
        }

        for (const candidate of Object.values(value as Record<string, unknown>)) {
            if (typeof candidate === "string" && candidate.trim()) {
                eventNames.add(candidate);
            }
        }
    }

    return eventNames;
}

async function buildCatalog(
    version: string,
): Promise<DiscordJsCatalogCache> {
    const runtimeExports = (await import("discord.js")) as Record<string, unknown>;
    const symbolMap = new Map<string, DiscordJsSymbol>();

    for (const [exportName, value] of Object.entries(runtimeExports)) {
        if (exportName === "default") {
            continue;
        }

        addTopLevelRuntimeExportSymbol(symbolMap, version, exportName, value);

        if (!isClassConstructor(value)) {
            continue;
        }

        addInstanceMethodSymbolsFromRuntimeClass(
            symbolMap,
            version,
            exportName,
            value,
        );
        addStaticMethodSymbolsFromRuntimeClass(
            symbolMap,
            version,
            exportName,
            value,
        );
    }

    const eventNames = extractRuntimeEventNames(runtimeExports);
    for (const eventName of eventNames) {
        addSymbol(symbolMap, version, eventName, "event");
    }

    return {
        version,
        symbols: Array.from(symbolMap.values()),
    };
}

async function getBaseCatalog(): Promise<DiscordJsCatalogCache> {
    const metadata = resolveDiscordJsMetadata();

    if (catalogCache && catalogCache.version === metadata.version) {
        return catalogCache;
    }

    catalogCache = await buildCatalog(metadata.version);
    return catalogCache;
}

export async function getDiscordJsSymbolsCatalog(
    options: GetDiscordJsSymbolsOptions = {},
): Promise<DiscordJsSymbolCatalog> {
    const baseCatalog = await getBaseCatalog();
    const page = options.page ?? DEFAULT_PAGE;
    const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
    const sort = options.sort ?? "name_asc";
    const kinds =
        options.kinds && options.kinds.length > 0
            ? Array.from(new Set(options.kinds))
            : [...ALL_KINDS];
    const normalizedQuery = options.query?.trim().toLowerCase();

    let filteredSymbols = baseCatalog.symbols.filter((symbol) =>
        kinds.includes(symbol.kind),
    );

    if (normalizedQuery) {
        filteredSymbols = filteredSymbols.filter((symbol) =>
            symbol.name.toLowerCase().includes(normalizedQuery),
        );
    }

    filteredSymbols.sort((a, b) => {
        const direction = sort === "name_desc" ? -1 : 1;
        const byName = a.name.localeCompare(b.name) * direction;
        if (byName !== 0) {
            return byName;
        }

        return a.kind.localeCompare(b.kind) * direction;
    });

    let kindCounts: DiscordJsKindCounts | undefined;
    if (options.includeKindCounts) {
        kindCounts = {};
        for (const symbol of filteredSymbols) {
            kindCounts[symbol.kind] = (kindCounts[symbol.kind] || 0) + 1;
        }
    }

    const total = filteredSymbols.length;
    const start = (page - 1) * pageSize;
    const end = start + pageSize;
    const items = filteredSymbols.slice(start, end);

    return {
        package: "discord.js",
        version: baseCatalog.version,
        kinds,
        total,
        page,
        pageSize,
        items,
        kindCounts,
    };
}
