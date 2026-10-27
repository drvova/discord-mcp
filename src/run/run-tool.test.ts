import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { DiscordService } from "../discord-service.js";
import { bindDiscordOperationsService } from "../gateway/discord-operations.js";
import { createHttpApp } from "../http-app.js";
import { LocalEncryptedIdentityStore } from "../identity/local-encrypted-identity-store.js";
import { createDiscordHarness } from "./discord-namespace.js";
import { listTools, parseRunArguments, RUN_TOOL_NAME } from "./run-tool.js";

function setup(t: test.TestContext) {
    const dir = mkdtempSync(join(tmpdir(), "discord-mcp-run-"));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    // Constructing the service does not log in, so no token or network is used.
    const service = new DiscordService({ tokenType: "bot", token: "unused" });
    bindDiscordOperationsService(service);
    const identityStore = new LocalEncryptedIdentityStore({
        filePath: join(dir, "identities.enc"),
    });
    return createDiscordHarness({
        getService: () => service,
        identityStore,
        persistDir: join(dir, "kept"),
    });
}

test("the advertised tool set is exactly { run }", () => {
    assert.deepEqual(
        listTools().map((tool) => tool.name),
        [RUN_TOOL_NAME],
    );
    assert.equal(RUN_TOOL_NAME, "run");
    assert.deepEqual(listTools()[0].inputSchema.required, ["code"]);
    assert.match(listTools()[0].description, /full authority/);
    assert.match(listTools()[0].description, /sandboxed/);
});

test("the HTTP transport lists and calls only the run tool", async () => {
    const calls: unknown[] = [];
    const app = createHttpApp({
        port: 0,
        server: new Server({ name: "test", version: "0" }, { capabilities: { tools: {} } }),
        callTool: async (name, args) => {
            calls.push([name, args]);
            return { content: [{ type: "text", text: "ran" }] };
        },
        getOAuthManager: () => {
            throw new Error("unused");
        },
        parseBooleanQuery: () => undefined,
        listTools,
    });
    const post = (body: unknown) =>
        app.request("/", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
        });

    const list = (await (await post({ id: 1, method: "tools/list" })).json()) as {
        result: { tools: Array<{ name: string }> };
    };
    assert.deepEqual(list.result.tools.map((tool) => tool.name), ["run"]);

    const call = (await (
        await post({ id: 2, method: "tools/call", params: { name: "run", arguments: { code: "1" } } })
    ).json()) as { result: { content: Array<{ text: string }> } };
    assert.equal(call.result.content[0].text, "ran");
    assert.deepEqual(calls, [["run", { code: "1" }]]);
});

test("tool arguments are code, not an operation selector", () => {
    assert.deepEqual(parseRunArguments("run", { code: "1+1", vars: { a: "b" } }), {
        code: "1+1",
        identity: undefined,
        vars: { a: "b" },
    });
    assert.deepEqual(parseRunArguments("run", {}), {
        code: "",
        identity: undefined,
        vars: undefined,
    });
    assert.throws(() => parseRunArguments("discord_manage", { code: "" }), /only tool is 'run'/);
    assert.throws(() => parseRunArguments("run", { code: "", vars: { a: 1 } }), /vars\.a/);
});

test("empty code returns a manual naming the namespace and what the project offers", async (t) => {
    const discord = setup(t);
    const { ok, text } = await discord.run("");
    assert.equal(ok, true);
    for (const name of [
        "describe(x)",
        "kept()",
        "forget(name)",
        "man()",
        "vars",
        "identities()",
        "connect(",
        "bind(id)",
        "client",
        "packages()",
        "symbols(",
        "ops.",
        "sandboxed",
    ]) {
        assert.ok(text.includes(name), `manual should mention ${name}`);
    }
});

test("pre-existing capability code still works when driven from code", async (t) => {
    const discord = setup(t);
    const result = await discord.run(
        "const viaOps = await ops.packages({}); const direct = await packages(); [viaOps.packageCount === direct.length, direct.map(p => p.packageAlias).includes('discordjs')]",
    );
    assert.equal(result.text, "[ true, true ]");

    const symbols = await discord.run(
        "(await ops.symbols({ packageAlias: 'discordjs', query: 'Client', pageSize: 5 })).items.length > 0",
    );
    assert.equal(symbols.value, true, symbols.text);
});

test("describe(client) shows live capabilities and documented methods", async (t) => {
    const discord = setup(t);
    const result = await discord.run(
        "const d = describe(client); [d.capabilities.ready, d.members.find(m => m.name === 'login')]",
    );
    assert.equal(result.ok, true, result.text);
    const [ready, login] = result.value as [boolean, Record<string, string>];
    assert.equal(ready, false);
    assert.equal(login.kind, "method");
    assert.match(login.signature, /^async login\(/);
    assert.match(login.doc, /Logs the client in/);
});

test("binding an unknown identity fails clearly without running the code", async (t) => {
    const discord = setup(t);
    const result = await discord.run("print('should not run')", { identity: "nobody" });
    assert.equal(result.ok, false);
    assert.match(result.text, /Unknown identity 'nobody'/);
    assert.doesNotMatch(result.text, /should not run/);
});
