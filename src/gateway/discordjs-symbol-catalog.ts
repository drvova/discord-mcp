import { readFileSync } from "node:fs";
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
    behaviorClass: DiscordJsSymbolBehaviorClass;
    invokable: boolean;
    operationKey: string;
    docsPath?: string;
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

function resolveDiscordJsMetadata(): { version: string; typingsPath: string } {
    const moduleEntryPath = require.resolve("discord.js");
    const packageDir = dirname(dirname(moduleEntryPath));
    const packageJsonPath = join(packageDir, "package.json");
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
        version?: string;
        types?: string;
    };

    if (!packageJson.version) {
        throw new Error("Unable to resolve installed discord.js version.");
    }

    const typingsPath = join(packageDir, packageJson.types || "typings/index.d.ts");
    return {
        version: packageJson.version,
        typingsPath,
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
    if (kind === "event" || kind === "const" || kind === "variable" || kind === "enum") {
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
): DiscordJsSymbol {
    return {
        name,
        kind,
        source: "discord.js",
        behaviorClass: classifyDiscordJsSymbolBehavior(name, kind),
        invokable: kind === "function",
        operationKey: `discordjs.${kind}.${encodeURIComponent(name)}`,
        docsPath: toDocsPath(version, name, kind),
    };
}

function addSymbol(
    symbolMap: Map<string, DiscordJsSymbol>,
    version: string,
    name: string,
    kind: DiscordJsSymbolKind,
): void {
    const trimmedName = name.trim();
    if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(trimmedName)) {
        return;
    }

    const key = `${kind}:${trimmedName}`;
    if (symbolMap.has(key)) {
        return;
    }

    symbolMap.set(key, createSymbol(version, trimmedName, kind));
}

function addMethodSymbol(
    symbolMap: Map<string, DiscordJsSymbol>,
    version: string,
    className: string,
    methodName: string,
    isStatic: boolean,
): void {
    if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(className)) {
        return;
    }
    if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(methodName)) {
        return;
    }
    if (methodName === "constructor") {
        return;
    }

    const compositeName = isStatic
        ? `${className}.${methodName}`
        : `${className}#${methodName}`;
    const key = `function:${compositeName}`;
    if (symbolMap.has(key)) {
        return;
    }

    symbolMap.set(key, createSymbol(version, compositeName, "function"));
}

function addSymbolWithVariableAlias(
    symbolMap: Map<string, DiscordJsSymbol>,
    version: string,
    name: string,
    kind: DiscordJsSymbolKind,
): void {
    addSymbol(symbolMap, version, name, kind);
    if (kind === "const") {
        addSymbol(symbolMap, version, name, "variable");
    }
}

function addSymbolsFromRegex(
    source: string,
    pattern: RegExp,
    kind: DiscordJsSymbolKind,
    symbolMap: Map<string, DiscordJsSymbol>,
    version: string,
): void {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(source)) !== null) {
        const name = match[1];
        if (name) {
            addSymbolWithVariableAlias(symbolMap, version, name, kind);
        }
    }
}

function extractReExportNames(source: string): Set<string> {
    return extractReExportNamesByModule(source);
}

function isRelativeModuleSpecifier(moduleSpecifier: string): boolean {
    return moduleSpecifier.startsWith(".") || moduleSpecifier.startsWith("/");
}

function extractExportNamesFromClause(clause: string): string[] {
    const names: string[] = [];
    const items = clause
        .split(",")
        .map((item) => item.trim())
        .filter((item) => item.length > 0);

    for (const item of items) {
        const aliasMatch = item.match(
            /^([A-Za-z_$][A-Za-z0-9_$]*)\s+as\s+([A-Za-z_$][A-Za-z0-9_$]*)$/,
        );
        if (aliasMatch) {
            names.push(aliasMatch[2]);
            continue;
        }

        const directMatch = item.match(/^([A-Za-z_$][A-Za-z0-9_$]*)$/);
        if (directMatch) {
            names.push(directMatch[1]);
        }
    }

    return names;
}

function extractReExportNamesByModule(source: string): Set<string> {
    const reExportNames = new Set<string>();
    const reExportBlockPattern =
        /export\s*\{([\s\S]*?)\}\s*from\s*["']([^"']+)["'];?/gm;

    let match: RegExpExecArray | null;
    while ((match = reExportBlockPattern.exec(source)) !== null) {
        const body = match[1];
        if (!body) {
            continue;
        }

        for (const name of extractExportNamesFromClause(body)) {
            reExportNames.add(name);
        }
    }

    return reExportNames;
}

function extractExternalReExportNames(source: string): Set<string> {
    const externalNames = new Set<string>();
    const reExportBlockPattern =
        /export\s*\{([\s\S]*?)\}\s*from\s*["']([^"']+)["'];?/gm;

    let match: RegExpExecArray | null;
    while ((match = reExportBlockPattern.exec(source)) !== null) {
        const body = match[1];
        const moduleSpecifier = match[2];
        if (!body) {
            continue;
        }
        if (isRelativeModuleSpecifier(moduleSpecifier)) {
            continue;
        }
        for (const name of extractExportNamesFromClause(body)) {
            externalNames.add(name);
        }
    }

    return externalNames;
}

function extractDelimitedBlock(
    source: string,
    openBraceIndex: number,
): string | null {
    if (openBraceIndex < 0 || source[openBraceIndex] !== "{") {
        return null;
    }

    let depth = 0;
    for (let index = openBraceIndex; index < source.length; index += 1) {
        const char = source[index];
        if (char === "{") {
            depth += 1;
            continue;
        }
        if (char !== "}") {
            continue;
        }

        depth -= 1;
        if (depth === 0) {
            return source.slice(openBraceIndex + 1, index);
        }
    }

    return null;
}

function extractEventNamesFromInterfaceBodies(source: string): Set<string> {
    const eventNames = new Set<string>();
    const interfacePattern =
        /export\s+interface\s+([A-Za-z_$][A-Za-z0-9_$]*(?:Events|EventTypes))\s*\{/gm;
    // discord.js event maps use top-level keys indented by exactly 2 spaces
    // (nested tuple parameter names are indented deeper and should be ignored)
    const keyPattern =
        /^(?: {2}(?! )|\t)(?:'([^']+)'|"([^"]+)"|([A-Za-z_$][A-Za-z0-9_$]*))\??\s*:/gm;

    let match: RegExpExecArray | null;
    while ((match = interfacePattern.exec(source)) !== null) {
        const openBraceIndex = source.indexOf("{", match.index);
        const body = extractDelimitedBlock(source, openBraceIndex);
        if (!body) {
            continue;
        }

        keyPattern.lastIndex = 0;
        let keyMatch: RegExpExecArray | null;
        while ((keyMatch = keyPattern.exec(body)) !== null) {
            const eventName = keyMatch[1] || keyMatch[2] || keyMatch[3];
            if (eventName) {
                eventNames.add(eventName);
            }
        }
    }

    return eventNames;
}

function extractEventNamesFromEnumBodies(source: string): Set<string> {
    const eventNames = new Set<string>();
    const enumPattern =
        /export\s+enum\s+([A-Za-z_$][A-Za-z0-9_$]*Events)\s*\{/gm;
    const literalValuePattern =
        /^\s*[A-Za-z_$][A-Za-z0-9_$]*\s*=\s*["']([^"']+)["']/gm;

    let match: RegExpExecArray | null;
    while ((match = enumPattern.exec(source)) !== null) {
        const openBraceIndex = source.indexOf("{", match.index);
        const body = extractDelimitedBlock(source, openBraceIndex);
        if (!body) {
            continue;
        }

        literalValuePattern.lastIndex = 0;
        let literalMatch: RegExpExecArray | null;
        while ((literalMatch = literalValuePattern.exec(body)) !== null) {
            const eventName = literalMatch[1];
            if (eventName) {
                eventNames.add(eventName);
            }
        }
    }

    return eventNames;
}

type ClassMethodSignature = {
    className: string;
    methodName: string;
    isStatic: boolean;
};

function extractClassMethodSignatures(source: string): ClassMethodSignature[] {
    const signatures: ClassMethodSignature[] = [];
    const classPattern =
        /export\s+(?:declare\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][A-Za-z0-9_$]*)[^{]*\{/gm;
    const methodPattern =
        /^\s*(?:(?:public|protected|private|readonly|abstract|override|declare|async)\s+)*(static\s+)?(?:(?:get|set)\s+)?([A-Za-z_$][A-Za-z0-9_$]*)\s*(?:<[^(){};]*>\s*)?\(/gm;

    let classMatch: RegExpExecArray | null;
    while ((classMatch = classPattern.exec(source)) !== null) {
        const className = classMatch[1];
        const openBraceIndex = source.indexOf("{", classMatch.index);
        const body = extractDelimitedBlock(source, openBraceIndex);
        if (!body) {
            continue;
        }

        methodPattern.lastIndex = 0;
        let methodMatch: RegExpExecArray | null;
        while ((methodMatch = methodPattern.exec(body)) !== null) {
            const methodName = methodMatch[2];
            if (!methodName || methodName === "constructor") {
                continue;
            }

            signatures.push({
                className,
                methodName,
                isStatic: Boolean(methodMatch[1]),
            });
        }
    }

    return signatures;
}

function runtimeKindForValue(
    value: unknown,
): DiscordJsSymbolKind | null {
    if (typeof value === "function") {
        const source = Function.prototype.toString.call(value);
        return source.startsWith("class ") ? "class" : "function";
    }

    if (value !== undefined) {
        return "const";
    }

    return null;
}

async function buildCatalog(
    version: string,
    typingsPath: string,
): Promise<DiscordJsCatalogCache> {
    const declarationSource = readFileSync(typingsPath, "utf8");
    const symbolMap = new Map<string, DiscordJsSymbol>();

    addSymbolsFromRegex(
        declarationSource,
        /^export\s+(?:declare\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][A-Za-z0-9_$]*)/gm,
        "class",
        symbolMap,
        version,
    );
    const classMethodSignatures = extractClassMethodSignatures(declarationSource);
    for (const signature of classMethodSignatures) {
        addMethodSymbol(
            symbolMap,
            version,
            signature.className,
            signature.methodName,
            signature.isStatic,
        );
    }
    addSymbolsFromRegex(
        declarationSource,
        /^export\s+(?:declare\s+)?enum\s+([A-Za-z_$][A-Za-z0-9_$]*)/gm,
        "enum",
        symbolMap,
        version,
    );
    addSymbolsFromRegex(
        declarationSource,
        /^export\s+(?:declare\s+)?interface\s+([A-Za-z_$][A-Za-z0-9_$]*)/gm,
        "interface",
        symbolMap,
        version,
    );
    addSymbolsFromRegex(
        declarationSource,
        /^export\s+(?:declare\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/gm,
        "function",
        symbolMap,
        version,
    );
    addSymbolsFromRegex(
        declarationSource,
        /^export\s+(?:declare\s+)?type\s+([A-Za-z_$][A-Za-z0-9_$]*)\b/gm,
        "type",
        symbolMap,
        version,
    );
    addSymbolsFromRegex(
        declarationSource,
        /^export\s+(?:declare\s+)?const\s+([A-Za-z_$][A-Za-z0-9_$]*)\b/gm,
        "const",
        symbolMap,
        version,
    );
    addSymbolsFromRegex(
        declarationSource,
        /^export\s+(?:declare\s+)?(?:let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\b/gm,
        "variable",
        symbolMap,
        version,
    );
    addSymbolsFromRegex(
        declarationSource,
        /^export\s+(?:declare\s+)?namespace\s+([A-Za-z_$][A-Za-z0-9_$]*)\b/gm,
        "namespace",
        symbolMap,
        version,
    );

    const externalNames = extractExternalReExportNames(declarationSource);
    for (const externalName of externalNames) {
        addSymbol(symbolMap, version, externalName, "external");
    }

    const eventNames = new Set<string>([
        ...extractEventNamesFromInterfaceBodies(declarationSource),
        ...extractEventNamesFromEnumBodies(declarationSource),
    ]);
    for (const eventName of eventNames) {
        addSymbol(symbolMap, version, eventName, "event");
    }

    const runtimeExports = (await import("discord.js")) as Record<string, unknown>;
    const reExportNames = extractReExportNames(declarationSource);

    for (const name of reExportNames) {
        if (!Object.prototype.hasOwnProperty.call(runtimeExports, name)) {
            continue;
        }
        const runtimeKind = runtimeKindForValue(runtimeExports[name]);
        if (!runtimeKind) {
            continue;
        }
        addSymbolWithVariableAlias(symbolMap, version, name, runtimeKind);
    }

    for (const [name, value] of Object.entries(runtimeExports)) {
        if (name === "default") {
            continue;
        }
        const runtimeKind = runtimeKindForValue(value);
        if (!runtimeKind) {
            continue;
        }
        addSymbolWithVariableAlias(symbolMap, version, name, runtimeKind);
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

    catalogCache = await buildCatalog(metadata.version, metadata.typingsPath);
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
