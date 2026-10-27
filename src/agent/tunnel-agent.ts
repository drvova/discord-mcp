import type { ClientRequestArgs } from "node:http";
import { Agent, type AgentOptions } from "node:https";
import type { Duplex } from "node:stream";
import { connect as netConnect, type Socket } from "node:net";
import { connect as tlsConnect, type ConnectionOptions } from "node:tls";

// An https.Agent that reaches its target through an HTTP CONNECT proxy, for
// libraries (like `ws`) that accept an agent but not a dispatcher. TLS to the
// target runs inside the tunnel, so the proxy only sees encrypted bytes.

export class ConnectTunnelAgent extends Agent {
    constructor(
        private readonly proxy: URL,
        private readonly proxyTls: ConnectionOptions = {},
        options: AgentOptions = {},
    ) {
        super({ keepAlive: false, ...options });
    }

    // Node lets an agent hand the socket to `callback` asynchronously and
    // return nothing; the declared return type only covers the sync form.
    override createConnection(
        requestOptions: ClientRequestArgs,
        callback?: (error: Error | null, stream: Duplex) => void,
    ): Duplex {
        const options = requestOptions as ConnectionOptions & { host?: string; port?: number | string };
        const done = (error: Error | null, socket?: Socket) =>
            callback?.(error, socket as Duplex);
        const targetHost = options.host || "localhost";
        const targetPort = Number(options.port || 443);
        const proxyPort = Number(this.proxy.port || (this.proxy.protocol === "https:" ? 443 : 80));
        const proxySocket: Socket =
            this.proxy.protocol === "https:"
                ? tlsConnect({ host: this.proxy.hostname, port: proxyPort, servername: this.proxy.hostname, ...this.proxyTls })
                : netConnect(proxyPort, this.proxy.hostname);

        const auth = this.proxy.username
            ? `Proxy-Authorization: Basic ${Buffer.from(`${decodeURIComponent(this.proxy.username)}:${decodeURIComponent(this.proxy.password)}`).toString("base64")}\r\n`
            : "";
        proxySocket.once(this.proxy.protocol === "https:" ? "secureConnect" : "connect", () => {
            proxySocket.write(
                `CONNECT ${targetHost}:${targetPort} HTTP/1.1\r\nHost: ${targetHost}:${targetPort}\r\n${auth}\r\n`,
            );
        });

        let buffered = Buffer.alloc(0);
        const onData = (chunk: Buffer) => {
            buffered = Buffer.concat([buffered, chunk]);
            const end = buffered.indexOf("\r\n\r\n");
            if (end === -1) {
                return;
            }
            proxySocket.off("data", onData);
            proxySocket.off("error", onError);
            const statusLine = buffered.subarray(0, buffered.indexOf("\r\n")).toString();
            if (!/^HTTP\/1\.[01] 200/.test(statusLine)) {
                proxySocket.destroy();
                done(new Error(`Proxy refused CONNECT to ${targetHost}:${targetPort}: ${statusLine}`));
                return;
            }
            const rest = buffered.subarray(end + 4);
            if (rest.length > 0) {
                proxySocket.unshift(rest);
            }
            const secure = tlsConnect({
                ...options,
                socket: proxySocket,
                servername: options.servername || targetHost,
            });
            secure.once("secureConnect", () => done(null, secure));
            secure.once("error", (error) => done(error));
        };
        const onError = (error: Error) => done(error);
        proxySocket.on("data", onData);
        proxySocket.once("error", onError);
        return undefined as unknown as Duplex;
    }
}
