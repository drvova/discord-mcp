import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentClient } from "../agent/agent-client.js";
import { startAgent, type RunningAgent } from "../agent/agent-server.js";
import { ConnectTunnelAgent } from "../agent/tunnel-agent.js";
import { KnownHosts, defaultKnownHostsPath } from "../net/known-hosts.js";
import { loadNetworkConfig, proxyTlsOptions, redactUrl } from "../net/network.js";
import { Keystore, defaultKeystorePath, validateIdentityId, type KeystoreIdentity } from "../keystore/keystore.js";
import { readNewPassphrase, readPassphrase, readToken } from "./prompt.js";

// `discord-mcp <command>`: the ssh-agent / ssh-add / ssh-keygen / known_hosts
// workflow for Discord tokens. Running `discord-mcp` with no command starts the
// MCP server.

const USAGE = `Usage:
  discord-mcp                         start the MCP server
  discord-mcp agent [-a SOCKET]       hold decrypted tokens and serve them on a private
                                      Unix socket (like ssh-agent); prints the
                                      DISCORD_MCP_AGENT_SOCK line to export
  discord-mcp identity add ID [--mode bot|user] [--token-file FILE | --token-env VAR]
                                      encrypt a token into the identities file (like
                                      ssh-add); prompts for it if no source is given,
                                      reads stdin when piped
  discord-mcp identity list           identity names and modes (never tokens)
  discord-mcp identity remove ID
  discord-mcp identity passwd         change the identities passphrase (like ssh-keygen -p)
  discord-mcp known-hosts list        pinned TLS keys of upstream servers and proxies
  discord-mcp known-hosts remove HOST:PORT

Files and environment:
  identities file    ${defaultKeystorePath()} (DISCORD_MCP_IDENTITIES_FILE)
  known_hosts        ${defaultKnownHostsPath()} (DISCORD_MCP_KNOWN_HOSTS)
  DISCORD_MCP_AGENT_SOCK        the agent socket the server (and these commands) use
  DISCORD_MCP_PASSPHRASE_FILE   read the passphrase from this private (mode 600) file
                                instead of prompting, for unattended agents
  DISCORD_MCP_STRICT_HOST_KEY_CHECKING   accept-new (default) or yes`;

type Io = {
    out: (line: string) => void;
    err: (line: string) => void;
    env: NodeJS.ProcessEnv;
};

const defaultIo: Io = {
    out: (line) => process.stdout.write(`${line}\n`),
    err: (line) => process.stderr.write(`${line}\n`),
    env: process.env,
};

export function defaultAgentSocket(env: NodeJS.ProcessEnv = process.env): string {
    if (env.XDG_RUNTIME_DIR) {
        return join(env.XDG_RUNTIME_DIR, "discord-mcp", "agent.sock");
    }
    const uid = typeof process.getuid === "function" ? process.getuid() : "user";
    return join(tmpdir(), `discord-mcp-${uid}`, "agent.sock");
}

function option(args: string[], name: string): string | undefined {
    const index = args.indexOf(name);
    if (index === -1) {
        return undefined;
    }
    const value = args[index + 1];
    if (!value || value.startsWith("-")) {
        throw new Error(`${name} needs a value.`);
    }
    args.splice(index, 2);
    return value;
}

// Decrypts the identities file and starts an agent holding them.
export async function startAgentFromKeystore(
    socketPath: string,
    passphrase: string,
    io: Io = defaultIo,
): Promise<RunningAgent> {
    const keystore = new Keystore(defaultKeystorePath(io.env));
    const identities = keystore.load(passphrase);
    const network = loadNetworkConfig(io.env, {
        onHostAdded: (hostPort, fingerprint) =>
            io.err(`Permanently added '${hostPort}' (${fingerprint}) to known hosts.`),
    });
    const agent = await startAgent({
        socketPath,
        identities: identities.map(({ id, mode, token }) => ({ id, mode, token })),
        dispatcher: network.dispatcher,
        gatewayAgent: network.proxyUrl
            ? new ConnectTunnelAgent(network.proxyUrl, proxyTlsOptions(network))
            : undefined,
        log: (message) => io.err(`discord-mcp agent: ${message}`),
    });
    if (identities.length === 0) {
        io.err(`No identities in ${keystore.path} yet; add one with: discord-mcp identity add ID`);
    }
    if (network.proxyUrl) {
        io.err(`Discord REST and gateway go through proxy ${redactUrl(network.proxyUrl)}.`);
    }
    return agent;
}

async function agentCommand(args: string[], io: Io): Promise<number> {
    const socketPath = option(args, "-a") || defaultAgentSocket(io.env);
    const keystore = new Keystore(defaultKeystorePath(io.env));
    const passphrase = keystore.exists() ? await readPassphrase(undefined, io.env) : "";
    const agent = await startAgentFromKeystore(socketPath, passphrase, io);
    io.out(`DISCORD_MCP_AGENT_SOCK=${agent.socketPath}; export DISCORD_MCP_AGENT_SOCK;`);
    io.out(`echo Agent pid ${process.pid};`);
    await new Promise<void>((resolveStop) => {
        process.once("SIGINT", resolveStop);
        process.once("SIGTERM", resolveStop);
    });
    await agent.close();
    return 0;
}

async function loadForEdit(keystore: Keystore, io: Io): Promise<{ identities: KeystoreIdentity[]; passphrase: string }> {
    if (!keystore.exists()) {
        io.err(`Creating ${keystore.path}.`);
        const passphrase = await readNewPassphrase(io.env);
        if (!passphrase) {
            io.err("Warning: an empty passphrase leaves the tokens readable by anyone who can read the file.");
        }
        return { identities: [], passphrase };
    }
    const passphrase = await readPassphrase(undefined, io.env);
    return { identities: keystore.load(passphrase), passphrase };
}

function agentFor(io: Io): AgentClient | undefined {
    return io.env.DISCORD_MCP_AGENT_SOCK ? new AgentClient(io.env.DISCORD_MCP_AGENT_SOCK) : undefined;
}

async function identityCommand(args: string[], io: Io): Promise<number> {
    const [action, id] = args;
    const keystore = new Keystore(defaultKeystorePath(io.env));

    if (action === "add") {
        const mode = option(args, "--mode") || "bot";
        const tokenFile = option(args, "--token-file");
        const tokenEnv = option(args, "--token-env");
        if (!id) {
            throw new Error("Usage: discord-mcp identity add ID [--mode bot|user]");
        }
        validateIdentityId(id);
        if (mode !== "bot" && mode !== "user") {
            throw new Error("--mode must be bot or user.");
        }
        const token = tokenEnv ? (io.env[tokenEnv] || "").trim() : await readToken(tokenFile);
        if (!token) {
            throw new Error(tokenEnv ? `${tokenEnv} is empty.` : "No token given.");
        }
        const { identities, passphrase } = await loadForEdit(keystore, io);
        const others = identities.filter((identity) => identity.id !== id);
        keystore.save([...others, { id, mode, token, addedAt: new Date().toISOString() }], passphrase);
        io.err(`Identity added: ${id} (${mode})`);
        const agent = agentFor(io);
        if (agent) {
            try {
                await agent.addIdentity({ id, mode, token });
                io.err(`Identity loaded into the agent at ${agent.socketPath}.`);
            } finally {
                await agent.close();
            }
        }
        return 0;
    }

    if (action === "list") {
        const agent = agentFor(io);
        const identities = agent
            ? await agent.identities().finally(() => agent.close())
            : keystore.load(await readPassphrase(undefined, io.env));
        if (identities.length === 0) {
            io.err(agent ? "The agent has no identities." : `No identities in ${keystore.path}.`);
        }
        for (const identity of identities) {
            io.out(`${identity.id}\t${identity.mode}`);
        }
        return 0;
    }

    if (action === "remove") {
        if (!id) {
            throw new Error("Usage: discord-mcp identity remove ID");
        }
        const passphrase = await readPassphrase(undefined, io.env);
        const identities = keystore.load(passphrase);
        const remaining = identities.filter((identity) => identity.id !== id);
        if (remaining.length === identities.length) {
            io.err(`No identity named ${id}.`);
            return 1;
        }
        keystore.save(remaining, passphrase);
        io.err(`Identity removed: ${id}`);
        const agent = agentFor(io);
        if (agent) {
            await agent.removeIdentity(id).finally(() => agent.close());
        }
        return 0;
    }

    if (action === "passwd") {
        const identities = keystore.load(await readPassphrase("Enter old passphrase: ", io.env));
        const passphrase = await readNewPassphrase({ ...io.env, DISCORD_MCP_PASSPHRASE_FILE: io.env.DISCORD_MCP_NEW_PASSPHRASE_FILE });
        keystore.save(identities, passphrase);
        io.err("Passphrase changed.");
        return 0;
    }

    throw new Error(USAGE);
}

function knownHostsCommand(args: string[], io: Io): number {
    const knownHosts = new KnownHosts(defaultKnownHostsPath(io.env));
    const [action, hostPort] = args;
    if (action === "list") {
        for (const [host, fingerprint] of knownHosts.entries()) {
            io.out(`${host} ${fingerprint}`);
        }
        return 0;
    }
    if (action === "remove" && hostPort) {
        const removed = knownHosts.remove(hostPort);
        io.err(removed ? `Removed ${hostPort} from ${knownHosts.path}.` : `${hostPort} is not in ${knownHosts.path}.`);
        return removed ? 0 : 1;
    }
    throw new Error(USAGE);
}

export async function runCli(argv: string[], io: Io = defaultIo): Promise<number> {
    const [command, ...rest] = argv;
    const args = [...rest];
    try {
        switch (command) {
            case "agent":
                return await agentCommand(args, io);
            case "identity":
                return await identityCommand(args, io);
            case "known-hosts":
                return knownHostsCommand(args, io);
            default:
                io.out(USAGE);
                return command === "help" || command === "--help" || command === "-h" ? 0 : 1;
        }
    } catch (error) {
        io.err(`discord-mcp: ${error instanceof Error ? error.message : String(error)}`);
        return 1;
    }
}
