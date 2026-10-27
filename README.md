# Discord MCP Server

> **⚠️ Security Notice**: The single tool this server exposes **runs arbitrary JavaScript with the server's full authority** — every Discord token it holds, the network, the filesystem and the process. That is the design, not a mode: there is no switch that turns it off. **Run the server sandboxed** (a container, VM or jail with only the access you intend to grant), and treat its tokens as exposed to whatever drives the tool.

Discord MCP Server exposes Discord to a model through **one tool that runs code**. The model discovers the live discord.js API, writes its own helpers, and reuses and refines them across calls and restarts — instead of choosing from a fixed menu of verbs.

## Why one code tool

A fixed catalog of typed tools is the wrong interface: every bot, permission set and library version supports a different subset of Discord, and different models have different strengths with different tools. So the server does not hand-pick verbs. It exposes `run`, gives the code a live API, and lets each deployment's model accrete the tooling it needs.

## The `run` tool

`run` is the only advertised tool. Arguments:

- `code` (string, required) — JavaScript to run. An empty string returns the manual.
- `identity` (string, optional) — identity id to bind as `client` before the code runs (for example `default-bot`).
- `vars` (object of strings, optional) — named strings available as `vars.<name>`; use them for long text or payloads instead of escaping them in `code`.

The code runs in **one long-lived namespace**. Top-level `await` works; the result is whatever the code printed plus the value of its last expression.

```js
// call 1 — build a helper
async function channelByName(guildId, name) {
  const guild = await client.guilds.fetch(guildId);
  return (await guild.channels.fetch()).find((c) => c.name === name);
}

// call 2 — use it (vars.body was passed in the tool's `vars` argument)
const ch = await channelByName("123456789012345678", "general");
await ch.send(vars.body);
```

### What the namespace provides

| Name | What it is |
| --- | --- |
| `client` | The bound discord.js `Client`; drive its full API directly |
| `identities()`, `connect(id, { mode, token })`, `bind(id)` | List, create and bind identities (the working objects) |
| `identity` | `{ id, mode }` of the bound identity |
| `packages()`, `symbols(query)`, `pkg(alias)`, `discord` | What the project offers: loaded Discord runtime packages, their symbols, their exports, the discord.js module |
| `describe(x)` | Live capabilities (for a client: readiness, user, intents, guilds) plus every member's signature and one-line doc, taken from discord.js's own JSDoc |
| `ops.packages / symbols / preflight / refresh / invoke / batch(params)` | The earlier structured operations, now plain functions |
| `vars`, `print`, `console`, `fetch`, `require`, `sleep`, `man()` | I/O and utilities |
| `kept()`, `kept(name)`, `forget(name)` | Saved definitions |

### Definitions persist across restarts

After each successful call, each top-level **definition** — a `function` or `class` declaration, or a `const` bound to a literal, function or class — is saved as its own file and loaded back when the server starts. Each saved unit loads in isolation, so a broken one is reported by `kept()` and never stops the server. Statements that do work (calls, `let`, `const x = await …`) are never saved or replayed. `forget(name)` deletes a definition.

Saved definitions live in `DISCORD_MCP_KEPT_DIR`, defaulting to `$XDG_CONFIG_HOME/discord-mcp/kept` (`~/.config/discord-mcp/kept`). Mount it as a volume to keep the model's tooling across container restarts.

### Runtime

- **HTTP runtime**: Hono (`@hono/node-server`)
- The server starts without a Discord token; the model can log in later with `connect(...)` / `bind(...)`.

## Branch Model

- Canonical branch: `new-architecture-main`
- Repository default branch: `new-architecture-main`

## Quick Start

### Prerequisites

- Node.js 18+
- npm
- Discord bot token

### Install

```bash
git clone https://github.com/drvova/discord-mcp.git
cd discord-mcp
npm install
npm run build
```

### Run

```bash
# stdio mode (default)
npm start

# dev mode
npm run dev

# HTTP/SSE mode
npm run web
```

## Configuration

Create `.env`:

```env
DISCORD_TOKEN=your_bot_token_here
DISCORD_GUILD_ID=your_guild_id_here

# Optional user-mode token
# DISCORD_USER_TOKEN=your_discord_user_token

# Optional encrypted identity store
# DISCORD_MCP_MASTER_KEY=your_32_byte_key_material
# DISCORD_MCP_IDENTITY_STORE_PATH=./.discord-mcp-identities.enc

# Optional: where the run tool saves the model's definitions
# DISCORD_MCP_KEPT_DIR=~/.config/discord-mcp/kept

# Optional risk policy override (ops.* functions only)
# DISCORD_MCP_BLOCK_HIGH_RISK=true

# Optional audit log file
# DISCORD_MCP_AUDIT_LOG_PATH=./data/discord-mcp-audit.log

# Optional logging
# LOG_LEVEL=INFO
# LOG_STYLE=pretty
# LOG_COLOR=true
# ENABLE_LOGGING=true

# Optional OpenTelemetry
# OTEL_ENABLED=true
# OTEL_SERVICE_NAME=discord-mcp
# OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=http://localhost:4318/v1/traces
# OTEL_EXPORTER_OTLP_HEADERS=authorization=Bearer token
# OTEL_PROMETHEUS_PORT=9464
# OTEL_PROMETHEUS_ENDPOINT=/metrics

# Optional OAuth (HTTP mode)
# DISCORD_CLIENT_ID=...
# DISCORD_CLIENT_SECRET=...
# DISCORD_OAUTH_REDIRECT_URI=http://localhost:1455/oauth/discord/callback
```

## HTTP Endpoints

When `MCP_HTTP_PORT` (or `PORT`) is set:

- `GET /sse`
- `POST /message`
- `GET /health`
- `GET /oauth/discord/start`
- `GET /oauth/discord/callback`

## Logging

Server logs use a shared Pino logger with compact one-line output (no ISO timestamp clutter in pretty mode).

- `LOG_LEVEL` controls verbosity: `ERROR`, `WARN`, `INFO`, `DEBUG` (default `INFO`)
- `LOG_STYLE` controls output shape: `pretty` or `json` (when unset, auto mode uses `pretty` for interactive terminals and dev scripts, otherwise `json`)
- `LOG_COLOR` enables/disables ANSI colors (default `true`)
- `ENABLE_LOGGING` disables all logs when set to `false` (default `true`)

For stdio MCP mode, logs are written to stderr so protocol output on stdout remains clean.

### OpenTelemetry

- Traces are exported using OTLP HTTP (`OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`).
- Metrics are exposed via Prometheus exporter at `http://localhost:${OTEL_PROMETHEUS_PORT:-9464}${OTEL_PROMETHEUS_ENDPOINT:-/metrics}`.
- Service metadata is controlled by `OTEL_SERVICE_NAME`.

## Typed HTTP Client (`hc`)

You can use the generated typed client from Hono route types:

```ts
import { createHttpClient } from "./src/http-client.js";

const client = createHttpClient("http://localhost:1455");
const healthResponse = await client.health.$get();
const health = await healthResponse.json();

const rpcResponse = await client.index.$post({
  json: {
    id: 1,
    method: "tools/list"
  }
});
const rpc = await rpcResponse.json();
```

The MCP JSON-RPC contract on `POST /` (`initialize`, `tools/list`, `tools/call`) serves the same single `run` tool.

## Usage Examples

Each example is the `code` argument of one `run` call.

```js
// Discover what is available
describe(client)
```

```js
// Package and symbol catalog
(await symbols("TextChannel#send")).items.map((s) => s.name)
```

```js
// The earlier preflight/invoke pipeline, called as functions
await ops.preflight({
  packageAlias: "discordjs",
  symbol: "TextChannel#send",
  kind: "function",
  target: "channel",
  context: { channelId: "123456789012345678" },
})
```

```js
// Log in as another identity and keep working in the same namespace
await connect("ops-bot", { mode: "bot", token: vars.token });
client.user.tag
```

## Security Guidance

- `run` executes code with the server's full authority. Run the server sandboxed (container/VM/jail) with only the network, filesystem and tokens you intend the model to use.
- Keep tokens private and rotate regularly; give bots the minimum Discord permissions required.
- Every `run` call is written to the audit log; enable `DISCORD_MCP_AUDIT_LOG_PATH` in production.
- `DISCORD_MCP_BLOCK_HIGH_RISK`, `dryRun` and `allowWrite` apply to the `ops.*` functions only; code that uses `client` directly is bounded by the sandbox and the bot's Discord permissions.

## Scripts

- `npm run build` - compile TypeScript
- `npm run dev` (or `bun run dev`) - build once, then run `tsc -w` + `node --watch` with forced pretty logs
- `npm start` - run compiled stdio server
- `npm run web` - run compiled Hono HTTP/SSE server on port 1455

## Codex + GH CLI Notes

Use `gh` to track upstream Codex MCP interface updates and keep this server aligned:

- `gh api repos/openai/codex`
- `gh api repos/openai/codex/contents/codex-rs/docs/codex_mcp_interface.md`
- `gh api "search/code?q=repo:openai/codex+mcp_tool_call.rs"`
