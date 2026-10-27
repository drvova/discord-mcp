import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { createServer, type Server } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, onTestFinished, test } from "@rstest/core";
import { KnownHosts } from "./known-hosts.js";
import { createUpstreamFetch, type NetworkConfig } from "./network.js";

const fixture = (name: string) =>
    readFileSync(join(process.cwd(), "src", "net", "__fixtures__", name), "utf8");
const CA = [fixture("host-a.crt"), fixture("host-b.crt")];

async function startTlsServer(keyName: "a" | "b"): Promise<URL> {
    const server: Server = createServer(
        { key: fixture(`host-${keyName}.key`), cert: fixture(`host-${keyName}.crt`) },
        (_, res) => res.end("ok"),
    );
    await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
    onTestFinished(
        () =>
            new Promise<void>((resolveClose) => {
                server.closeAllConnections();
                server.close(() => resolveClose());
            }),
    );
    const address = server.address();
    return new URL(`https://localhost:${typeof address === "object" && address ? address.port : 0}/`);
}

function network(policy: "accept-new" | "yes" = "accept-new") {
    const dir = mkdtempSync(join(tmpdir(), "discord-mcp-known-hosts-"));
    onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
    const added: string[] = [];
    const config: NetworkConfig = {
        tlsVerification: true,
        knownHosts: new KnownHosts(join(dir, "known_hosts")),
        hostKeyPolicy: policy,
        onHostAdded: (hostPort) => added.push(hostPort),
    };
    return { config, added, knownHosts: config.knownHosts as KnownHosts };
}

async function failureOf(promise: Promise<unknown>): Promise<string> {
    try {
        await promise;
        return "no error";
    } catch (error) {
        const cause = (error as { cause?: Error }).cause;
        return `${(error as Error).message} ${cause?.message ?? ""}`;
    }
}

test("the first connection records the server's key (accept-new)", async () => {
    const url = await startTlsServer("a");
    const { config, added, knownHosts } = network();

    const response = await createUpstreamFetch(config, url, { ca: CA })(url);
    expect(await response.text()).toBe("ok");
    expect(added).toEqual([`localhost:${url.port}`]);
    expect(knownHosts.entries().get(`localhost:${url.port}`)).toMatch(/^SHA256:[A-Za-z0-9+/]{43}$/);
    expect(statSync(knownHosts.path).mode & 0o777).toBe(0o600);

    // Same key again: accepted without adding anything.
    const again = await createUpstreamFetch(config, url, { ca: CA })(url);
    expect(again.status).toBe(200);
    expect(added).toHaveLength(1);
});

test("a changed key is refused, even with a valid certificate", async () => {
    const first = await startTlsServer("a");
    const second = await startTlsServer("b");
    const { config, knownHosts } = network();
    await createUpstreamFetch(config, first, { ca: CA })(first);

    // Record server A's key for server B's address: B now presents a different key.
    knownHosts.add(`localhost:${second.port}`, knownHosts.entries().get(`localhost:${first.port}`) as string);
    const failure = await failureOf(createUpstreamFetch(config, second, { ca: CA })(second));
    expect(failure).toMatch(/REMOTE HOST IDENTIFICATION HAS CHANGED/);
    expect(failure).toContain(`discord-mcp known-hosts remove localhost:${second.port}`);

    // After removing the stale entry, the new key is accepted on first use again.
    expect(knownHosts.remove(`localhost:${second.port}`)).toBe(true);
    expect((await createUpstreamFetch(config, second, { ca: CA })(second)).status).toBe(200);
});

test("strict checking refuses hosts that are not in known_hosts", async () => {
    const url = await startTlsServer("a");
    const { config, knownHosts } = network("yes");
    const failure = await failureOf(createUpstreamFetch(config, url, { ca: CA })(url));
    expect(failure).toMatch(/STRICT_HOST_KEY_CHECKING=yes/);
    expect(knownHosts.entries().size).toBe(0);
});

test("certificate authority checks still apply before pinning", async () => {
    const url = await startTlsServer("a");
    const { config, knownHosts } = network();
    const failure = await failureOf(createUpstreamFetch(config, url)(url));
    expect(failure).toMatch(/self-signed|certificate/i);
    expect(knownHosts.entries().size).toBe(0);
});

test("a known_hosts file writable by others is refused", async () => {
    const url = await startTlsServer("a");
    const { config, knownHosts } = network();
    await createUpstreamFetch(config, url, { ca: CA })(url);
    chmodSync(knownHosts.path, 0o666);
    expect(() => knownHosts.entries()).toThrow(/UNPROTECTED/);
});
