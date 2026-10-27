import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { DiscordService } from "../discord-service.js";
import { LocalEncryptedIdentityStore } from "../identity/local-encrypted-identity-store.js";
import { createDiscordHarness } from "./discord-namespace.js";
import { startHttpFixture } from "./mcp-fixture-server.js";
import {
    loadUpstreamConfigs,
    McpUpstreams,
    signatureFromSchema,
    toIdentifier,
    unwrapToolResult,
} from "./mcp-upstreams.js";

const fixturePath = fileURLToPath(new URL("./mcp-fixture-server.js", import.meta.url));
const stdioFixture = { command: process.execPath, args: [fixturePath] };

function setup(t: test.TestContext, dir?: string) {
    const root = dir || mkdtempSync(join(tmpdir(), "discord-mcp-upstream-"));
    if (!dir) {
        t.after(() => rmSync(root, { recursive: true, force: true }));
    }
    const upstreams = new McpUpstreams();
    t.after(() => upstreams.closeAll());
    const discord = createDiscordHarness({
        getService: () => new DiscordService({ tokenType: "bot", token: "unused" }),
        identityStore: new LocalEncryptedIdentityStore({ filePath: join(root, "ids.enc") }),
        persistDir: join(root, "kept"),
        upstreams,
    });
    return { discord, upstreams, root };
}

test("stdio MCP server tools become callable functions under mcp.<server>", async (t) => {
    const { discord, upstreams } = setup(t);
    const status = await upstreams.connect("fixture", stdioFixture);
    assert.equal(status.connected, true);
    assert.deepEqual(status.tools, ["add", "echo_text", "count", "fail"]);

    const sum = await discord.run("await mcp.fixture.add({ a: 2, b: 3 })");
    assert.equal(sum.text, "{ sum: 5 }");

    const composed = await discord.run(
        "const s = (await mcp.fixture.add({ a: 1, b: 1 })).sum; await mcp.fixture.echo_text({ text: `got ${s}`, shout: true })",
    );
    assert.equal(composed.text, "GOT 2");

    const structured = await discord.run("await mcp.fixture.count({ mode: 'fast' })");
    assert.equal(structured.text, "{ count: 3, mode: 'fast' }");

    const failed = await discord.run("await mcp.fixture.fail()");
    assert.equal(failed.ok, false);
    assert.match(failed.text, /mcp\.fixture\.fail failed: nope/);

    const servers = await discord.run("mcpServers().map(s => `${s.name}:${s.transport}:${s.connected}`)");
    assert.equal(servers.text, "[ 'fixture:stdio:true' ]");
});

test("describe shows each upstream tool's signature and doc from its schema", async (t) => {
    const { discord, upstreams } = setup(t);
    await upstreams.connect("fixture", stdioFixture);

    const members = await discord.run(
        "describe(mcp.fixture).members.map(m => `${m.signature} — ${m.doc}`).join('\\n')",
    );
    assert.equal(
        members.text,
        [
            "add({ a: number, b: number }) — Adds two numbers.",
            "echo_text({ text: string, shout?: boolean }) — Echoes text back.",
            'count({ mode: "fast" | "slow" }) — Returns structured content.',
            "fail() — Always reports an error.",
        ].join("\n"),
    );

    const one = await discord.run("const d = describe(mcp.fixture.add); [d.server, d.tool, d.signature]");
    assert.equal(one.text, "[ 'fixture', 'add', 'add({ a: number, b: number })' ]");
});

test("a kept helper wrapping an upstream tool works after a restart", async (t) => {
    const first = setup(t);
    await first.upstreams.connect("fixture", stdioFixture);
    const defined = await first.discord.run(
        "async function addAll(...xs) { let total = 0; for (const x of xs) total = (await mcp.fixture.add({ a: total, b: x })).sum; return total }\nawait addAll(1, 2, 3)",
    );
    assert.equal(defined.text, "6\n[kept: addAll]");
    await first.upstreams.closeAll();

    const second = setup(t, first.root);
    void second.upstreams.connectAll({ fixture: stdioFixture });
    const reused = await second.discord.run("await addAll(10, 20)");
    assert.equal(reused.text, "30");
});

test("streamable HTTP MCP servers work, and the model can connect one from code", async (t) => {
    const fixture = await startHttpFixture();
    t.after(() => fixture.close());
    const { discord } = setup(t);

    const connected = await discord.run(
        "const s = await mcpConnect('remote', { url: vars.url }); [s.transport, s.connected]",
        { vars: { url: fixture.url } },
    );
    assert.equal(connected.text, "[ 'http', true ]");
    assert.equal((await discord.run("(await mcp.remote.add({ a: 4, b: 5 })).sum")).text, "9");

    assert.equal((await discord.run("await mcpDisconnect('remote'); typeof mcp.remote")).text, "undefined");
});

test("an unreachable server is reported, not fatal", async (t) => {
    const { discord, upstreams } = setup(t);
    await upstreams.connectAll({ broken: { command: join(tmpdir(), "no-such-mcp-server") } });

    const result = await discord.run("mcpServers()[0]");
    assert.equal(result.ok, true);
    assert.match(result.text, /name: 'broken'/);
    assert.match(result.text, /connected: false/);
    assert.match(result.text, /error: '/);
    assert.equal((await discord.run("typeof mcp.broken")).text, "undefined");
});

test("upstream config accepts the mcpServers shape, a bare map or a file path", (t) => {
    const dir = mkdtempSync(join(tmpdir(), "discord-mcp-upstream-config-"));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const file = join(dir, "servers.json");
    writeFileSync(file, JSON.stringify({ mcpServers: { a: { url: "http://x" } } }));

    assert.deepEqual(loadUpstreamConfigs(undefined), {});
    assert.deepEqual(loadUpstreamConfigs('{"b":{"command":"c"}}'), { b: { command: "c" } });
    assert.deepEqual(loadUpstreamConfigs(file), { a: { url: "http://x" } });
    assert.throws(() => loadUpstreamConfigs(join(dir, "missing.json")), /not found/);
});

test("schema signatures, identifiers and result unwrapping", () => {
    assert.equal(toIdentifier("get-issue"), "get_issue");
    assert.equal(toIdentifier("2fa.check"), "_2fa_check");
    assert.equal(
        signatureFromSchema("search", {
            type: "object",
            properties: {
                q: { type: "string" },
                limit: { type: "integer" },
                tags: { type: "array", items: { type: "string" } },
                "sort-by": { enum: ["new", "top"] },
            },
            required: ["q"],
        }),
        'search({ q: string, limit?: number, tags?: string[], "sort-by"?: "new" | "top" })',
    );
    assert.deepEqual(unwrapToolResult("t", { content: [{ type: "text", text: '{"a":1}' }] }), { a: 1 });
    assert.equal(unwrapToolResult("t", { content: [{ type: "text", text: "plain" }] }), "plain");
    assert.deepEqual(unwrapToolResult("t", { structuredContent: { b: 2 }, content: [] }), { b: 2 });
    const image = [{ type: "image", data: "x" }];
    assert.deepEqual(unwrapToolResult("t", { content: image }), image);
    assert.throws(
        () => unwrapToolResult("t", { isError: true, content: [{ type: "text", text: "bad" }] }),
        /t failed: bad/,
    );
});
