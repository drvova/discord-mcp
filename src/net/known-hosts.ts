import { createHash, X509Certificate } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { checkServerIdentity, type PeerCertificate } from "node:tls";
import { configDir, readPrivateFile, writePrivateFile } from "../keystore/secret-file.js";

// TLS key pinning modelled on OpenSSH's known_hosts: the first connection to an
// upstream MCP server (or an https proxy) records the SHA-256 of its public key;
// later connections must present the same key. Normal CA and hostname
// verification still run first.

export type HostKeyPolicy = "accept-new" | "yes";

export type HostKeyCheck = {
    hostPort: string;
    policy: HostKeyPolicy;
    onAdded?: (hostPort: string, fingerprint: string) => void;
};

export function defaultKnownHostsPath(env: NodeJS.ProcessEnv = process.env): string {
    return env.DISCORD_MCP_KNOWN_HOSTS || join(configDir(env), "known_hosts");
}

export function hostKeyPolicy(env: NodeJS.ProcessEnv = process.env): HostKeyPolicy {
    const raw = (env.DISCORD_MCP_STRICT_HOST_KEY_CHECKING || "accept-new").toLowerCase();
    if (raw === "yes" || raw === "accept-new") {
        return raw;
    }
    throw new Error(
        `DISCORD_MCP_STRICT_HOST_KEY_CHECKING must be 'accept-new' or 'yes' (got '${raw}').`,
    );
}

export function hostPortOf(url: URL): string {
    const port = url.port || (url.protocol === "https:" ? "443" : "80");
    return `${url.hostname}:${port}`;
}

export function fingerprintOf(cert: PeerCertificate): string {
    const spki = new X509Certificate(cert.raw).publicKey.export({ type: "spki", format: "der" });
    return `SHA256:${createHash("sha256").update(spki).digest("base64").replace(/=+$/, "")}`;
}

export class KnownHosts {
    constructor(readonly path: string = defaultKnownHostsPath()) {}

    entries(): Map<string, string> {
        const entries = new Map<string, string>();
        if (!existsSync(this.path)) {
            return entries;
        }
        for (const line of readPrivateFile(this.path, { writableOnly: true }).split("\n")) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith("#")) {
                continue;
            }
            const [hostPort, fingerprint] = trimmed.split(/\s+/);
            if (hostPort && fingerprint) {
                entries.set(hostPort, fingerprint);
            }
        }
        return entries;
    }

    add(hostPort: string, fingerprint: string): void {
        const entries = this.entries();
        entries.set(hostPort, fingerprint);
        this.write(entries);
    }

    remove(hostPort: string): boolean {
        const entries = this.entries();
        const removed = entries.delete(hostPort);
        if (removed) {
            this.write(entries);
        }
        return removed;
    }

    // A tls `checkServerIdentity` that does the usual hostname check, then
    // compares the key with known_hosts.
    verifier(check: HostKeyCheck): (hostname: string, cert: PeerCertificate) => Error | undefined {
        return (hostname, cert) => {
            const hostnameError = checkServerIdentity(hostname, cert);
            if (hostnameError) {
                return hostnameError;
            }
            try {
                return this.verify(check, fingerprintOf(cert));
            } catch (error) {
                return error instanceof Error ? error : new Error(String(error));
            }
        };
    }

    verify(check: HostKeyCheck, fingerprint: string): Error | undefined {
        const known = this.entries().get(check.hostPort);
        if (known === fingerprint) {
            return undefined;
        }
        if (known) {
            return new Error(
                [
                    "@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@",
                    "@    WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!     @",
                    "@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@",
                    `The TLS key for ${check.hostPort} is not the one recorded in ${this.path}.`,
                    "Someone could be intercepting the connection, or the server's key was rotated.",
                    `Expected ${known}`,
                    `Got      ${fingerprint}`,
                    `If the change is expected: discord-mcp known-hosts remove ${check.hostPort}`,
                ].join("\n"),
            );
        }
        if (check.policy === "yes") {
            return new Error(
                `No key for ${check.hostPort} in ${this.path} and DISCORD_MCP_STRICT_HOST_KEY_CHECKING=yes. Its key is ${fingerprint}.`,
            );
        }
        this.add(check.hostPort, fingerprint);
        check.onAdded?.(check.hostPort, fingerprint);
        return undefined;
    }

    private write(entries: Map<string, string>): void {
        const lines = Array.from(entries, ([hostPort, fingerprint]) => `${hostPort} ${fingerprint}`);
        writePrivateFile(this.path, `${lines.join("\n")}\n`);
    }
}
