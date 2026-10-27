import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, onTestFinished, test } from "@rstest/core";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { DiscordService } from "../discord-service.js";
import { bindDiscordOperationsService } from "../gateway/discord-operations.js";
import { createHttpApp } from "../http-app.js";
import { LocalEncryptedIdentityStore } from "../identity/local-encrypted-identity-store.js";
import { createDiscordHarness } from "./discord-namespace.js";
import { listTools, parseRunArguments, RUN_TOOL_NAME } from "./run-tool.js";

function setup() {
    const dir = mkdtempSync(join(tmpdir(), "discord-mcp-run-"));
    onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
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
    expect(listTools().map((tool) => tool.name)).toEqual([RUN_TOOL_NAME]);
    expect(RUN_TOOL_NAME).toBe("run");
    expect(listTools()[0].inputSchema.required).toEqual(["code"]);
    expect(listTools()[0].description).toMatch(/full authority/);
    expect(listTools()[0].description).toMatch(/sandboxed/);
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
    expect(list.result.tools.map((tool) => tool.name)).toEqual(["run"]);

    const call = (await (
        await post({ id: 2, method: "tools/call", params: { name: "run", arguments: { code: "1" } } })
    ).json()) as { result: { content: Array<{ text: string }> } };
    expect(call.result.content[0].text).toBe("ran");
    expect(calls).toEqual([["run", { code: "1" }]]);
});

test("tool arguments are code, not an operation selector", () => {
    expect(parseRunArguments("run", { code: "1+1", vars: { a: "b" } })).toEqual({
        code: "1+1",
        identity: undefined,
        vars: { a: "b" },
    });
    expect(parseRunArguments("run", {})).toEqual({
        code: "",
        identity: undefined,
        vars: undefined,
    });
    expect(() => parseRunArguments("discord_manage", { code: "" })).toThrow(/only tool is 'run'/);
    expect(() => parseRunArguments("run", { code: "", vars: { a: 1 } })).toThrow(/vars\.a/);
});

test("empty code returns a manual naming the namespace and what the project offers", async () => {
    const discord = setup();
    const { ok, text } = await discord.run("");
    expect(ok).toBe(true);
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
        expect(text.includes(name), `manual should mention ${name}`).toBe(true);
    }
});

test("pre-existing capability code still works when driven from code", async () => {
    const discord = setup();
    const result = await discord.run(
        "const viaOps = await ops.packages({}); const direct = await packages(); [viaOps.packageCount === direct.length, direct.map(p => p.packageAlias).includes('discordjs')]",
    );
    expect(result.text).toBe("[ true, true ]");

    const symbols = await discord.run(
        "(await ops.symbols({ packageAlias: 'discordjs', query: 'Client', pageSize: 5 })).items.length > 0",
    );
    expect(symbols.ok).toBe(true);
    expect(symbols.value).toBe(true);
});

test("describe(client) shows live capabilities and documented methods", async () => {
    const discord = setup();
    const result = await discord.run(
        "const d = describe(client); [d.capabilities.ready, d.members.find(m => m.name === 'login')]",
    );
    expect(result.ok).toBe(true);
    const [ready, login] = result.value as [boolean, Record<string, string>];
    expect(ready).toBe(false);
    expect(login.kind).toBe("method");
    expect(login.signature).toMatch(/^async login\(/);
    expect(login.doc).toMatch(/Logs the client in/);
});

test("binding an unknown identity fails clearly without running the code", async () => {
    const discord = setup();
    const result = await discord.run("print('should not run')", { identity: "nobody" });
    expect(result.ok).toBe(false);
    expect(result.text).toMatch(/Unknown identity 'nobody'/);
    expect(result.text).not.toMatch(/should not run/);
});
