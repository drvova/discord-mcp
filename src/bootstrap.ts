#!/usr/bin/env node
import "dotenv/config";

// `discord-mcp <command>` runs the agent/identity/known-hosts commands (see
// cli/cli.ts); `discord-mcp` alone starts the MCP server. The command list
// lives here so the server path still loads telemetry before anything else.
const CLI_COMMANDS = new Set(["agent", "identity", "known-hosts", "help", "--help", "-h"]);
const command = process.argv[2];

if (command && CLI_COMMANDS.has(command)) {
    const { runCli } = await import("./cli/cli.js");
    process.exitCode = await runCli(process.argv.slice(2));
} else {
    const { initializeTelemetry } = await import("./observability/telemetry.js");
    await initializeTelemetry();
    await import("./index.js");
}
