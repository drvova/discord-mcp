import { randomBytes } from "node:crypto";
import { existsSync, unlinkSync, chmodSync } from "node:fs";
import {
    createServer,
    type IncomingHttpHeaders,
    type IncomingMessage,
    type ServerResponse,
} from "node:http";
import type { Agent as HttpAgent } from "node:http";
import { connect } from "node:net";
import { dirname } from "node:path";
import { request, type Dispatcher } from "undici";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import type { IdentityMode } from "../identity/local-encrypted-identity-store.js";
import { ensurePrivateDir } from "../keystore/secret-file.js";

// The discord-mcp agent, modelled on ssh-agent: it holds decrypted Discord
// tokens and lets local clients *use* them without ever *reading* them. Clients
// talk to it over a mode 600 Unix socket and authenticate to Discord with the
// placeholder `agent:<identity>`; the agent swaps in the real token on the way
// out (REST Authorization header, gateway IDENTIFY/RESUME). Tokens only ever
// leave toward the configured Discord API, or toward gateway URLs that Discord
// itself handed out and the agent issued an opaque handle for.

export type AgentIdentity = { id: string; mode: IdentityMode; token: string };

export type AgentOptions = {
    socketPath: string;
    identities: AgentIdentity[];
    // Outbound dispatcher for Discord REST (e.g. the configured proxy).
    dispatcher?: Dispatcher;
    // https.Agent for the upstream gateway WebSocket (e.g. a CONNECT tunnel).
    gatewayAgent?: HttpAgent;
    discordApi?: string;
    // Which gateway URLs Discord may send clients to. Defaults to wss://*.discord.gg.
    allowGatewayUrl?: (url: URL) => boolean;
    log?: (message: string) => void;
};

export type RunningAgent = {
    socketPath: string;
    close: () => Promise<void>;
};

export const PLACEHOLDER_PREFIX = "agent:";

export function placeholderToken(identityId: string): string {
    return `${PLACEHOLDER_PREFIX}${identityId}`;
}

const PLACEHOLDER_PATTERN = /^(?:Bot |Bearer )?agent:([A-Za-z0-9][A-Za-z0-9_.-]{0,63})$/;
const HOP_BY_HOP = new Set([
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
    "host",
]);
const MAX_GATEWAY_HANDLES = 1024;

function defaultAllowGatewayUrl(url: URL): boolean {
    return url.protocol === "wss:" && (url.hostname === "discord.gg" || url.hostname.endsWith(".discord.gg"));
}

// ws refuses to send some close codes (1005/1006 are receive-only); map those
// to Discord's "unknown error, reconnect" so the client resumes.
function sendableCloseCode(code: number): number {
    if ((code >= 3000 && code <= 4999) || [1000, 1001, 1002, 1003, 1007, 1008, 1009, 1010, 1011, 1012, 1013, 1014].includes(code)) {
        return code;
    }
    return 4000;
}

function filterHeaders(headers: IncomingHttpHeaders | Record<string, string | string[] | undefined>) {
    const result: Record<string, string | string[]> = {};
    for (const [name, value] of Object.entries(headers)) {
        if (value !== undefined && !HOP_BY_HOP.has(name.toLowerCase())) {
            result[name] = value;
        }
    }
    return result;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<string> {
    let body = "";
    for await (const chunk of req) {
        body += chunk;
    }
    return body;
}

// Removes a stale socket left by an agent that died, but never one in use.
async function clearStaleSocket(socketPath: string): Promise<void> {
    if (!existsSync(socketPath)) {
        return;
    }
    const inUse = await new Promise<boolean>((resolveProbe) => {
        const probe = connect(socketPath);
        probe.once("connect", () => {
            probe.destroy();
            resolveProbe(true);
        });
        probe.once("error", () => resolveProbe(false));
    });
    if (inUse) {
        throw new Error(`An agent is already listening on ${socketPath}.`);
    }
    unlinkSync(socketPath);
}

export async function startAgent(options: AgentOptions): Promise<RunningAgent> {
    const identities = new Map(options.identities.map((identity) => [identity.id, identity]));
    const discordApi = (options.discordApi || "https://discord.com/api").replace(/\/+$/, "");
    const allowGatewayUrl = options.allowGatewayUrl || defaultAllowGatewayUrl;
    const log = options.log || (() => undefined);
    const socketPath = options.socketPath;
    const gatewayHandles = new Map<string, string>();

    // Discord-issued gateway URLs are handed to clients as opaque handles, so
    // a client can never point the agent (and the token) at another host.
    const issueGatewayUrl = (realUrl: string): string => {
        const parsed = new URL(realUrl);
        if (!allowGatewayUrl(parsed)) {
            throw new Error(`Refusing gateway URL outside Discord: ${parsed.origin}`);
        }
        const handle = randomBytes(12).toString("base64url");
        gatewayHandles.set(handle, realUrl.replace(/\/+$/, ""));
        if (gatewayHandles.size > MAX_GATEWAY_HANDLES) {
            gatewayHandles.delete(gatewayHandles.keys().next().value as string);
        }
        return `ws+unix://${socketPath}:/gateway/${handle}`;
    };

    const realAuthorization = (header: string | undefined): string | undefined | null => {
        if (!header) {
            return undefined;
        }
        const match = PLACEHOLDER_PATTERN.exec(header);
        if (!match) {
            return header;
        }
        const identity = identities.get(match[1]);
        if (!identity) {
            return null;
        }
        return identity.mode === "bot" ? `Bot ${identity.token}` : identity.token;
    };

    const forwardRest = async (req: IncomingMessage, res: ServerResponse, path: string) => {
        const headers = filterHeaders(req.headers);
        const authorization = realAuthorization(req.headers.authorization);
        if (authorization === null) {
            sendJson(res, 401, { message: "Unknown agent identity", code: 0 });
            return;
        }
        delete headers.authorization;
        if (authorization) {
            headers.authorization = authorization;
        }
        const pathname = path.split("?")[0];
        const isGatewayInfo = req.method === "GET" && /^\/v\d+\/gateway(\/bot)?$/.test(pathname);
        if (isGatewayInfo) {
            delete headers["accept-encoding"];
        }
        const hasBody = req.method !== "GET" && req.method !== "HEAD";
        // String concatenation (not URL resolution) keeps every request on the
        // configured Discord API, whatever the client sends as a path.
        const upstream = await request(`${discordApi}${path}`, {
            method: (req.method || "GET") as Dispatcher.HttpMethod,
            headers,
            body: hasBody ? req : undefined,
            dispatcher: options.dispatcher,
        });

        if (isGatewayInfo && upstream.statusCode === 200) {
            const payload = (await upstream.body.json()) as { url?: string };
            if (typeof payload.url === "string") {
                payload.url = issueGatewayUrl(payload.url);
            }
            sendJson(res, 200, payload);
            return;
        }
        res.writeHead(upstream.statusCode, filterHeaders(upstream.headers));
        for await (const chunk of upstream.body) {
            res.write(chunk);
        }
        res.end();
    };

    const server = createServer((req, res) => {
        const url = req.url || "/";
        void (async () => {
            try {
                if (url.startsWith("/rest/")) {
                    await forwardRest(req, res, url.slice("/rest".length));
                } else if (url === "/identities" && req.method === "GET") {
                    sendJson(
                        res,
                        200,
                        Array.from(identities.values(), ({ id, mode }) => ({ id, mode })),
                    );
                } else if (url === "/identities" && req.method === "POST") {
                    const body = JSON.parse(await readBody(req)) as Partial<AgentIdentity>;
                    if (!body.id || !body.token || (body.mode !== "bot" && body.mode !== "user")) {
                        sendJson(res, 400, { message: "Expected { id, mode, token }." });
                        return;
                    }
                    identities.set(body.id, { id: body.id, mode: body.mode, token: body.token });
                    log(`Identity added: ${body.id} (${body.mode})`);
                    sendJson(res, 200, { id: body.id, mode: body.mode });
                } else if (url.startsWith("/identities/") && req.method === "DELETE") {
                    const id = decodeURIComponent(url.slice("/identities/".length));
                    const removed = identities.delete(id);
                    if (removed) {
                        log(`Identity removed: ${id}`);
                    }
                    sendJson(res, removed ? 200 : 404, { removed });
                } else {
                    sendJson(res, 404, { message: "Not found" });
                }
            } catch (error) {
                log(`Request failed: ${error instanceof Error ? error.message : String(error)}`);
                if (!res.headersSent) {
                    sendJson(res, 502, { message: "Agent could not reach Discord." });
                } else {
                    res.destroy();
                }
            }
        })();
    });

    const sockets = new WebSocketServer({ noServer: true });
    server.on("upgrade", (req, socket, head) => {
        const match = /^\/gateway\/([A-Za-z0-9_-]+)(\?.*)?$/.exec(req.url || "");
        const realBase = match ? gatewayHandles.get(match[1]) : undefined;
        const query = new URLSearchParams(match?.[2]?.slice(1) || "");
        if (!realBase || query.has("compress")) {
            socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
            return;
        }
        sockets.handleUpgrade(req, socket, head, (client) => {
            relayGateway(client, `${realBase}/?${query.toString()}`);
        });
    });

    const relayGateway = (client: WebSocket, upstreamUrl: string) => {
        const upstream = new WebSocket(upstreamUrl, { agent: options.gatewayAgent });
        const pending: Array<[RawData, boolean]> = [];

        const toUpstream = (data: RawData, isBinary: boolean) => {
            if (isBinary) {
                upstream.send(data, { binary: true });
                return;
            }
            const text = data.toString();
            let payload: { op?: number; d?: { token?: unknown } };
            try {
                payload = JSON.parse(text);
            } catch {
                upstream.send(text);
                return;
            }
            if ((payload.op === 2 || payload.op === 6) && typeof payload.d?.token === "string") {
                const match = PLACEHOLDER_PATTERN.exec(payload.d.token);
                const identity = match ? identities.get(match[1]) : undefined;
                if (!identity) {
                    // Discord's "authentication failed" close code.
                    client.close(4004, "Unknown agent identity");
                    upstream.close();
                    return;
                }
                payload.d.token = identity.token;
                upstream.send(JSON.stringify(payload));
                return;
            }
            upstream.send(text);
        };

        client.on("message", (data, isBinary) => {
            if (upstream.readyState === WebSocket.OPEN) {
                toUpstream(data, isBinary);
            } else {
                pending.push([data, isBinary]);
            }
        });
        upstream.on("open", () => {
            for (const [data, isBinary] of pending.splice(0)) {
                toUpstream(data, isBinary);
            }
        });
        upstream.on("message", (data, isBinary) => {
            if (!isBinary) {
                const text = data.toString();
                if (text.includes('"resume_gateway_url"')) {
                    const payload = JSON.parse(text) as { t?: string; d?: { resume_gateway_url?: string } };
                    if (payload.t === "READY" && typeof payload.d?.resume_gateway_url === "string") {
                        try {
                            payload.d.resume_gateway_url = issueGatewayUrl(payload.d.resume_gateway_url);
                        } catch (error) {
                            // Without it, discord.js resumes via the agent's
                            // regular gateway handle; the token never goes there.
                            log(error instanceof Error ? error.message : String(error));
                            delete payload.d.resume_gateway_url;
                        }
                        client.send(JSON.stringify(payload));
                        return;
                    }
                }
                client.send(text);
                return;
            }
            client.send(data, { binary: true });
        });
        upstream.on("close", (code, reason) => {
            if (client.readyState === WebSocket.OPEN) {
                client.close(sendableCloseCode(code), reason);
            }
        });
        client.on("close", (code, reason) => {
            if (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING) {
                upstream.close(sendableCloseCode(code), reason);
            }
        });
        upstream.on("error", (error) => {
            log(`Gateway connection failed: ${error.message}`);
            client.terminate();
        });
        client.on("error", () => upstream.terminate());
    };

    ensurePrivateDir(dirname(socketPath));
    await clearStaleSocket(socketPath);
    // The socket is created private: no window where others could connect.
    const previousUmask = process.umask(0o177);
    try {
        await new Promise<void>((resolveListen, rejectListen) => {
            server.once("error", rejectListen);
            server.listen(socketPath, () => resolveListen());
        });
    } finally {
        process.umask(previousUmask);
    }
    chmodSync(socketPath, 0o600);

    return {
        socketPath,
        close: async () => {
            for (const client of sockets.clients) {
                client.terminate();
            }
            server.closeAllConnections();
            await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
            if (existsSync(socketPath)) {
                unlinkSync(socketPath);
            }
        },
    };
}
