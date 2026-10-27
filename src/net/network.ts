import { isIP } from "node:net";
import { Agent, fetch as undiciFetch, ProxyAgent, type Dispatcher } from "undici";
import {
    defaultKnownHostsPath,
    hostKeyPolicy,
    hostPortOf,
    KnownHosts,
    type HostKeyPolicy,
} from "./known-hosts.js";
import { redactUrl } from "./redact.js";

export { redactDiscordTokenPath, redactUrl } from "./redact.js";

// Outbound network policy for the server: an optional proxy that Discord REST,
// upstream MCP servers and the run tool's fetch all go through, the rule that
// upstream MCP servers are reached only over verified TLS, and known_hosts key
// pinning for those servers and for an https proxy.

export type NetworkConfig = {
    proxyUrl?: URL;
    dispatcher?: Dispatcher;
    tlsVerification: boolean;
    knownHosts?: KnownHosts;
    hostKeyPolicy?: HostKeyPolicy;
    onHostAdded?: (hostPort: string, fingerprint: string) => void;
};

// Extra TLS options, used by tests to trust their own certificate authority.
export type TlsOverrides = { ca?: string | string[] };

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export function loadNetworkConfig(
    env: NodeJS.ProcessEnv = process.env,
    options: {
        knownHosts?: KnownHosts;
        onHostAdded?: NetworkConfig["onHostAdded"];
        proxyTls?: TlsOverrides;
    } = {},
): NetworkConfig {
    const tlsVerification = env.NODE_TLS_REJECT_UNAUTHORIZED !== "0";
    const base = {
        tlsVerification,
        knownHosts: options.knownHosts || new KnownHosts(defaultKnownHostsPath(env)),
        hostKeyPolicy: hostKeyPolicy(env),
        onHostAdded: options.onHostAdded,
    };
    const raw = env.DISCORD_MCP_PROXY?.trim();
    if (!raw) {
        return base;
    }

    let proxyUrl: URL;
    try {
        proxyUrl = new URL(raw);
    } catch {
        throw new Error("DISCORD_MCP_PROXY is not a valid URL.");
    }
    if (proxyUrl.protocol !== "http:" && proxyUrl.protocol !== "https:") {
        throw new Error(
            `DISCORD_MCP_PROXY must be an http:// or https:// proxy (got ${proxyUrl.protocol}//). SOCKS proxies are not supported.`,
        );
    }

    const network: NetworkConfig = { ...base, proxyUrl };
    // Requests are tunnelled with CONNECT, so TLS to Discord and to upstream
    // servers stays end-to-end; the proxy never sees plaintext.
    network.dispatcher = new ProxyAgent({
        uri: proxyUrl.href,
        proxyTls: proxyTlsOptions(network, options.proxyTls),
    });
    return network;
}

// An https proxy is pinned in known_hosts like any upstream server.
export function proxyTlsOptions(network: NetworkConfig, overrides: TlsOverrides = {}) {
    if (!network.proxyUrl || network.proxyUrl.protocol !== "https:" || !network.knownHosts) {
        return overrides;
    }
    return {
        ...overrides,
        checkServerIdentity: network.knownHosts.verifier({
            hostPort: hostPortOf(network.proxyUrl),
            policy: network.hostKeyPolicy || "accept-new",
            onAdded: network.onHostAdded,
        }),
    };
}

export function isLoopbackHost(hostname: string): boolean {
    const bare = hostname.replace(/^\[|\]$/g, "");
    if (LOOPBACK_HOSTS.has(hostname) || LOOPBACK_HOSTS.has(bare)) {
        return true;
    }
    return isIP(bare) === 4 && bare.startsWith("127.");
}

// Upstream MCP servers are reached only over TLS with certificate checks on.
// Plain http is allowed only to this machine (loopback), where nothing
// crosses the network.
export function assertEncryptedUpstream(url: URL, network: NetworkConfig): void {
    if (url.protocol === "http:" && isLoopbackHost(url.hostname)) {
        return;
    }
    if (url.protocol !== "https:") {
        throw new Error(
            `Upstream MCP server URL must use https:// (got ${url.protocol}//${url.host}). Plain http is only allowed to localhost.`,
        );
    }
    if (!network.tlsVerification) {
        throw new Error(
            "Refusing to connect to an upstream MCP server while NODE_TLS_REJECT_UNAUTHORIZED=0 disables certificate verification.",
        );
    }
}

// fetch that goes through the configured proxy, or the global fetch.
export function createFetch(network: NetworkConfig): typeof fetch {
    const { dispatcher } = network;
    if (!dispatcher) {
        return globalThis.fetch;
    }
    return ((input: Parameters<typeof fetch>[0], init?: RequestInit) =>
        undiciFetch(input as Parameters<typeof undiciFetch>[0], {
            ...(init as Parameters<typeof undiciFetch>[1]),
            dispatcher,
        })) as unknown as typeof fetch;
}

// fetch for one upstream MCP server: through the proxy when one is set, with
// the server's TLS key checked against known_hosts.
export function createUpstreamFetch(
    network: NetworkConfig,
    url: URL,
    tls: TlsOverrides = {},
): typeof fetch {
    if (url.protocol !== "https:" || !network.knownHosts) {
        return createFetch(network);
    }
    const pinned = {
        ...tls,
        checkServerIdentity: network.knownHosts.verifier({
            hostPort: hostPortOf(url),
            policy: network.hostKeyPolicy || "accept-new",
            onAdded: network.onHostAdded,
        }),
    };
    const dispatcher = network.proxyUrl
        ? new ProxyAgent({
              uri: network.proxyUrl.href,
              proxyTls: proxyTlsOptions(network, tls),
              requestTls: pinned,
          })
        : new Agent({ connect: pinned });
    return createFetch({ ...network, dispatcher });
}

// `agent`: Discord traffic leaves from the discord-mcp agent, which tunnels the
// gateway through its own DISCORD_MCP_PROXY; otherwise it leaves from here.
export function describeNetwork(
    network: NetworkConfig,
    options: { agent?: boolean } = {},
): Record<string, unknown> {
    const discord = options.agent
        ? ["discord rest and gateway: sent by the agent, through the agent's DISCORD_MCP_PROXY"]
        : network.proxyUrl
          ? ["discord rest"]
          : [];
    return {
        proxy: network.proxyUrl ? redactUrl(network.proxyUrl) : null,
        proxied: [
            ...discord,
            ...(network.proxyUrl ? ["upstream mcp (http)", "run tool fetch"] : []),
        ],
        notProxied: [
            ...(options.agent
                ? []
                : ["discord gateway websocket (wss://, @discordjs/ws has no proxy option; use the agent)"]),
            "upstream mcp (stdio, local process)",
        ],
        upstreamTransport: "https only (http allowed to localhost)",
        tlsVerification: network.tlsVerification,
        knownHosts: network.knownHosts
            ? { path: network.knownHosts.path, policy: network.hostKeyPolicy || "accept-new" }
            : null,
    };
}
