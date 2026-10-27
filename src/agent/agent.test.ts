import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { createServer as createHttpServer, type Server } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { connect, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, onTestFinished, test } from "@rstest/core";
import { request } from "undici";
import { WebSocket, WebSocketServer } from "ws";
import { DiscordService } from "../discord-service.js";
import { AgentClient, AgentIdentityStore } from "./agent-client.js";
import { placeholderToken, startAgent, type AgentOptions } from "./agent-server.js";
import { ConnectTunnelAgent } from "./tunnel-agent.js";

const REAL_TOKEN = "REAL.discord-token.never-in-main";

type FakeDiscord = {
    api: string;
    gatewayUrl: string;
    authorizations: string[];
    identifyTokens: string[];
    paths: string[];
};

function closeOnFinish(server: Server): void {
    onTestFinished(
        () =>
            new Promise<void>((resolveClose) => {
                server.closeAllConnections();
                server.close(() => resolveClose());
            }),
    );
}

async function listen(server: Server): Promise<number> {
    await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
    closeOnFinish(server);
    const address = server.address();
    return typeof address === "object" && address ? address.port : 0;
}

// Enough of Discord's REST API and gateway for discord.js to log in.
async function startFakeDiscord(): Promise<FakeDiscord> {
    const fake: FakeDiscord = { api: "", gatewayUrl: "", authorizations: [], identifyTokens: [], paths: [] };
    const gateway = new WebSocketServer({ port: 0, host: "127.0.0.1" });
    onTestFinished(() => new Promise<void>((resolveClose) => {
        for (const client of gateway.clients) {
            client.terminate();
        }
        gateway.close(() => resolveClose());
    }));
    await new Promise<void>((resolveListen) => gateway.once("listening", resolveListen));
    const gatewayPort = (gateway.address() as { port: number }).port;
    fake.gatewayUrl = `ws://127.0.0.1:${gatewayPort}`;
    gateway.on("connection", (socket) => {
        socket.send(JSON.stringify({ op: 10, d: { heartbeat_interval: 45000 } }));
        socket.on("message", (raw) => {
            const payload = JSON.parse(raw.toString()) as { op: number; d: { token?: string } };
            if (payload.op === 1) {
                socket.send(JSON.stringify({ op: 11 }));
            } else if (payload.op === 2) {
                fake.identifyTokens.push(String(payload.d.token));
                socket.send(
                    JSON.stringify({
                        op: 0,
                        t: "READY",
                        s: 1,
                        d: {
                            v: 10,
                            user: { id: "100", username: "fakebot", discriminator: "0", bot: true, avatar: null, global_name: null },
                            guilds: [],
                            session_id: "session-1",
                            resume_gateway_url: fake.gatewayUrl,
                            application: { id: "100", flags: 0 },
                            shard: [0, 1],
                        },
                    }),
                );
            }
        });
    });

    const rest = createHttpServer((req, res) => {
        fake.authorizations.push(req.headers.authorization || "");
        fake.paths.push(req.url || "");
        res.setHeader("content-type", "application/json");
        if (req.url?.endsWith("/gateway/bot")) {
            res.end(JSON.stringify({
                url: fake.gatewayUrl,
                shards: 1,
                session_start_limit: { total: 1000, remaining: 1000, reset_after: 0, max_concurrency: 1 },
            }));
        } else if (req.url?.endsWith("/users/@me/guilds")) {
            res.end("[]");
        } else {
            res.end(JSON.stringify({ path: req.url }));
        }
    });
    fake.api = `http://127.0.0.1:${await listen(rest)}/api`;
    return fake;
}

async function startTestAgent(extra: Partial<AgentOptions> = {}) {
    const dir = mkdtempSync(join(tmpdir(), "discord-mcp-agent-"));
    onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
    const fake = await startFakeDiscord();
    const agent = await startAgent({
        socketPath: join(dir, "agent", "agent.sock"),
        identities: [{ id: "test-bot", mode: "bot", token: REAL_TOKEN }],
        discordApi: fake.api,
        allowGatewayUrl: () => true,
        ...extra,
    });
    onTestFinished(() => agent.close());
    const client = new AgentClient(agent.socketPath);
    onTestFinished(() => client.close());
    return { agent, client, fake, dir };
}

test("discord.js logs in through the agent without ever holding the token", async () => {
    const { client, fake } = await startTestAgent();
    const service = new DiscordService(
        { tokenType: "bot", token: placeholderToken("test-bot") },
        { dispatcher: client.dispatcher, restApi: client.restApi },
    );
    onTestFinished(() => service.destroy());

    await service.initialize();

    const discordClient = service.getClient();
    expect(discordClient.isReady()).toBe(true);
    expect(discordClient.user?.username).toBe("fakebot");
    // Discord received the real credentials...
    expect(fake.identifyTokens).toEqual([REAL_TOKEN]);
    expect(fake.authorizations).toContain(`Bot ${REAL_TOKEN}`);
    // ...while this process only ever had the placeholder.
    expect(discordClient.token).toBe("agent:test-bot");
    expect(service.getCurrentAuthConfig().token).toBe("agent:test-bot");
    expect(JSON.stringify(service.getCurrentAuthConfig())).not.toContain(REAL_TOKEN);
});

test("REST requests carry the real token to Discord and nowhere else", async () => {
    const { client, fake } = await startTestAgent();
    const get = (path: string, authorization?: string) =>
        request(`${client.restApi}${path}`, {
            dispatcher: client.dispatcher,
            headers: authorization ? { authorization } : {},
        });

    const ok = await get("/v10/users/@me", "Bot agent:test-bot");
    expect(ok.statusCode).toBe(200);
    expect(fake.authorizations.at(-1)).toBe(`Bot ${REAL_TOKEN}`);

    // A path that looks like another host still goes to the Discord API base.
    await (await get("//evil.example/steal", "Bot agent:test-bot")).body.text();
    expect(fake.paths.at(-1)).toBe("/api//evil.example/steal");

    const unknown = await get("/v10/users/@me", "Bot agent:nobody");
    expect(unknown.statusCode).toBe(401);
    await unknown.body.text();
});

test("the gateway only connects to URLs Discord issued, through opaque handles", async () => {
    const { agent, client, fake } = await startTestAgent();
    const info = (await (
        await request(`${client.restApi}/v10/gateway/bot`, {
            dispatcher: client.dispatcher,
            headers: { authorization: "Bot agent:test-bot" },
        })
    ).body.json()) as { url: string };
    expect(info.url).toMatch(new RegExp(`^ws\\+unix://${agent.socketPath}:/gateway/[A-Za-z0-9_-]+$`));
    expect(info.url).not.toContain(fake.gatewayUrl);

    // A made-up handle (e.g. an attempt to reach another host) is refused.
    const forged = new WebSocket(`ws+unix://${agent.socketPath}:/gateway/forged-handle?v=10&encoding=json`);
    const outcome = await new Promise<string>((resolveOutcome) => {
        forged.once("open", () => resolveOutcome("open"));
        forged.once("error", (error) => resolveOutcome(error.message));
    });
    expect(outcome).toMatch(/400/);
});

test("a resume URL outside the allowed hosts is dropped, not followed", async () => {
    const { client, fake } = await startTestAgent({
        allowGatewayUrl: (url) => url.port !== "1",
    });
    const info = (await (
        await request(`${client.restApi}/v10/gateway/bot`, {
            dispatcher: client.dispatcher,
            headers: { authorization: "Bot agent:test-bot" },
        })
    ).body.json()) as { url: string };
    const socket = new WebSocket(`${info.url}?v=10&encoding=json`);
    onTestFinished(() => socket.terminate());
    const ready = new Promise<Record<string, unknown>>((resolveReady) => {
        socket.on("message", (raw) => {
            const payload = JSON.parse(raw.toString()) as { t?: string; d: Record<string, unknown> };
            if (payload.t === "READY") {
                resolveReady(payload.d);
            }
        });
    });
    // Make the fake Discord hand out a resume URL the agent must not trust.
    fake.gatewayUrl = "ws://127.0.0.1:1";
    socket.on("open", () => socket.send(JSON.stringify({ op: 2, d: { token: "agent:test-bot" } })));
    const d = await ready;
    expect("resume_gateway_url" in d).toBe(false);
    expect(fake.identifyTokens).toEqual([REAL_TOKEN]);
});

test("gateway URLs outside discord.gg are refused by default", async () => {
    const { client } = await startTestAgent({ allowGatewayUrl: undefined });
    const response = await request(`${client.restApi}/v10/gateway/bot`, {
        dispatcher: client.dispatcher,
        headers: { authorization: "Bot agent:test-bot" },
    });
    expect(response.statusCode).toBe(502);
    expect(await response.body.text()).not.toContain("127.0.0.1");
});

test("the agent socket is private and lists identities without tokens", async () => {
    const { agent, client } = await startTestAgent();
    expect(statSync(agent.socketPath).mode & 0o777).toBe(0o600);
    expect(statSync(join(agent.socketPath, "..")).mode & 0o777).toBe(0o700);

    expect(await client.identities()).toEqual([{ id: "test-bot", mode: "bot" }]);
    await client.addIdentity({ id: "ops-user", mode: "user", token: "USER-TOKEN" });
    const store = new AgentIdentityStore(client);
    await store.refresh();
    expect(store.listIdentityIds()).toEqual(["ops-user", "test-bot"]);
    expect(store.getIdentity("ops-user")).toEqual({ id: "ops-user", mode: "user", token: "agent:ops-user" });
    expect(() => store.upsertIdentity()).toThrow(/held by the discord-mcp agent/);

    expect(await client.removeIdentity("ops-user")).toBe(true);
    expect(await client.removeIdentity("ops-user")).toBe(false);
});

test("a second agent cannot take over a socket that is in use", async () => {
    const { agent } = await startTestAgent();
    await expect(
        startAgent({ socketPath: agent.socketPath, identities: [] }),
    ).rejects.toThrow(/already listening/);
});

test("the gateway tunnel reaches wss:// targets through an HTTP CONNECT proxy", async () => {
    const fixture = (name: string) => readFileSync(join(process.cwd(), "src", "net", "__fixtures__", name), "utf8");
    const tlsServer = createHttpsServer({ key: fixture("host-a.key"), cert: fixture("host-a.crt") });
    const wss = new WebSocketServer({ server: tlsServer });
    wss.on("connection", (socket) => socket.send("hello over tls"));
    const targetPort = await listen(tlsServer as unknown as Server);
    onTestFinished(() => {
        for (const socket of wss.clients) {
            socket.terminate();
        }
    });

    const tunnels: string[] = [];
    const sockets = new Set<Socket>();
    const proxy = createHttpServer();
    proxy.on("connect", (req, clientSocket: Socket, head) => {
        tunnels.push(req.url || "");
        const [host, port] = (req.url || "").split(":");
        const upstream = connect(Number(port), host === "localhost" ? "127.0.0.1" : host, () => {
            clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
            upstream.write(head);
            upstream.pipe(clientSocket);
            clientSocket.pipe(upstream);
        });
        sockets.add(clientSocket).add(upstream);
    });
    onTestFinished(() => {
        for (const socket of sockets) {
            socket.destroy();
        }
    });
    const proxyPort = await listen(proxy);

    const tunnel = new ConnectTunnelAgent(new URL(`http://127.0.0.1:${proxyPort}`), {}, { ca: fixture("host-a.crt") });
    const socket = new WebSocket(`wss://localhost:${targetPort}`, { agent: tunnel });
    const message = await new Promise<string>((resolveMessage, rejectMessage) => {
        socket.once("message", (data) => resolveMessage(data.toString()));
        socket.once("error", rejectMessage);
    });
    socket.close();
    expect(message).toBe("hello over tls");
    expect(tunnels).toEqual([`localhost:${targetPort}`]);
});
