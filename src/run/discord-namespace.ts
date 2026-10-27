import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import * as discordJs from "discord.js";
import type { DiscordService } from "../discord-service.js";
import { runDiscordOperation } from "../gateway/discord-operations.js";
import {
    DISCORD_EXEC_BATCH_OPERATION,
    DISCORD_EXEC_INVOKE_OPERATION,
    DISCORD_META_PACKAGES_OPERATION,
    DISCORD_META_PREFLIGHT_OPERATION,
    DISCORD_META_REFRESH_OPERATION,
    DISCORD_META_SYMBOLS_OPERATION,
} from "../gateway/domain-registry.js";
import {
    getDiscordPackageSymbolsCatalog,
    getDiscordRuntimeExportsByAlias,
    listLoadedDiscordRuntimePackages,
    type GetDiscordPackageSymbolsOptions,
} from "../gateway/discordjs-symbol-catalog.js";
import type {
    IdentityMode,
    LocalEncryptedIdentityStore,
} from "../identity/local-encrypted-identity-store.js";
import { CodeHarness, type DescribeHooks, type RunResult } from "./harness.js";
import { McpUpstreams, type UpstreamConfig } from "./mcp-upstreams.js";
import { LatencyTracker } from "../net/latency.js";
import { createFetch, describeNetwork, type NetworkConfig } from "../net/network.js";

// Seeds the run tool's namespace with the project's Discord API: identities
// (the working objects), the bound discord.js client, the runtime package
// catalog, and the pre-existing operations reachable as plain functions.

export type BoundIdentity = { id: string; mode: IdentityMode };

export type DiscordNamespaceDeps = {
    getService: () => DiscordService | undefined;
    identityStore: LocalEncryptedIdentityStore;
    persistDir?: string;
    upstreams?: McpUpstreams;
    network?: NetworkConfig;
    latency?: LatencyTracker;
    onLoadError?: (name: string, error: unknown) => void;
};

export type DiscordHarness = {
    harness: CodeHarness;
    bind: (identityId: string) => Promise<discordJs.Client>;
    bound: () => BoundIdentity | undefined;
    upstreams: McpUpstreams;
    run: (
        code: string,
        options?: { identity?: string; vars?: Record<string, string> },
    ) => Promise<RunResult>;
};

export const DISCORD_NAMESPACE_MANUAL = `discord-mcp \`run\` tool — manual

Every call runs JavaScript in ONE long-lived namespace with this server's full
authority (Discord tokens, network, filesystem, process). Run the server
sandboxed (container/VM). Top-level \`await\` works. The call returns whatever
you print plus the value of the last expression.

Persistence
  Top-level declarations stay defined for later calls. Top-level function and
  class declarations, and \`const\` bindings to literals/functions/classes, are
  also saved to disk and reloaded after a restart: build helpers once, reuse
  and refine them. Anything else (calls, \`let\`, side effects) is never
  replayed.
  kept()             -> saved definitions [{ name, kind, loaded, error? }]
  kept(name)         -> a saved definition's source
  forget(name)       -> delete a saved definition and unbind it

Working objects (Discord identities)
  identities()               -> [{ id, mode, bound }]
  connect(id, { mode, token }) -> create/update an identity, log in, bind it
  bind(id)                   -> log in as an existing identity; sets \`client\`
  client                     -> the bound discord.js Client (drive its full API)
  identity                   -> { id, mode } of the bound identity, if any
  The tool's \`identity\` argument binds an identity before your code runs.

What the project offers
  packages()                 -> loaded Discord runtime packages
  symbols(query | options)   -> search their exported symbols
  pkg(alias)                 -> a runtime package's exports (e.g. pkg("discordjs_voice"))
  discord                    -> the discord.js module (classes, enums, builders)
  ops.packages|symbols|preflight|refresh|invoke|batch(params)
                             -> the older structured operations, as functions
  service                    -> the underlying DiscordService

Other MCP servers, as functions (code mode)
  mcp.<server>.<tool>(args)  -> call a connected MCP server's tool. Resolves to its
                                structured result, or its text (parsed if JSON);
                                throws on tool errors. Compose calls in code and
                                print only what you need.
  describe(mcp.<server>)     -> every tool's signature (from its input schema) and doc
  mcpServers()               -> [{ name, transport, connected, tools, url?, latency?, error? }]
  mcpConnect(name, config)   -> connect one now: { url, headers? } (streamable HTTP,
                                falls back to SSE) or { command, args?, env? } (stdio)
  mcpDisconnect(name)
  Servers in DISCORD_MCP_UPSTREAMS connect at startup. Kept helpers that wrap
  mcp.* tools keep working after a restart once their server reconnects.

Network
  network()         -> proxy (redacted), what is and isn't proxied, TLS policy,
                       and round-trip latency per identity (Discord REST) and per
                       server (upstream MCP), plus the gateway ping. Labelled by
                       identity/server name only; tokens never appear.
  Upstream MCP servers must use https:// (http only to localhost). fetch() goes
  through DISCORD_MCP_PROXY when it is set.

Introspection and I/O
  describe(x)       -> live capabilities + members with signatures and docs
  man()             -> this manual
  vars              -> named strings passed in the tool's \`vars\` argument
                       (use for long text/payloads instead of escaping in code)
  print(...), console.log(...)
  fetch, require, sleep(ms), Buffer, URL, setTimeout, process

Start with:  describe(client)   or   await bind("default-bot")`;

let docIndex: Map<string, string> | undefined;

function firstDocLine(comment: string): string | undefined {
    return comment
        .split("\n")
        .map((line) => line.replace(/^\s*\*?\s?/, "").trim())
        .find((line) => line.length > 0 && !line.startsWith("@"));
}

// One-line JSDoc summaries from discord.js's own source, keyed `Class#member`.
// Built lazily on the first describe() and cached for the process.
function discordJsDocIndex(): Map<string, string> {
    if (docIndex) {
        return docIndex;
    }
    docIndex = new Map();
    let root: string;
    try {
        root = dirname(createRequire(import.meta.url).resolve("discord.js"));
    } catch {
        return docIndex;
    }

    const files: string[] = [];
    const walk = (dir: string) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const path = join(dir, entry.name);
            if (entry.isDirectory()) {
                walk(path);
            } else if (entry.name.endsWith(".js")) {
                files.push(path);
            }
        }
    };
    walk(root);

    const classPattern = /^(?: {2})?class\s+([A-Za-z_$][\w$]*)/gm;
    const docPattern =
        /\/\*\*((?:(?!\*\/)[\s\S])*?)\*\/\s*\n\s*(?:(class)\s+([A-Za-z_$][\w$]*)|this\.([A-Za-z_$][\w$]*)\s*=|(?:static\s+)?(?:async\s+)?(?:get\s+|set\s+)?\*?([A-Za-z_$][\w$]*)\s*\()/g;

    for (const file of files) {
        const source = readFileSync(file, "utf8");
        const classes = Array.from(source.matchAll(classPattern)).map(
            (match) => ({ index: match.index ?? 0, name: match[1] }),
        );
        for (const match of source.matchAll(docPattern)) {
            const doc = firstDocLine(match[1]);
            if (!doc) {
                continue;
            }
            if (match[2]) {
                docIndex.set(`${match[3]}#constructor`, doc);
                continue;
            }
            const index = match.index ?? 0;
            const owner = classes.filter((entry) => entry.index < index).pop();
            const member = match[4] || match[5];
            if (owner && member && !docIndex.has(`${owner.name}#${member}`)) {
                docIndex.set(`${owner.name}#${member}`, doc);
            }
        }
    }
    return docIndex;
}

const describeHooks: DescribeHooks = {
    memberDoc: (owner, member) => discordJsDocIndex().get(`${owner}#${member}`),
    capabilities: (value) => {
        if (value instanceof discordJs.Client) {
            const ready = value.isReady();
            return {
                ready,
                user: value.user?.tag,
                userId: value.user?.id,
                applicationId: value.application?.id,
                intents: new discordJs.IntentsBitField(
                    value.options.intents,
                ).toArray(),
                pingMs: ready ? value.ws.ping : undefined,
                guilds: Array.from(value.guilds.cache.values())
                    .slice(0, 50)
                    .map((guild) => ({ id: guild.id, name: guild.name })),
            };
        }
        if (value instanceof discordJs.Guild) {
            return {
                id: value.id,
                name: value.name,
                memberCount: value.memberCount,
                channels: value.channels.cache.size,
                roles: value.roles.cache.size,
                me: value.members.me?.permissions.toArray(),
            };
        }
        return undefined;
    },
};

export function createDiscordHarness(deps: DiscordNamespaceDeps): DiscordHarness {
    const { getService, identityStore } = deps;
    let boundIdentity: BoundIdentity | undefined;

    const requireService = (): DiscordService => {
        const service = getService();
        if (!service) {
            throw new Error("Discord service is not initialized.");
        }
        return service;
    };

    const upstreams = deps.upstreams || new McpUpstreams();
    const network = deps.network || { tlsVerification: true };
    const latency = deps.latency || new LatencyTracker();
    const restLatency = () =>
        boundIdentity ? latency.stats("discord_rest", boundIdentity.id) : undefined;
    const harness = new CodeHarness({
        persistDir: deps.persistDir,
        manual: () => DISCORD_NAMESPACE_MANUAL,
        describe: {
            ...describeHooks,
            capabilities: (value) => {
                const base = describeHooks.capabilities?.(value);
                if (base && value instanceof discordJs.Client) {
                    return { ...base, restLatency: restLatency() };
                }
                return base;
            },
            functionInfo: (fn) => upstreams.functionInfo(fn),
        },
        onLoadError: deps.onLoadError,
    });

    const publishBinding = () => {
        const service = getService();
        harness.setBuiltin("service", service);
        harness.setBuiltin("client", service?.getClient());
        harness.setBuiltin(
            "identity",
            boundIdentity ? { ...boundIdentity } : undefined,
        );
    };

    const bind = async (identityId: string): Promise<discordJs.Client> => {
        const record = identityStore.getIdentity(identityId);
        if (!record) {
            const known = identityStore.listIdentityIds();
            throw new Error(
                `Unknown identity '${identityId}'. Known identities: ${known.join(", ") || "none"}. Create one with connect(id, { mode, token }).`,
            );
        }
        const service = requireService();
        const current = service.getCurrentAuthConfig();
        if (
            !service.isClientReady() ||
            current.tokenType !== record.mode ||
            current.token !== record.token
        ) {
            await service.switchToken({
                tokenType: record.mode,
                token: record.token,
            });
        }
        boundIdentity = { id: record.id, mode: record.mode };
        service.setLatencyLabel(record.id);
        publishBinding();
        return service.getClient();
    };

    const connect = async (
        identityId: string,
        options: { mode?: IdentityMode; token: string },
    ): Promise<discordJs.Client> => {
        if (!options?.token) {
            throw new Error("connect(id, { mode, token }) requires a token.");
        }
        identityStore.upsertIdentity(identityId, options.mode || "bot", options.token);
        return bind(identityId);
    };

    const operation =
        (name: string) =>
        (params: Record<string, unknown> = {}): Promise<unknown> => {
            const target = boundIdentity || { id: "default-bot", mode: "bot" as const };
            return runDiscordOperation({
                mode: target.mode,
                identityId: target.id,
                operation: name,
                params,
            });
        };

    harness.defineBuiltins({
        fetch: createFetch(network),
        network: () => {
            const client = getService()?.getClient();
            return {
                ...describeNetwork(network),
                latency: latency.all(),
                gateway: boundIdentity
                    ? {
                          identity: boundIdentity.id,
                          pingMs: client?.isReady() ? client.ws.ping : null,
                      }
                    : null,
            };
        },
        discord: discordJs,
        identities: () =>
            identityStore.listIdentityIds().map((id) => ({
                id,
                mode: identityStore.getIdentity(id)?.mode,
                bound: boundIdentity?.id === id,
            })),
        connect,
        bind,
        packages: () => listLoadedDiscordRuntimePackages(),
        symbols: (query: string | GetDiscordPackageSymbolsOptions = {}) =>
            getDiscordPackageSymbolsCatalog(
                typeof query === "string" ? { query } : query,
            ),
        pkg: (alias: string) => getDiscordRuntimeExportsByAlias(alias),
        mcp: upstreams.namespace,
        mcpServers: () => upstreams.list(),
        mcpConnect: (name: string, config: UpstreamConfig) =>
            upstreams.connect(name, config),
        mcpDisconnect: (name: string) => upstreams.disconnect(name),
        ops: Object.freeze({
            packages: operation(DISCORD_META_PACKAGES_OPERATION),
            symbols: operation(DISCORD_META_SYMBOLS_OPERATION),
            preflight: operation(DISCORD_META_PREFLIGHT_OPERATION),
            refresh: operation(DISCORD_META_REFRESH_OPERATION),
            invoke: operation(DISCORD_EXEC_INVOKE_OPERATION),
            batch: operation(DISCORD_EXEC_BATCH_OPERATION),
        }),
    });
    publishBinding();

    const run: DiscordHarness["run"] = async (code, options = {}) => {
        if (options.identity && options.identity !== boundIdentity?.id) {
            try {
                await bind(options.identity);
            } catch (error) {
                const message = `Error: ${error instanceof Error ? error.message : String(error)}`;
                return { ok: false, text: message, output: "", error: message, kept: [] };
            }
        }
        await upstreams.ready();
        publishBinding();
        return harness.run(code, { vars: options.vars });
    };

    return {
        harness,
        bind,
        bound: () => boundIdentity,
        upstreams,
        run,
    };
}

// Records the identity the service logged in with at startup as the binding.
export function adoptStartupIdentity(
    discordHarness: DiscordHarness,
    service: DiscordService,
    identityStore: LocalEncryptedIdentityStore,
): Promise<discordJs.Client> | undefined {
    if (!service.isClientReady()) {
        return undefined;
    }
    const { tokenType, token } = service.getCurrentAuthConfig();
    const match = identityStore
        .listIdentityIds()
        .map((id) => identityStore.getIdentity(id))
        .find((record) => record?.mode === tokenType && record.token === token);
    return match ? discordHarness.bind(match.id) : undefined;
}
