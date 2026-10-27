import { isIP } from "node:net";
import { fetch as undiciFetch, ProxyAgent, type Dispatcher } from "undici";
import { redactUrl } from "./redact.js";

export { redactDiscordTokenPath, redactUrl } from "./redact.js";

// Outbound network policy for the server: an optional proxy that Discord REST,
// upstream MCP servers and the run tool's fetch all go through, and the rule
// that upstream MCP servers are reached only over verified TLS.

export type NetworkConfig = {
    proxyUrl?: URL;
    dispatcher?: Dispatcher;
    tlsVerification: boolean;
};

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export function loadNetworkConfig(
    env: NodeJS.ProcessEnv = process.env,
): NetworkConfig {
    const tlsVerification = env.NODE_TLS_REJECT_UNAUTHORIZED !== "0";
    const raw = env.DISCORD_MCP_PROXY?.trim();
    if (!raw) {
        return { tlsVerification };
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

    return {
        proxyUrl,
        // Requests are tunnelled with CONNECT, so TLS to Discord and to
        // upstream servers stays end-to-end; the proxy never sees plaintext.
        dispatcher: new ProxyAgent({ uri: proxyUrl.href }),
        tlsVerification,
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

export function describeNetwork(network: NetworkConfig): Record<string, unknown> {
    return {
        proxy: network.proxyUrl ? redactUrl(network.proxyUrl) : null,
        proxied: network.proxyUrl
            ? ["discord rest", "upstream mcp (http)", "run tool fetch"]
            : [],
        notProxied: [
            "discord gateway websocket (wss://, @discordjs/ws has no proxy option)",
            "upstream mcp (stdio, local process)",
        ],
        upstreamTransport: "https only (http allowed to localhost)",
        tlsVerification: network.tlsVerification,
    };
}
