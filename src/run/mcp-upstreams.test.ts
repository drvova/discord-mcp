import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, onTestFinished, test } from "@rstest/core";
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

// Spawned as its own process, so it runs from the build (`npm test` builds first).
const fixturePath = join(process.cwd(), "dist", "run", "mcp-fixture-server.js");
const stdioFixture = { command: process.execPath, args: [fixturePath] };

function setup(dir?: string) {
    const root = dir || mkdtempSync(join(tmpdir(), "discord-mcp-upstream-"));
    if (!dir) {
        onTestFinished(() => rmSync(root, { recursive: true, force: true }));
    }
    const upstreams = new McpUpstreams();
    onTestFinished(() => upstreams.closeAll());
    const discord = createDiscordHarness({
        getService: () => new DiscordService({ tokenType: "bot", token: "unused" }),
        identityStore: new LocalEncryptedIdentityStore({ filePath: join(root, "ids.enc") }),
        persistDir: join(root, "kept"),
        upstreams,
    });
    return { discord, upstreams, root };
}

test("stdio MCP server tools become callable functions under mcp.<server>", async () => {
    const { discord, upstreams } = setup();
    const status = await upstreams.connect("fixture", stdioFixture);
    expect(status.connected).toBe(true);
    expect(status.tools).toEqual(["add", "echo_text", "count", "fail"]);

    const sum = await discord.run("await mcp.fixture.add({ a: 2, b: 3 })");
    expect(sum.text).toBe("{ sum: 5 }");

    const composed = await discord.run(
        "const s = (await mcp.fixture.add({ a: 1, b: 1 })).sum; await mcp.fixture.echo_text({ text: `got ${s}`, shout: true })",
    );
    expect(composed.text).toBe("GOT 2");

    const structured = await discord.run("await mcp.fixture.count({ mode: 'fast' })");
    expect(structured.text).toBe("{ count: 3, mode: 'fast' }");

    const failed = await discord.run("await mcp.fixture.fail()");
    expect(failed.ok).toBe(false);
    expect(failed.text).toMatch(/mcp\.fixture\.fail failed: nope/);

    const servers = await discord.run("mcpServers().map(s => `${s.name}:${s.transport}:${s.connected}`)");
    expect(servers.text).toBe("[ 'fixture:stdio:true' ]");
});

test("describe shows each upstream tool's signature and doc from its schema", async () => {
    const { discord, upstreams } = setup();
    await upstreams.connect("fixture", stdioFixture);

    const members = await discord.run(
        "describe(mcp.fixture).members.map(m => `${m.signature} — ${m.doc}`).join('\\n')",
    );
    expect(members.text).toBe([
            "add({ a: number, b: number }) — Adds two numbers.",
            "echo_text({ text: string, shout?: boolean }) — Echoes text back.",
            'count({ mode: "fast" | "slow" }) — Returns structured content.',
            "fail() — Always reports an error.",
        ].join("\n"));

    const one = await discord.run("const d = describe(mcp.fixture.add); [d.server, d.tool, d.signature]");
    expect(one.text).toBe("[ 'fixture', 'add', 'add({ a: number, b: number })' ]");
});

test("a kept helper wrapping an upstream tool works after a restart", async () => {
    const first = setup();
    await first.upstreams.connect("fixture", stdioFixture);
    const defined = await first.discord.run(
        "async function addAll(...xs) { let total = 0; for (const x of xs) total = (await mcp.fixture.add({ a: total, b: x })).sum; return total }\nawait addAll(1, 2, 3)",
    );
    expect(defined.text).toBe("6\n[kept: addAll]");
    await first.upstreams.closeAll();

    const second = setup(first.root);
    void second.upstreams.connectAll({ fixture: stdioFixture });
    const reused = await second.discord.run("await addAll(10, 20)");
    expect(reused.text).toBe("30");
});

test("streamable HTTP MCP servers work, and the model can connect one from code", async () => {
    const fixture = await startHttpFixture();
    onTestFinished(() => fixture.close());
    const { discord } = setup();

    const connected = await discord.run(
        "const s = await mcpConnect('remote', { url: vars.url }); [s.transport, s.connected]",
        { vars: { url: fixture.url } },
    );
    expect(connected.text).toBe("[ 'http', true ]");
    expect((await discord.run("(await mcp.remote.add({ a: 4, b: 5 })).sum")).text).toBe("9");

    expect((await discord.run("await mcpDisconnect('remote'); typeof mcp.remote")).text).toBe("undefined");
});

test("an unreachable server is reported, not fatal", async () => {
    const { discord, upstreams } = setup();
    await upstreams.connectAll({ broken: { command: join(tmpdir(), "no-such-mcp-server") } });

    const result = await discord.run("mcpServers()[0]");
    expect(result.ok).toBe(true);
    expect(result.text).toMatch(/name: 'broken'/);
    expect(result.text).toMatch(/connected: false/);
    expect(result.text).toMatch(/error: '/);
    expect((await discord.run("typeof mcp.broken")).text).toBe("undefined");
});

test("upstream config accepts the mcpServers shape, a bare map or a file path", () => {
    const dir = mkdtempSync(join(tmpdir(), "discord-mcp-upstream-config-"));
    onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
    const file = join(dir, "servers.json");
    writeFileSync(file, JSON.stringify({ mcpServers: { a: { url: "http://x" } } }));

    expect(loadUpstreamConfigs(undefined)).toEqual({});
    expect(loadUpstreamConfigs('{"b":{"command":"c"}}')).toEqual({ b: { command: "c" } });
    expect(loadUpstreamConfigs(file)).toEqual({ a: { url: "http://x" } });
    expect(() => loadUpstreamConfigs(join(dir, "missing.json"))).toThrow(/not found/);
});

test("schema signatures, identifiers and result unwrapping", () => {
    expect(toIdentifier("get-issue")).toBe("get_issue");
    expect(toIdentifier("2fa.check")).toBe("_2fa_check");
    expect(signatureFromSchema("search", {
            type: "object",
            properties: {
                q: { type: "string" },
                limit: { type: "integer" },
                tags: { type: "array", items: { type: "string" } },
                "sort-by": { enum: ["new", "top"] },
            },
            required: ["q"],
        })).toBe('search({ q: string, limit?: number, tags?: string[], "sort-by"?: "new" | "top" })');
    expect(unwrapToolResult("t", { content: [{ type: "text", text: '{"a":1}' }] })).toEqual({ a: 1 });
    expect(unwrapToolResult("t", { content: [{ type: "text", text: "plain" }] })).toBe("plain");
    expect(unwrapToolResult("t", { structuredContent: { b: 2 }, content: [] })).toEqual({ b: 2 });
    const image = [{ type: "image", data: "x" }];
    expect(unwrapToolResult("t", { content: image })).toEqual(image);
    expect(() => unwrapToolResult("t", { isError: true, content: [{ type: "text", text: "bad" }] })).toThrow(/t failed: bad/);
});
