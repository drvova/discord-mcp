import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

export type DiscordRuntimePackage = {
    packageName: string;
    packageAlias: string;
    version: string;
};

const DEFAULT_PACKAGE_ALLOWLIST = ["discord.js", "@discordjs/*"];
const PACKAGE_ALLOWLIST_ENV = "DISCORD_MCP_SYMBOL_PACKAGE_ALLOWLIST";

const require = createRequire(import.meta.url);

let packageCache: DiscordRuntimePackage[] | null = null;

function parseAllowlistPatterns(): string[] {
    const configured = process.env[PACKAGE_ALLOWLIST_ENV];
    if (!configured || !configured.trim()) {
        return DEFAULT_PACKAGE_ALLOWLIST;
    }

    const parsed = configured
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
    return parsed.length > 0 ? parsed : DEFAULT_PACKAGE_ALLOWLIST;
}

function matchesAllowlistPattern(packageName: string, pattern: string): boolean {
    const normalizedPattern = pattern.trim();
    if (!normalizedPattern) {
        return false;
    }

    if (normalizedPattern.endsWith("*")) {
        const prefix = normalizedPattern.slice(0, -1);
        return packageName.startsWith(prefix);
    }

    return packageName === normalizedPattern;
}

function isAllowedPackageName(packageName: string, patterns: string[]): boolean {
    for (const pattern of patterns) {
        if (matchesAllowlistPattern(packageName, pattern)) {
            return true;
        }
    }
    return false;
}

function sortPackageNames(a: string, b: string): number {
    if (a === "discord.js" && b !== "discord.js") {
        return -1;
    }
    if (a !== "discord.js" && b === "discord.js") {
        return 1;
    }
    return a.localeCompare(b);
}

function normalizePackageAlias(packageName: string): string {
    if (packageName === "discord.js") {
        return "discordjs";
    }

    if (packageName.startsWith("@discordjs/")) {
        const suffix = packageName.slice("@discordjs/".length);
        const normalizedSuffix = suffix
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "_")
            .replace(/^_+|_+$/g, "");
        return `discordjs_${normalizedSuffix}`;
    }

    return packageName
        .toLowerCase()
        .replace(/^@/, "")
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "");
}

function resolvePackageJsonPathFromModule(
    packageName: string,
    moduleEntryPath: string,
): string {
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

    throw new Error(
        `Unable to resolve package.json path for package '${packageName}'.`,
    );
}

function resolvePackageVersion(packageName: string): string {
    try {
        const packageJsonPath = require.resolve(`${packageName}/package.json`);
        const packageJson = require(packageJsonPath) as {
            version?: string;
        };
        if (packageJson.version) {
            return packageJson.version;
        }
    } catch {
        // Fallback to module-entry traversal when package.json exports are blocked.
    }

    const moduleEntryPath = require.resolve(packageName);
    const packageJsonPath = resolvePackageJsonPathFromModule(
        packageName,
        moduleEntryPath,
    );
    const packageJson = require(packageJsonPath) as {
        version?: string;
    };
    if (!packageJson.version) {
        throw new Error(
            `Unable to resolve installed package version for '${packageName}'.`,
        );
    }

    return packageJson.version;
}

function getRootDependencyNames(): string[] {
    const rootPackageJsonPath = join(process.cwd(), "package.json");
    if (!existsSync(rootPackageJsonPath)) {
        throw new Error(
            `Cannot discover runtime packages: '${rootPackageJsonPath}' not found.`,
        );
    }

    const rootPackageJson = require(rootPackageJsonPath) as {
        dependencies?: Record<string, string>;
        optionalDependencies?: Record<string, string>;
    };

    const dependencyNames = new Set<string>([
        ...Object.keys(rootPackageJson.dependencies || {}),
        ...Object.keys(rootPackageJson.optionalDependencies || {}),
    ]);

    if (!dependencyNames.has("discord.js")) {
        dependencyNames.add("discord.js");
    }

    return Array.from(dependencyNames).sort(sortPackageNames);
}

export function listDiscordRuntimePackages(): DiscordRuntimePackage[] {
    if (packageCache) {
        return packageCache;
    }

    const allowlistPatterns = parseAllowlistPatterns();
    const candidateNames = getRootDependencyNames().filter((packageName) =>
        isAllowedPackageName(packageName, allowlistPatterns),
    );

    const discoveredPackages: DiscordRuntimePackage[] = [];
    const aliasToPackageName = new Map<string, string>();

    for (const packageName of candidateNames) {
        const version = resolvePackageVersion(packageName);
        const packageAlias = normalizePackageAlias(packageName);
        const existingPackageName = aliasToPackageName.get(packageAlias);
        if (existingPackageName && existingPackageName !== packageName) {
            throw new Error(
                `Package alias collision detected: '${packageAlias}' maps to both '${existingPackageName}' and '${packageName}'.`,
            );
        }

        aliasToPackageName.set(packageAlias, packageName);
        discoveredPackages.push({
            packageName,
            packageAlias,
            version,
        });
    }

    if (discoveredPackages.length === 0) {
        throw new Error(
            `No runtime packages matched the allowlist (${allowlistPatterns.join(", ")}).`,
        );
    }

    packageCache = discoveredPackages;
    return packageCache;
}

export function resolveDiscordRuntimePackageByAlias(
    packageAlias: string,
): DiscordRuntimePackage | null {
    const normalizedAlias = packageAlias.trim().toLowerCase();
    if (!normalizedAlias) {
        return null;
    }

    const packages = listDiscordRuntimePackages();
    return (
        packages.find((entry) => entry.packageAlias === normalizedAlias) || null
    );
}
