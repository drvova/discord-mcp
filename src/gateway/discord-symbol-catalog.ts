import { existsSync, readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type { DiscordRuntimePackage } from "./package-graph.js";
import { listDiscordRuntimePackages } from "./package-graph.js";

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
    source: string;
    packageName: string;
    packageAlias: string;
    moduleVersion: string;
    origin: "runtime" | "types";
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

export type GetDiscordPackageSymbolsOptions = GetDiscordJsSymbolsOptions & {
    package?: string;
    packages?: string[];
    includeAliases?: boolean;
};

type DiscordJsKindCounts = Partial<Record<DiscordJsSymbolKind, number>>;

export type DiscordJsSymbolCatalog = {
    package: "discord.js";
    version: string;
    catalogFingerprint: string;
    catalogBuiltAt: string;
    isFresh: boolean;
    kinds: DiscordJsSymbolKind[];
    total: number;
    page: number;
    pageSize: number;
    items: DiscordJsSymbol[];
    kindCounts?: DiscordJsKindCounts;
};

export type DiscordPackageDescriptor = {
    packageName: string;
    packageAlias: string;
    version: string;
};

export type DiscordPackageSymbolsCatalog = {
    package: "discord.packages";
    catalogFingerprint: string;
    catalogBuiltAt: string;
    isFresh: boolean;
    packageCount: number;
    packages: DiscordPackageDescriptor[];
    kinds: DiscordJsSymbolKind[];
    total: number;
    page: number;
    pageSize: number;
    items: DiscordJsSymbol[];
    kindCounts?: DiscordJsKindCounts;
};

export type DiscordCatalogDiffInput = {
    packages: DiscordRuntimePackage[];
    symbols: DiscordJsSymbol[];
};

type DiscordPackageCatalogSnapshot = DiscordCatalogDiffInput & {
    catalogFingerprint: string;
    catalogBuiltAt: string;
    runtimeExportsByAlias: Map<string, Record<string, unknown>>;
};

type CatalogAccessResult = {
    snapshot: DiscordPackageCatalogSnapshot;
    isFresh: boolean;
    previousSnapshot: DiscordPackageCatalogSnapshot | null;
    didRebuild: boolean;
};

export type DiscordCatalogDiffPackageChange = {
    packageAlias: string;
    packageName: string;
    previousVersion?: string;
    nextVersion?: string;
    changeType: "added" | "removed" | "updated";
};

export type DiscordCatalogDiff = {
    changedPackages: DiscordCatalogDiffPackageChange[];
    addedSymbols: DiscordJsSymbol[];
    removedSymbols: DiscordJsSymbol[];
    kindCountsDelta: DiscordJsKindCounts;
};

export type DiscordCatalogRefreshResult = {
    catalogFingerprint: string;
    catalogBuiltAt: string;
    isFresh: boolean;
    didRebuild: boolean;
    packageCount: number;
    symbolCount: number;
    changedPackages: DiscordCatalogDiffPackageChange[];
    addedSymbols: DiscordJsSymbol[];
    removedSymbols: DiscordJsSymbol[];
    kindCountsDelta: DiscordJsKindCounts;
};

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
const DISCORDJS_ALIAS = "discordjs";
const CATALOG_REFRESH_INTERVAL_ENV = "DISCORD_MCP_CATALOG_REFRESH_INTERVAL_MS";
const CATALOG_LOCKFILES = ["package-lock.json", "bun.lock", "pnpm-lock.yaml"];
const require = createRequire(import.meta.url);

let catalogSnapshot: DiscordPackageCatalogSnapshot | null = null;
let refreshPromise: Promise<CatalogAccessResult> | null = null;
let refreshLoopHandle: NodeJS.Timeout | null = null;

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

function sortStringRecord(
    input: Record<string, string> | undefined,
): Record<string, string> {
    if (!input) {
        return {};
    }

    const entries = Object.entries(input).sort(([a], [b]) =>
        a.localeCompare(b),
    );
    return Object.fromEntries(entries) as Record<string, string>;
}

function getRootDependencyFingerprintPayload(): {
    dependencies: Record<string, string>;
    optionalDependencies: Record<string, string>;
} {
    const rootPackageJsonPath = join(process.cwd(), "package.json");
    if (!existsSync(rootPackageJsonPath)) {
        throw new Error(
            `Cannot compute catalog fingerprint: '${rootPackageJsonPath}' not found.`,
        );
    }

    const rootPackageJson = JSON.parse(
        readFileSync(rootPackageJsonPath, "utf8"),
    ) as {
        dependencies?: Record<string, string>;
        optionalDependencies?: Record<string, string>;
    };

    return {
        dependencies: sortStringRecord(rootPackageJson.dependencies),
        optionalDependencies: sortStringRecord(
            rootPackageJson.optionalDependencies,
        ),
    };
}

function getLockfileSignature(lockfileName: string): string {
    const path = join(process.cwd(), lockfileName);
    if (!existsSync(path)) {
        return `${lockfileName}:missing`;
    }

    try {
        const stats = statSync(path);
        return `${lockfileName}:${stats.size}:${Math.floor(stats.mtimeMs)}`;
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        return `${lockfileName}:error:${reason}`;
    }
}

function computeCatalogFingerprint(): string {
    const dependencyPayload = getRootDependencyFingerprintPayload();
    const allowlist = process.env.DISCORD_MCP_SYMBOL_PACKAGE_ALLOWLIST || "";
    const lockfiles = CATALOG_LOCKFILES.map((lockfile) =>
        getLockfileSignature(lockfile),
    );
    const payload = {
        allowlist,
        ...dependencyPayload,
        lockfiles,
    };
    return createHash("sha256")
        .update(JSON.stringify(payload))
        .digest("hex");
}

function getConfiguredRefreshIntervalMs(): number | null {
    const raw = process.env[CATALOG_REFRESH_INTERVAL_ENV];
    if (!raw || !raw.trim()) {
        return null;
    }

    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed < 1_000) {
        return null;
    }

    return parsed;
}

function ensureCatalogRefreshLoop(): void {
    if (refreshLoopHandle) {
        return;
    }

    const intervalMs = getConfiguredRefreshIntervalMs();
    if (!intervalMs) {
        return;
    }

    refreshLoopHandle = setInterval(() => {
        void getOrRefreshCatalog().catch(() => undefined);
    }, intervalMs);
    refreshLoopHandle.unref();
}

function compareSymbols(a: DiscordJsSymbol, b: DiscordJsSymbol): number {
    const byName = a.name.localeCompare(b.name);
    if (byName !== 0) {
        return byName;
    }

    const byKind = a.kind.localeCompare(b.kind);
    if (byKind !== 0) {
        return byKind;
    }

    return a.packageAlias.localeCompare(b.packageAlias);
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

function toDocsPath(
    packageName: string,
    version: string,
    name: string,
    kind: DiscordJsSymbolKind,
): string | undefined {
    if (packageName !== "discord.js") {
        return undefined;
    }

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

function createOperationKey(kind: DiscordJsSymbolKind): string {
    return kind === "function" ? "discord.exec.invoke" : "discord.meta.symbols";
}

function createSymbol(
    runtimePackage: DiscordRuntimePackage,
    name: string,
    kind: DiscordJsSymbolKind,
    metadata: {
        origin?: "runtime" | "types";
        declaredOn?: string;
        aliasOf?: string;
    } = {},
): DiscordJsSymbol {
    const origin = metadata.origin || "runtime";
    const operationKey = createOperationKey(kind);
    return {
        name,
        kind,
        source: runtimePackage.packageName,
        packageName: runtimePackage.packageName,
        packageAlias: runtimePackage.packageAlias,
        moduleVersion: runtimePackage.version,
        origin,
        behaviorClass: classifyDiscordJsSymbolBehavior(name, kind),
        invokable: kind === "function" && origin === "runtime",
        operationKey,
        docsPath: toDocsPath(
            runtimePackage.packageName,
            runtimePackage.version,
            name,
            kind,
        ),
        declaredOn: metadata.declaredOn,
        aliasOf: metadata.aliasOf,
    };
}

function isIdentifier(value: string): boolean {
    return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(value);
}

function addSymbol(
    symbolMap: Map<string, DiscordJsSymbol>,
    runtimePackage: DiscordRuntimePackage,
    name: string,
    kind: DiscordJsSymbolKind,
    metadata: {
        origin?: "runtime" | "types";
        declaredOn?: string;
        aliasOf?: string;
    } = {},
): void {
    const trimmedName = name.trim();
    if (!trimmedName) {
        return;
    }

    const key = `${runtimePackage.packageAlias}:${kind}:${trimmedName}`;
    if (symbolMap.has(key)) {
        return;
    }

    symbolMap.set(
        key,
        createSymbol(runtimePackage, trimmedName, kind, metadata),
    );
}

function addMethodSymbol(
    symbolMap: Map<string, DiscordJsSymbol>,
    runtimePackage: DiscordRuntimePackage,
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

    addSymbol(symbolMap, runtimePackage, compositeName, "function", {
        declaredOn: metadata.declaredOn,
        aliasOf: metadata.aliasOf,
    });
}

function addTopLevelRuntimeExportSymbol(
    symbolMap: Map<string, DiscordJsSymbol>,
    runtimePackage: DiscordRuntimePackage,
    exportName: string,
    value: unknown,
): void {
    const runtimeKind = runtimeKindForValue(value);
    if (!runtimeKind || !isIdentifier(exportName)) {
        return;
    }

    addSymbol(symbolMap, runtimePackage, exportName, runtimeKind);
    if (runtimeKind === "const") {
        addSymbol(symbolMap, runtimePackage, exportName, "variable");
    }
}

function isClassConstructor(value: unknown): value is new (...args: unknown[]) => unknown {
    if (typeof value !== "function") {
        return false;
    }

    const source = Function.prototype.toString.call(value);
    return source.startsWith("class ");
}

function isEnumLikeRuntimeExport(value: unknown): boolean {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return false;
    }

    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) {
        return false;
    }

    let hasNamedKey = false;
    for (const [key, candidate] of entries) {
        const keyIsNumeric = /^\d+$/.test(key);
        if (!keyIsNumeric) {
            hasNamedKey = true;
        }

        if (
            typeof candidate !== "string" &&
            typeof candidate !== "number" &&
            typeof candidate !== "bigint"
        ) {
            return false;
        }

        if (keyIsNumeric && typeof candidate !== "string") {
            return false;
        }
    }

    return hasNamedKey;
}

function runtimeKindForValue(value: unknown): DiscordJsSymbolKind | null {
    if (typeof value === "function") {
        return isClassConstructor(value) ? "class" : "function";
    }

    if (isEnumLikeRuntimeExport(value)) {
        return "enum";
    }

    if (value !== undefined) {
        return "const";
    }

    return null;
}

function addInstanceMethodSymbolsFromRuntimeClass(
    symbolMap: Map<string, DiscordJsSymbol>,
    runtimePackage: DiscordRuntimePackage,
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
                    runtimePackage,
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
                    runtimePackage,
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
    runtimePackage: DiscordRuntimePackage,
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
                    runtimePackage,
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
                    runtimePackage,
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

function resolvePackageManifestPathFromModule(
    packageName: string,
    moduleEntryPath: string,
): string | null {
    let currentDir = dirname(moduleEntryPath);

    while (true) {
        const candidate = join(currentDir, "package.json");
        if (existsSync(candidate)) {
            const packageJson = require(candidate) as {
                name?: string;
            };
            if (packageJson.name === packageName) {
                return candidate;
            }
        }

        const nextDir = dirname(currentDir);
        if (nextDir === currentDir) {
            break;
        }
        currentDir = nextDir;
    }

    return null;
}

function resolvePackageManifestPath(packageName: string): string | null {
    try {
        return require.resolve(`${packageName}/package.json`);
    } catch {
        // Fall back to module entry traversal for packages that do not export package.json.
    }

    try {
        const moduleEntryPath = require.resolve(packageName);
        return resolvePackageManifestPathFromModule(packageName, moduleEntryPath);
    } catch {
        return null;
    }
}

function collectDeclarationPathsFromExports(exportsField: unknown): string[] {
    if (!exportsField) {
        return [];
    }

    if (typeof exportsField === "string") {
        return exportsField.endsWith(".d.ts") ? [exportsField] : [];
    }

    if (Array.isArray(exportsField)) {
        return exportsField.flatMap((entry) =>
            collectDeclarationPathsFromExports(entry),
        );
    }

    if (typeof exportsField === "object") {
        const record = exportsField as Record<string, unknown>;
        const directTypes = typeof record.types === "string" ? [record.types] : [];
        const nested = Object.values(record).flatMap((entry) =>
            collectDeclarationPathsFromExports(entry),
        );
        return [...directTypes, ...nested];
    }

    return [];
}

function resolveTypeDeclarationPath(packageName: string): string | null {
    const manifestPath = resolvePackageManifestPath(packageName);
    if (!manifestPath) {
        return null;
    }

    const manifest = require(manifestPath) as {
        types?: string;
        typings?: string;
        exports?: unknown;
    };
    const packageDir = dirname(manifestPath);

    const candidates = new Set<string>();
    if (typeof manifest.types === "string") {
        candidates.add(manifest.types);
    }
    if (typeof manifest.typings === "string") {
        candidates.add(manifest.typings);
    }

    for (const exportedPath of collectDeclarationPathsFromExports(
        manifest.exports,
    )) {
        candidates.add(exportedPath);
    }

    const fallbackCandidates = [
        "index.d.ts",
        "dist/index.d.ts",
        "typings/index.d.ts",
        "lib/index.d.ts",
    ];
    for (const fallbackPath of fallbackCandidates) {
        candidates.add(fallbackPath);
    }

    for (const candidate of candidates) {
        const trimmed = candidate.trim();
        if (!trimmed) {
            continue;
        }
        const absolutePath = trimmed.startsWith("/")
            ? trimmed
            : join(packageDir, trimmed.replace(/^\.\//, ""));
        if (existsSync(absolutePath) && absolutePath.endsWith(".d.ts")) {
            return absolutePath;
        }
    }

    return null;
}

function addDeclarationSymbolsFromTypeFile(
    symbolMap: Map<string, DiscordJsSymbol>,
    runtimePackage: DiscordRuntimePackage,
): void {
    const declarationPath = resolveTypeDeclarationPath(runtimePackage.packageName);
    if (!declarationPath) {
        return;
    }

    let source: string;
    try {
        source = readFileSync(declarationPath, "utf8");
    } catch {
        return;
    }

    const addNamedMatches = (
        pattern: RegExp,
        kind: DiscordJsSymbolKind,
        postProcess?: (name: string) => void,
    ) => {
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(source)) !== null) {
            const name = match[1];
            if (!isIdentifier(name)) {
                continue;
            }
            addSymbol(symbolMap, runtimePackage, name, kind, {
                origin: "types",
            });
            if (postProcess) {
                postProcess(name);
            }
        }
    };

    addNamedMatches(
        /export\s+(?:declare\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][A-Za-z0-9_$]*)/g,
        "class",
    );
    addNamedMatches(
        /export\s+(?:declare\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g,
        "function",
    );
    addNamedMatches(
        /export\s+(?:declare\s+)?(?:const\s+)?enum\s+([A-Za-z_$][A-Za-z0-9_$]*)/g,
        "enum",
    );
    addNamedMatches(
        /export\s+(?:declare\s+)?interface\s+([A-Za-z_$][A-Za-z0-9_$]*)/g,
        "interface",
    );
    addNamedMatches(
        /export\s+(?:declare\s+)?type\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=/g,
        "type",
    );
    addNamedMatches(
        /export\s+(?:declare\s+)?namespace\s+([A-Za-z_$][A-Za-z0-9_$]*)/g,
        "namespace",
    );

    let variableMatch: RegExpExecArray | null;
    const variablePattern =
        /export\s+(?:declare\s+)?(const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)/g;
    while ((variableMatch = variablePattern.exec(source)) !== null) {
        const declarationType = variableMatch[1];
        const variableName = variableMatch[2];
        if (!isIdentifier(variableName)) {
            continue;
        }

        if (declarationType === "const") {
            addSymbol(symbolMap, runtimePackage, variableName, "const", {
                origin: "types",
            });
        }
        addSymbol(symbolMap, runtimePackage, variableName, "variable", {
            origin: "types",
        });
    }
}

function normalizePackageSelector(selector: string): string {
    return selector.trim().toLowerCase();
}

function resolvePackageAliasesFromSelectors(
    packages: DiscordRuntimePackage[],
    selectors: string[],
): Set<string> {
    const resolved = new Set<string>();
    const knownLabels = packages
        .map((entry) => `${entry.packageAlias} (${entry.packageName})`)
        .join(", ");

    for (const selector of selectors) {
        const normalizedSelector = normalizePackageSelector(selector);
        if (!normalizedSelector) {
            continue;
        }

        const matchedPackage = packages.find(
            (entry) =>
                entry.packageAlias === normalizedSelector ||
                entry.packageName.toLowerCase() === normalizedSelector,
        );
        if (!matchedPackage) {
            throw new Error(
                `Unknown runtime package selector '${selector}'. Known packages: ${knownLabels}.`,
            );
        }

        resolved.add(matchedPackage.packageAlias);
    }

    return resolved;
}

function sortPackages(
    packages: readonly DiscordRuntimePackage[],
): DiscordRuntimePackage[] {
    return [...packages].sort((a, b) =>
        a.packageAlias.localeCompare(b.packageAlias),
    );
}

async function buildCatalog(
    fingerprint: string,
): Promise<DiscordPackageCatalogSnapshot> {
    const runtimePackages = listDiscordRuntimePackages({ force: true });
    const loadedPackages: DiscordRuntimePackage[] = [];
    const runtimeExportsByAlias = new Map<string, Record<string, unknown>>();
    const symbolMap = new Map<string, DiscordJsSymbol>();

    for (const runtimePackage of runtimePackages) {
        let runtimeExports: Record<string, unknown>;
        try {
            runtimeExports = (await import(runtimePackage.packageName)) as Record<
                string,
                unknown
            >;
        } catch (error) {
            if (runtimePackage.packageName === "discord.js") {
                throw new Error(
                    `Unable to import required runtime package 'discord.js': ${error instanceof Error ? error.message : String(error)}`,
                );
            }
            continue;
        }

        loadedPackages.push(runtimePackage);
        runtimeExportsByAlias.set(runtimePackage.packageAlias, runtimeExports);

        for (const [exportName, value] of Object.entries(runtimeExports)) {
            if (exportName === "default") {
                continue;
            }

            addTopLevelRuntimeExportSymbol(
                symbolMap,
                runtimePackage,
                exportName,
                value,
            );

            if (!isClassConstructor(value)) {
                continue;
            }

            addInstanceMethodSymbolsFromRuntimeClass(
                symbolMap,
                runtimePackage,
                exportName,
                value,
            );
            addStaticMethodSymbolsFromRuntimeClass(
                symbolMap,
                runtimePackage,
                exportName,
                value,
            );
        }

        const eventNames = extractRuntimeEventNames(runtimeExports);
        for (const eventName of eventNames) {
            addSymbol(symbolMap, runtimePackage, eventName, "event");
        }

        addDeclarationSymbolsFromTypeFile(symbolMap, runtimePackage);
    }

    if (loadedPackages.length === 0) {
        throw new Error("No runtime Discord packages were successfully imported.");
    }

    return {
        catalogFingerprint: fingerprint,
        catalogBuiltAt: new Date().toISOString(),
        packages: sortPackages(loadedPackages),
        symbols: Array.from(symbolMap.values()).sort(compareSymbols),
        runtimeExportsByAlias,
    };
}

async function getOrRefreshCatalog(options: {
    force?: boolean;
} = {}): Promise<CatalogAccessResult> {
    ensureCatalogRefreshLoop();
    const force = options.force === true;
    const currentFingerprint = computeCatalogFingerprint();
    if (
        !force &&
        catalogSnapshot &&
        catalogSnapshot.catalogFingerprint === currentFingerprint
    ) {
        return {
            snapshot: catalogSnapshot,
            isFresh: true,
            previousSnapshot: catalogSnapshot,
            didRebuild: false,
        };
    }

    if (refreshPromise) {
        return refreshPromise;
    }

    const previousSnapshot = catalogSnapshot;
    refreshPromise = (async (): Promise<CatalogAccessResult> => {
        const nextSnapshot = await buildCatalog(currentFingerprint);
        catalogSnapshot = nextSnapshot;
        return {
            snapshot: nextSnapshot,
            isFresh: true,
            previousSnapshot,
            didRebuild: true,
        };
    })();

    try {
        return await refreshPromise;
    } finally {
        refreshPromise = null;
    }
}

export async function listLoadedDiscordRuntimePackages(): Promise<
    DiscordPackageDescriptor[]
> {
    const access = await getOrRefreshCatalog();
    const baseCatalog = access.snapshot;
    return baseCatalog.packages.map((entry) => ({
        packageName: entry.packageName,
        packageAlias: entry.packageAlias,
        version: entry.version,
    }));
}

export async function getDiscordCatalogMetadata(): Promise<{
    catalogFingerprint: string;
    catalogBuiltAt: string;
    isFresh: boolean;
}> {
    const access = await getOrRefreshCatalog();
    return {
        catalogFingerprint: access.snapshot.catalogFingerprint,
        catalogBuiltAt: access.snapshot.catalogBuiltAt,
        isFresh: access.isFresh,
    };
}

function toCatalogDiffPackageList(
    previousSnapshot: DiscordCatalogDiffInput | null,
    nextSnapshot: DiscordCatalogDiffInput,
): DiscordCatalogDiffPackageChange[] {
    const previousByAlias = new Map<string, DiscordRuntimePackage>(
        (previousSnapshot?.packages || []).map((entry) => [entry.packageAlias, entry]),
    );
    const nextByAlias = new Map<string, DiscordRuntimePackage>(
        nextSnapshot.packages.map((entry) => [entry.packageAlias, entry]),
    );

    const aliases = new Set<string>([
        ...previousByAlias.keys(),
        ...nextByAlias.keys(),
    ]);
    const changes: DiscordCatalogDiffPackageChange[] = [];

    for (const alias of aliases) {
        const previous = previousByAlias.get(alias);
        const next = nextByAlias.get(alias);
        if (!previous && next) {
            changes.push({
                packageAlias: alias,
                packageName: next.packageName,
                nextVersion: next.version,
                changeType: "added",
            });
            continue;
        }
        if (previous && !next) {
            changes.push({
                packageAlias: alias,
                packageName: previous.packageName,
                previousVersion: previous.version,
                changeType: "removed",
            });
            continue;
        }

        if (
            previous &&
            next &&
            (previous.version !== next.version ||
                previous.packageName !== next.packageName)
        ) {
            changes.push({
                packageAlias: alias,
                packageName: next.packageName,
                previousVersion: previous.version,
                nextVersion: next.version,
                changeType: "updated",
            });
        }
    }

    return changes.sort((a, b) => a.packageAlias.localeCompare(b.packageAlias));
}

function symbolKey(symbol: DiscordJsSymbol): string {
    return `${symbol.packageAlias}:${symbol.kind}:${symbol.name}`;
}

function createZeroKindCounts(): DiscordJsKindCounts {
    const counts: DiscordJsKindCounts = {};
    for (const kind of ALL_KINDS) {
        counts[kind] = 0;
    }
    return counts;
}

export function calculateDiscordCatalogDiff(
    previousSnapshot: DiscordCatalogDiffInput | null,
    nextSnapshot: DiscordCatalogDiffInput,
): DiscordCatalogDiff {
    const previousSymbolMap = new Map<string, DiscordJsSymbol>(
        (previousSnapshot?.symbols || []).map((entry) => [symbolKey(entry), entry]),
    );
    const nextSymbolMap = new Map<string, DiscordJsSymbol>(
        nextSnapshot.symbols.map((entry) => [symbolKey(entry), entry]),
    );

    const addedSymbols: DiscordJsSymbol[] = [];
    const removedSymbols: DiscordJsSymbol[] = [];
    for (const [key, symbol] of nextSymbolMap.entries()) {
        if (!previousSymbolMap.has(key)) {
            addedSymbols.push(symbol);
        }
    }
    for (const [key, symbol] of previousSymbolMap.entries()) {
        if (!nextSymbolMap.has(key)) {
            removedSymbols.push(symbol);
        }
    }

    const kindCountsDelta: DiscordJsKindCounts = {};
    for (const kind of ALL_KINDS) {
        kindCountsDelta[kind] = 0;
    }
    for (const symbol of addedSymbols) {
        kindCountsDelta[symbol.kind] = (kindCountsDelta[symbol.kind] || 0) + 1;
    }
    for (const symbol of removedSymbols) {
        kindCountsDelta[symbol.kind] = (kindCountsDelta[symbol.kind] || 0) - 1;
    }

    return {
        changedPackages: toCatalogDiffPackageList(
            previousSnapshot,
            nextSnapshot,
        ),
        addedSymbols: addedSymbols.sort(compareSymbols),
        removedSymbols: removedSymbols.sort(compareSymbols),
        kindCountsDelta,
    };
}

export async function refreshDiscordRuntimeCatalog(options: {
    force?: boolean;
    includeDiff?: boolean;
} = {}): Promise<DiscordCatalogRefreshResult> {
    const includeDiff = options.includeDiff !== false;
    const access = await getOrRefreshCatalog({
        force: options.force === true,
    });
    const snapshot = access.snapshot;
    const diff = includeDiff
        ? calculateDiscordCatalogDiff(access.previousSnapshot, snapshot)
        : {
              changedPackages: [],
              addedSymbols: [],
              removedSymbols: [],
              kindCountsDelta: createZeroKindCounts(),
          };

    return {
        catalogFingerprint: snapshot.catalogFingerprint,
        catalogBuiltAt: snapshot.catalogBuiltAt,
        isFresh: access.isFresh,
        didRebuild: access.didRebuild,
        packageCount: snapshot.packages.length,
        symbolCount: snapshot.symbols.length,
        changedPackages: diff.changedPackages,
        addedSymbols: diff.addedSymbols,
        removedSymbols: diff.removedSymbols,
        kindCountsDelta: diff.kindCountsDelta,
    };
}

export async function resolveLoadedDiscordRuntimePackageByAlias(
    packageAlias: string,
): Promise<DiscordPackageDescriptor> {
    const normalizedAlias = packageAlias.trim().toLowerCase();
    const access = await getOrRefreshCatalog();
    const baseCatalog = access.snapshot;
    const matchedPackage = baseCatalog.packages.find(
        (entry) => entry.packageAlias === normalizedAlias,
    );
    if (!matchedPackage) {
        const known = baseCatalog.packages
            .map((entry) => entry.packageAlias)
            .join(", ");
        throw new Error(
            `Unknown runtime package alias '${packageAlias}'. Available aliases: ${known}.`,
        );
    }

    return {
        packageName: matchedPackage.packageName,
        packageAlias: matchedPackage.packageAlias,
        version: matchedPackage.version,
    };
}

export async function getDiscordRuntimeExportsByAlias(
    packageAlias: string,
): Promise<Record<string, unknown>> {
    const normalizedAlias = packageAlias.trim().toLowerCase();
    const access = await getOrRefreshCatalog();
    const baseCatalog = access.snapshot;
    const runtimeExports = baseCatalog.runtimeExportsByAlias.get(normalizedAlias);
    if (runtimeExports) {
        return runtimeExports;
    }

    const known = baseCatalog.packages
        .map((entry) => entry.packageAlias)
        .join(", ");
    throw new Error(
        `Runtime exports are unavailable for package alias '${packageAlias}'. Available aliases: ${known}.`,
    );
}

export async function getDiscordPackageSymbolsCatalog(
    options: GetDiscordPackageSymbolsOptions = {},
): Promise<DiscordPackageSymbolsCatalog> {
    const access = await getOrRefreshCatalog();
    const baseCatalog = access.snapshot;
    const page = options.page ?? DEFAULT_PAGE;
    const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
    const sort = options.sort ?? "name_asc";
    const includeAliases = options.includeAliases ?? true;
    const kinds =
        options.kinds && options.kinds.length > 0
            ? Array.from(new Set(options.kinds))
            : [...ALL_KINDS];
    const normalizedQuery = options.query?.trim().toLowerCase();

    const selectors = [
        ...(options.package ? [options.package] : []),
        ...(options.packages || []),
    ];
    const selectedAliases =
        selectors.length > 0
            ? resolvePackageAliasesFromSelectors(baseCatalog.packages, selectors)
            : null;

    let filteredSymbols = baseCatalog.symbols.filter((symbol) =>
        kinds.includes(symbol.kind),
    );

    if (selectedAliases) {
        filteredSymbols = filteredSymbols.filter((symbol) =>
            selectedAliases.has(symbol.packageAlias),
        );
    }

    if (!includeAliases) {
        filteredSymbols = filteredSymbols.filter((symbol) => !symbol.aliasOf);
    }

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

        const byKind = a.kind.localeCompare(b.kind) * direction;
        if (byKind !== 0) {
            return byKind;
        }

        return a.packageAlias.localeCompare(b.packageAlias) * direction;
    });

    let kindCounts: DiscordJsKindCounts | undefined;
    if (options.includeKindCounts) {
        kindCounts = {};
        for (const kind of kinds) {
            kindCounts[kind] = 0;
        }
        for (const symbol of filteredSymbols) {
            kindCounts[symbol.kind] = (kindCounts[symbol.kind] || 0) + 1;
        }
    }

    const total = filteredSymbols.length;
    const start = (page - 1) * pageSize;
    const end = start + pageSize;
    const items = filteredSymbols.slice(start, end);

    const selectedPackages = selectedAliases
        ? baseCatalog.packages.filter((entry) =>
              selectedAliases.has(entry.packageAlias),
          )
        : baseCatalog.packages;

    return {
        package: "discord.packages",
        catalogFingerprint: baseCatalog.catalogFingerprint,
        catalogBuiltAt: baseCatalog.catalogBuiltAt,
        isFresh: access.isFresh,
        packageCount: selectedPackages.length,
        packages: selectedPackages.map((entry) => ({
            packageName: entry.packageName,
            packageAlias: entry.packageAlias,
            version: entry.version,
        })),
        kinds,
        total,
        page,
        pageSize,
        items,
        kindCounts,
    };
}

export async function getDiscordJsSymbolsCatalog(
    options: GetDiscordJsSymbolsOptions = {},
): Promise<DiscordJsSymbolCatalog> {
    const packageCatalog = await getDiscordPackageSymbolsCatalog({
        ...options,
        package: DISCORDJS_ALIAS,
    });
    const discordJsPackage = packageCatalog.packages.find(
        (entry) => entry.packageAlias === DISCORDJS_ALIAS,
    );
    if (!discordJsPackage) {
        throw new Error("The required runtime package 'discord.js' is unavailable.");
    }

    const compatibilityItems = packageCatalog.items.map((item) => ({
        ...item,
        source: "discord.js",
        operationKey: item.operationKey,
    }));

    return {
        package: "discord.js",
        version: discordJsPackage.version,
        catalogFingerprint: packageCatalog.catalogFingerprint,
        catalogBuiltAt: packageCatalog.catalogBuiltAt,
        isFresh: packageCatalog.isFresh,
        kinds: packageCatalog.kinds,
        total: packageCatalog.total,
        page: packageCatalog.page,
        pageSize: packageCatalog.pageSize,
        items: compatibilityItems,
        kindCounts: packageCatalog.kindCounts,
    };
}
