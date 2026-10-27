import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, onTestFinished, test } from "@rstest/core";
import { AgentClient } from "../agent/agent-client.js";
import { runCli, startAgentFromKeystore } from "./cli.js";

const TOKEN = "cli-test-token.abc.def";

function setup() {
    const dir = mkdtempSync(join(tmpdir(), "discord-mcp-cli-"));
    onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
    const secret = (name: string, contents: string, mode = 0o600) => {
        const path = join(dir, name);
        writeFileSync(path, contents, { mode });
        return path;
    };
    const env: NodeJS.ProcessEnv = {
        DISCORD_MCP_CONFIG_DIR: join(dir, "config"),
        DISCORD_MCP_PASSPHRASE_FILE: secret("passphrase", "correct horse battery staple\n"),
    };
    const out: string[] = [];
    const err: string[] = [];
    const io = { out: (line: string) => out.push(line), err: (line: string) => err.push(line), env };
    const cli = (...argv: string[]) => runCli(argv, io);
    return { dir, env, out, err, io, cli, secret };
}

test("identity add encrypts the token into a private file", async () => {
    const { env, cli, secret, err } = setup();
    const tokenFile = secret("token", `${TOKEN}\n`);

    expect(await cli("identity", "add", "ops-bot", "--token-file", tokenFile)).toBe(0);
    expect(err.join("\n")).toContain("Identity added: ops-bot (bot)");

    const path = join(env.DISCORD_MCP_CONFIG_DIR as string, "identities");
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(readFileSync(path, "utf8")).not.toContain(TOKEN);
});

test("identity list shows names and modes, never tokens", async () => {
    const { cli, secret, out } = setup();
    await cli("identity", "add", "ops-bot", "--token-file", secret("t1", TOKEN));
    await cli("identity", "add", "me", "--mode", "user", "--token-file", secret("t2", "user-token"));

    expect(await cli("identity", "list")).toBe(0);
    expect(out).toEqual(["ops-bot\tbot", "me\tuser"]);
    expect(out.join("\n")).not.toContain(TOKEN);
});

test("secret inputs that others can read are refused", async () => {
    const { cli, secret, env, err } = setup();
    expect(await cli("identity", "add", "ops-bot", "--token-file", secret("open-token", TOKEN, 0o644))).toBe(1);
    expect(err.join("\n")).toMatch(/UNPROTECTED SECRET FILE/);

    env.DISCORD_MCP_PASSPHRASE_FILE = secret("open-passphrase", "pw", 0o640);
    expect(await cli("identity", "add", "ops-bot", "--token-file", secret("token", TOKEN))).toBe(1);
    expect(err.join("\n")).toMatch(/Permissions 0640/);
});

test("a wrong passphrase cannot read or change the identities", async () => {
    const { cli, secret, env, err } = setup();
    await cli("identity", "add", "ops-bot", "--token-file", secret("token", TOKEN));
    env.DISCORD_MCP_PASSPHRASE_FILE = secret("wrong", "not the passphrase");

    expect(await cli("identity", "list")).toBe(1);
    expect(await cli("identity", "remove", "ops-bot")).toBe(1);
    expect(err.join("\n")).toMatch(/Incorrect passphrase/);
});

test("passwd re-encrypts under a new passphrase", async () => {
    const { cli, secret, env, out } = setup();
    await cli("identity", "add", "ops-bot", "--token-file", secret("token", TOKEN));
    env.DISCORD_MCP_NEW_PASSPHRASE_FILE = secret("new", "new passphrase");

    expect(await cli("identity", "passwd")).toBe(0);
    expect(await cli("identity", "list")).toBe(1);
    env.DISCORD_MCP_PASSPHRASE_FILE = env.DISCORD_MCP_NEW_PASSPHRASE_FILE;
    expect(await cli("identity", "list")).toBe(0);
    expect(out).toEqual(["ops-bot\tbot"]);
});

test("the agent serves the decrypted identities, and identity add loads into it", async () => {
    const { cli, secret, env, io, dir } = setup();
    await cli("identity", "add", "ops-bot", "--token-file", secret("token", TOKEN));
    const agent = await startAgentFromKeystore(join(dir, "run", "agent.sock"), "correct horse battery staple", io);
    onTestFinished(() => agent.close());
    const client = new AgentClient(agent.socketPath);
    onTestFinished(() => client.close());
    expect(await client.identities()).toEqual([{ id: "ops-bot", mode: "bot" }]);

    // Like ssh-add: with the agent's socket set, add also loads into it.
    env.DISCORD_MCP_AGENT_SOCK = agent.socketPath;
    expect(await cli("identity", "add", "second", "--token-file", secret("token2", "second-token"))).toBe(0);
    expect(await client.identities()).toEqual([
        { id: "ops-bot", mode: "bot" },
        { id: "second", mode: "bot" },
    ]);

    expect(await cli("identity", "remove", "second")).toBe(0);
    expect(await client.identities()).toEqual([{ id: "ops-bot", mode: "bot" }]);
});

test("token-env reads a token from a named variable, for migrating from DISCORD_TOKEN", async () => {
    const { cli, env, out } = setup();
    env.DISCORD_TOKEN = TOKEN;
    expect(await cli("identity", "add", "default-bot", "--token-env", "DISCORD_TOKEN")).toBe(0);
    await cli("identity", "list");
    expect(out).toEqual(["default-bot\tbot"]);
    expect(await cli("identity", "add", "x", "--token-env", "MISSING_VAR")).toBe(1);
});

test("known-hosts list and remove", async () => {
    const { cli, env, out, err } = setup();
    const { KnownHosts } = await import("../net/known-hosts.js");
    const knownHosts = new KnownHosts(join(env.DISCORD_MCP_CONFIG_DIR as string, "known_hosts"));
    knownHosts.add("mcp.example.com:443", "SHA256:abc");

    expect(await cli("known-hosts", "list")).toBe(0);
    expect(out).toEqual(["mcp.example.com:443 SHA256:abc"]);
    expect(await cli("known-hosts", "remove", "mcp.example.com:443")).toBe(0);
    expect(await cli("known-hosts", "remove", "mcp.example.com:443")).toBe(1);
    expect(err.at(-1)).toMatch(/is not in/);
});

test("invalid ids and unknown commands fail with usage", async () => {
    const { cli, secret, err, out } = setup();
    expect(await cli("identity", "add", "../escape", "--token-file", secret("token", TOKEN))).toBe(1);
    expect(err.join("\n")).toMatch(/Invalid identity id/);
    expect(await cli("frobnicate")).toBe(1);
    expect(out.join("\n")).toMatch(/Usage:/);
});
