import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, onTestFinished, test } from "@rstest/core";

// In stdio mode stdout is the MCP protocol channel: nothing but JSON-RPC may
// appear on it. Runs the built server (npm test builds first) with a .env
// file present and info-level logs in both log styles.
for (const style of ["json", "pretty"]) {
    test(`the server writes no logs to stdout (${style} logs)`, () => {
        const dir = mkdtempSync(join(tmpdir(), "discord-mcp-stdout-"));
        onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
        writeFileSync(join(dir, ".env"), "DISCORD_GUILD_ID=1\n");

        const result = spawnSync(process.execPath, [join(process.cwd(), "dist", "bootstrap.js")], {
            cwd: dir,
            input: "",
            timeout: 6000,
            encoding: "utf8",
            env: {
                PATH: process.env.PATH,
                HOME: dir,
                LOG_LEVEL: "info",
                LOG_STYLE: style,
                DISCORD_MCP_KEPT_DIR: join(dir, "kept"),
                OTEL_PROMETHEUS_PORT: "0",
            },
        });

        expect(result.stdout).toBe("");
        expect(result.stderr).toMatch(/Direct mode/);
    });
}
