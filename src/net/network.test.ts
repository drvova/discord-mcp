import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { connect, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, onTestFinished, test } from "@rstest/core";
import { DiscordService } from "../discord-service.js";
import { LocalEncryptedIdentityStore } from "../identity/local-encrypted-identity-store.js";
import { createDiscordHarness } from "../run/discord-namespace.js";
import { startHttpFixture } from "../run/mcp-fixture-server.js";
import { McpUpstreams } from "../run/mcp-upstreams.js";
import { LatencyTracker } from "./latency.js";
import {
    assertEncryptedUpstream,
    createFetch,
    loadNetworkConfig,
    redactUrl,
} from "./network.js";

const SECRET_TOKEN = "SECRET-TOKEN-do-not-leak-123";

async function listen(server: Server, sockets: Set<Socket> = new Set()): Promise<number> {
    await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
    onTestFinished(
        () =>
            new Promise<void>((resolveClose) => {
                // CONNECT tunnels leave the server's bookkeeping, so close them too.
                for (const socket of sockets) {
                    socket.destroy();
                }
                server.closeAllConnections();
                server.close(() => resolveClose());
            }),
    );
    const address = server.address();
    return typeof address === "object" && address ? address.port : 0;
}

// A minimal HTTP CONNECT proxy that records every tunnel it opens.
async function startProxy(): Promise<{ url: string; tunnels: string[] }> {
    const tunnels: string[] = [];
    const sockets = new Set<Socket>();
    const proxy = createServer((_, res) => res.writeHead(405).end());
    proxy.on("connect", (req, clientSocket: Socket, head) => {
        tunnels.push(req.url || "");
        const [host, port] = (req.url || "").split(":");
        const upstream = connect(Number(port), host, () => {
            clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
            upstream.write(head);
            upstream.pipe(clientSocket);
            clientSocket.pipe(upstream);
        });
        sockets.add(clientSocket).add(upstream);
        upstream.on("error", () => clientSocket.destroy());
        clientSocket.on("error", () => upstream.destroy());
    });
    const port = await listen(proxy, sockets);
    return { url: `http://127.0.0.1:${port}`, tunnels };
}

async function startTarget(): Promise<string> {
    const target = createServer((req, res) => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ path: req.url }));
    });
    const port = await listen(target);
    return `127.0.0.1:${port}`;
}

test("proxy config accepts http(s) proxies and rejects everything else", () => {
    expect(loadNetworkConfig({}).dispatcher).toBeUndefined();
    const config = loadNetworkConfig({ DISCORD_MCP_PROXY: "http://user:pw@proxy.internal:8080" });
    expect(config.dispatcher).toBeDefined();
    expect(config.proxyUrl?.host).toBe("proxy.internal:8080");
    expect(() => loadNetworkConfig({ DISCORD_MCP_PROXY: "socks5://proxy:1080" })).toThrow(
        /SOCKS proxies are not supported/,
    );
    expect(() => loadNetworkConfig({ DISCORD_MCP_PROXY: "not a url" })).toThrow(/not a valid URL/);
    expect(loadNetworkConfig({ NODE_TLS_REJECT_UNAUTHORIZED: "0" }).tlsVerification).toBe(false);
});

test("upstream MCP servers must be https, except on loopback", () => {
    const network = { tlsVerification: true };
    expect(() => assertEncryptedUpstream(new URL("https://mcp.example.com/mcp"), network)).not.toThrow();
    expect(() => assertEncryptedUpstream(new URL("http://127.0.0.1:3000/mcp"), network)).not.toThrow();
    expect(() => assertEncryptedUpstream(new URL("http://localhost:3000/mcp"), network)).not.toThrow();
    expect(() => assertEncryptedUpstream(new URL("http://[::1]:3000/mcp"), network)).not.toThrow();
    expect(() => assertEncryptedUpstream(new URL("http://mcp.example.com/mcp"), network)).toThrow(
        /must use https/,
    );
    expect(() => assertEncryptedUpstream(new URL("ws://mcp.example.com/mcp"), network)).toThrow(
        /must use https/,
    );
    expect(() =>
        assertEncryptedUpstream(new URL("https://mcp.example.com/mcp"), { tlsVerification: false }),
    ).toThrow(/certificate verification/);
});

test("redaction strips credentials, query strings and Discord path tokens", () => {
    expect(redactUrl("http://user:pw@proxy.internal:8080/")).toBe("http://proxy.internal:8080/");
    expect(redactUrl("https://mcp.example.com/mcp?api_key=abc")).toBe("https://mcp.example.com/mcp?<redacted>");
    expect(redactUrl("https://discord.com/api/v10/webhooks/123/tok_en-value/messages/@original")).toBe(
        "https://discord.com/api/v10/webhooks/123/:token/messages/@original",
    );
    expect(redactUrl("https://discord.com/api/v10/interactions/456/aW50ZXJhY3Rpb24/callback")).toBe(
        "https://discord.com/api/v10/interactions/456/:token/callback",
    );
});

test("fetch goes through the proxy when one is configured", async () => {
    const proxy = await startProxy();
    const target = await startTarget();
    const fetchViaProxy = createFetch(loadNetworkConfig({ DISCORD_MCP_PROXY: proxy.url }));

    const body = (await (await fetchViaProxy(`http://${target}/hello`)).json()) as { path: string };
    expect(body.path).toBe("/hello");
    expect(proxy.tunnels).toEqual([target]);
});

test("Discord REST requests go through the proxy and are timed per identity", async () => {
    const proxy = await startProxy();
    const target = await startTarget();
    const network = loadNetworkConfig({ DISCORD_MCP_PROXY: proxy.url });
    const latency = new LatencyTracker();
    const service = new DiscordService(
        { tokenType: "bot", token: SECRET_TOKEN },
        { dispatcher: network.dispatcher, latency },
    );
    service.setLatencyLabel("ops-bot");
    const rest = service.getClient().rest;
    rest.options.api = `http://${target}/api`;

    await rest.get("/gateway", { auth: false });

    expect(proxy.tunnels).toEqual([target]);
    const stats = latency.stats("discord_rest", "ops-bot");
    expect(stats?.count).toBe(1);
    expect(stats?.errors).toBe(0);
    expect(JSON.stringify(latency.all())).not.toContain(SECRET_TOKEN);
});

test("upstream MCP traffic goes through the proxy, and calls are timed per server", async () => {
    const proxy = await startProxy();
    const fixture = await startHttpFixture();
    onTestFinished(() => fixture.close());
    const latency = new LatencyTracker();
    const upstreams = new McpUpstreams({
        network: loadNetworkConfig({ DISCORD_MCP_PROXY: proxy.url }),
        latency,
    });
    onTestFinished(() => upstreams.closeAll());

    await upstreams.connect("remote", { url: `${fixture.url}?key=${SECRET_TOKEN}` });
    const add = upstreams.namespace.remote.add as (args: unknown) => Promise<{ sum: number }>;
    expect((await add({ a: 2, b: 2 })).sum).toBe(4);
    await expect(upstreams.namespace.remote.fail({})).rejects.toThrow(/nope/);

    expect(proxy.tunnels.length).toBeGreaterThan(0);
    expect(new Set(proxy.tunnels)).toEqual(new Set([new URL(fixture.url).host]));
    const [status] = upstreams.list();
    expect(status.latency?.count).toBe(2);
    expect(status.latency?.errors).toBe(1);
    expect(status.url).toBe(`${fixture.url}?<redacted>`);
    expect(JSON.stringify(upstreams.list())).not.toContain(SECRET_TOKEN);
});

test("plain-http upstream servers off this machine are refused before connecting", async () => {
    const upstreams = new McpUpstreams({ network: { tlsVerification: true } });
    await expect(upstreams.connect("remote", { url: "http://mcp.example.com/mcp" })).rejects.toThrow(
        /must use https/,
    );
    expect(upstreams.list()[0]).toMatchObject({ connected: false });
});

test("network() reports policy and latency by name, never by token", async () => {
    const dir = mkdtempSync(join(tmpdir(), "discord-mcp-network-"));
    onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
    const proxy = await startProxy();
    const network = loadNetworkConfig({ DISCORD_MCP_PROXY: `${proxy.url.replace("http://", "http://user:proxy-password@")}` });
    const latency = new LatencyTracker();
    latency.record("discord_rest", "default-bot", 12, true);
    const store = new LocalEncryptedIdentityStore({ filePath: join(dir, "ids.enc") });
    store.upsertIdentity("default-bot", "bot", SECRET_TOKEN);
    const discord = createDiscordHarness({
        getService: () => new DiscordService({ tokenType: "bot", token: SECRET_TOKEN }),
        identityStore: store,
        persistDir: join(dir, "kept"),
        network,
        latency,
    });

    const result = await discord.run("JSON.stringify([network(), describe(client).capabilities, identities()])");
    expect(result.ok).toBe(true);
    expect(result.text).not.toContain(SECRET_TOKEN);
    expect(result.text).not.toContain("proxy-password");
    const [info] = JSON.parse(String(result.value)) as [Record<string, unknown>];
    expect(info.proxy).toBe(`${proxy.url}/`);
    expect(info.latency).toEqual({
        discord_rest: { "default-bot": { count: 1, errors: 0, lastMs: 12, avgMs: 12, p50Ms: 12, p95Ms: 12 } },
    });
    expect(info.notProxied).toContain(
        "discord gateway websocket (wss://, @discordjs/ws has no proxy option; use the agent)",
    );
});
