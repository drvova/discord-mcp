import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, onTestFinished, test } from "@rstest/core";
import { pathToFileURL } from "node:url";
import { CodeHarness, defaultPersistDir, transformCode } from "./harness.js";

// The fresh process imports the built harness (`npm test` builds first).
const harnessModuleUrl = pathToFileURL(
    join(process.cwd(), "dist", "run", "harness.js"),
).href;

function tempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), "discord-mcp-kept-"));
    onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
    return dir;
}

// Runs code in a brand-new Node process whose harness points at `dir`.
function runInFreshProcess(dir: string, code: string): { ok: boolean; text: string } {
    const script = `
        const { CodeHarness } = await import(${JSON.stringify(harnessModuleUrl)});
        const harness = new CodeHarness({ persistDir: ${JSON.stringify(dir)} });
        const result = await harness.run(${JSON.stringify(code)});
        process.stdout.write(JSON.stringify({ ok: result.ok, text: result.text }));
    `;
    const stdout = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
        cwd: process.cwd(),
        encoding: "utf8",
    });
    return JSON.parse(stdout) as { ok: boolean; text: string };
}

test("empty code returns the manual", async () => {
    const harness = new CodeHarness({
        persistDir: tempDir(),
        manual: () => "the manual",
    });
    const result = await harness.run("   ");
    expect(result.ok).toBe(true);
    expect(result.text).toBe("the manual");
});

test("returns printed output plus the last expression value", async () => {
    const harness = new CodeHarness({ persistDir: tempDir() });
    const result = await harness.run(
        "const n = await Promise.resolve(20); print('half', n / 2); n + 1",
    );
    expect(result.ok).toBe(true);
    expect(result.value).toBe(21);
    expect(result.text).toBe("half 10\n21");
});

test("a helper defined in one call is reusable in the next", async () => {
    const harness = new CodeHarness({ persistDir: tempDir() });
    const defined = await harness.run(
        "function double(x) { return x * 2 }\nconst offset = 1;\nlet scratch = 5;",
    );
    expect(defined.ok).toBe(true);

    const reused = await harness.run("double(scratch) + offset");
    expect(reused.ok).toBe(true);
    expect(reused.value).toBe(11);
});

test("helpers can be redefined, and work is never persisted", async () => {
    const dir = tempDir();
    const harness = new CodeHarness({ persistDir: dir });
    await harness.run("const greet = (name) => `hi ${name}`;");
    await harness.run("const greet = (name) => `hello ${name}`;");
    expect((await harness.run("greet('ada')")).value).toBe("hello ada");

    await harness.run(
        "const rolled = Math.random(); let counter = 1; var legacy = 2; print('side effect');",
    );
    expect(readdirSync(dir).sort()).toEqual(["greet.js"]);

    // Rebinding a kept name to work drops the stale saved definition.
    await harness.run("const greet = Math.random();");
    expect(readdirSync(dir)).toEqual([]);
});

test("definitions survive a restart in a fresh process; forget removes them", async () => {
    const dir = tempDir();
    const harness = new CodeHarness({ persistDir: dir });
    const defined = await harness.run(
        [
            "function area(w, h) { return w * h }",
            "class Counter { constructor() { this.n = 0 } inc() { return ++this.n } }",
            "const UNITS = { metric: 'm', imperial: 'ft' };",
        ].join("\n"),
    );
    expect(defined.kept).toEqual(["area", "Counter", "UNITS"]);

    const reloaded = runInFreshProcess(
        dir,
        "const c = new Counter(); c.inc(); `${area(3, 4)}${UNITS.metric}:${c.inc()}`",
    );
    expect(reloaded).toEqual({ ok: true, text: "12m:2" });

    expect((await harness.run("forget('area')")).value).toBe(true);
    expect((await harness.run("typeof area")).value).toBe("undefined");

    const afterForget = runInFreshProcess(dir, "[typeof area, typeof Counter]");
    expect(afterForget.text).toBe("[ 'undefined', 'function' ]");
});

test("a broken saved definition does not stop the others from loading", async () => {
    const dir = tempDir();
    writeFileSync(join(dir, "broken.js"), "function broken( {\n");
    writeFileSync(join(dir, "fine.js"), "function fine() { return 'ok' }\n");

    const failures: string[] = [];
    const harness = new CodeHarness({
        persistDir: dir,
        onLoadError: (name) => failures.push(name),
    });

    expect(failures).toEqual(["broken"]);
    expect((await harness.run("fine()")).value).toBe("ok");
    const kept = harness.kept() as Array<{ name: string; loaded: boolean }>;
    expect(kept.map((entry) => [entry.name, entry.loaded])).toEqual([
            ["broken", false],
            ["fine", true],
        ]);
});

test("errors are reported without breaking the namespace", async () => {
    const harness = new CodeHarness({ persistDir: tempDir() });
    await harness.run("const keep = 1;");

    const thrown = await harness.run("print('before'); throw new Error('boom')");
    expect(thrown.ok).toBe(false);
    expect(thrown.text).toMatch(/before\nError: boom/);

    const syntax = await harness.run("this is not js(");
    expect(syntax.ok).toBe(false);
    expect(syntax.text).toMatch(/SyntaxError/);

    const clash = await harness.run("function describe() {}");
    expect(clash.ok).toBe(false);
    expect(clash.text).toMatch(/built-in/);

    expect((await harness.run("keep")).value).toBe(1);
});

test("vars passes named strings into the call", async () => {
    const harness = new CodeHarness({ persistDir: tempDir() });
    const payload = "line one\n`quoted` ${not interpolated}";
    const result = await harness.run("vars.body.length", { vars: { body: payload } });
    expect(result.value).toBe(payload.length);
    expect((await harness.run("Object.keys(vars).length")).value).toBe(0);
});

test("describe reports signatures, docs and members", async () => {
    const harness = new CodeHarness({
        persistDir: tempDir(),
        describe: {
            memberDoc: (owner, member) =>
                owner === "Shape" && member === "grow" ? "Grows the shape." : undefined,
            capabilities: (value) =>
                (value as { kind?: string }).kind === "shape" ? { live: true } : undefined,
        },
    });
    await harness.run(
        [
            "function scale(factor, by = 2) {",
            "    // Scales a value.",
            "    return factor * by",
            "}",
            "class Shape { constructor(size) { this.kind = 'shape'; this.size = size } grow(by) { this.size += by } get double() { return this.size * 2 } }",
        ].join("\n"),
    );

    expect((await harness.run("describe(scale)")).value).toEqual({
        type: "function",
        signature: "scale(factor, by = 2)",
        doc: "Scales a value.",
    });

    const shape = (await harness.run("describe(new Shape(1))")).value as {
        capabilities: unknown;
        members: Array<Record<string, unknown>>;
    };
    expect(shape.capabilities).toEqual({ live: true });
    expect(shape.members.map((member) => [member.name, member.kind, member.signature, member.doc])).toEqual([
            ["kind", "property", undefined, undefined],
            ["size", "property", undefined, undefined],
            ["grow", "method", "grow(by)", "Grows the shape."],
            ["double", "getter", undefined, undefined],
        ]);
});

test("transformCode only keeps pure top-level definitions", () => {
    const { declared, definitions } = transformCode(
        [
            "const A = 1, B = [A];",
            "const C = { f() {} };",
            "const { d } = { d: 1 };",
            "async function e() {}",
            "if (true) { function nested() {} }",
        ].join("\n"),
    );
    expect(declared).toEqual(["A", "B", "C", "d", "e"]);
    expect(definitions.map((definition) => [definition.name, definition.kind])).toEqual([
            ["A", "const"],
            ["C", "const"],
            ["e", "function"],
        ]);
});

test("the default persist location honours DISCORD_MCP_KEPT_DIR", () => {
    const previous = process.env.DISCORD_MCP_KEPT_DIR;
    process.env.DISCORD_MCP_KEPT_DIR = "/tmp/somewhere/kept";
    try {
        expect(defaultPersistDir()).toBe("/tmp/somewhere/kept");
    } finally {
        if (previous === undefined) {
            delete process.env.DISCORD_MCP_KEPT_DIR;
        } else {
            process.env.DISCORD_MCP_KEPT_DIR = previous;
        }
    }
});
