# Discord MCP Server

> **⚠️ Security Notice**: This project handles Discord credentials and privileged Discord operations. Treat all tokens and secrets as sensitive.

Discord MCP Server exposes Discord runtime packages through one MCP tool with a unified metadata/execution protocol.

## Current Architecture

This repository now uses the **Discord runtime vNext protocol**:

- **MCP tool**: `discord_manage`
- **HTTP runtime**: Hono (`@hono/node-server`)
- **Read operations** (`automation.read`):
  - `discord.meta.packages`
  - `discord.meta.symbols`
  - `discord.meta.preflight`
- **Write operations** (`automation.write`):
  - `discord.exec.invoke`
  - `discord.exec.batch`

### Tool Contract

`discord_manage` uses the contract below:

- `mode`: `bot` or `user`
- `identityId`: identity record (for example `default-bot`)
- `method`: optional override (`automation.read` or `automation.write`)
- `operation`: one of
  - `discord.meta.packages`
  - `discord.meta.symbols`
  - `discord.meta.preflight`
  - `discord.exec.invoke`
  - `discord.exec.batch`
- `params` or `args`

Runtime symbol coverage:
- `class`, `function`, `enum`, `interface`, `type`, and `variable` are discovered.
- `interface`, `type`, `namespace`, and `variable` can be sourced from package declaration files (`.d.ts`) when missing at runtime.
- `discord.meta.symbols` can include an operational matrix per symbol for preflight/execution readiness.

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

# Optional risk policy override
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

The MCP JSON-RPC contract on `POST /` is unchanged (`initialize`, `tools/list`, `tools/call`).

## Usage Examples

### 1) List Runtime Packages

```json
{
  "mode": "bot",
  "identityId": "default-bot",
  "method": "automation.read",
  "operation": "discord.meta.packages",
  "params": {
    "packages": ["discordjs", "discordjs_voice"]
  }
}
```

### 2) Discover Symbols + Operational Matrix

```json
{
  "mode": "bot",
  "identityId": "default-bot",
  "method": "automation.read",
  "operation": "discord.meta.symbols",
  "params": {
    "packageAlias": "discordjs",
    "kinds": ["class", "function", "enum", "interface", "type", "variable"],
    "query": "TextChannel#send",
    "includeAliases": true,
    "includeKindCounts": true,
    "includeOperationalMatrix": true
  }
}
```

### 3) Preflight Before Execution

```json
{
  "mode": "bot",
  "identityId": "default-bot",
  "method": "automation.read",
  "operation": "discord.meta.preflight",
  "params": {
    "packageAlias": "discordjs",
    "symbol": "TextChannel#send",
    "kind": "function",
    "target": "channel",
    "context": {
      "channelId": "123456789012345678"
    },
    "policyMode": "strict",
    "strictContextCheck": true,
    "strictArgCheck": false
  }
}
```

### 4) Execute Invocation (Safe by Default)

```json
{
  "mode": "bot",
  "identityId": "default-bot",
  "method": "automation.write",
  "operation": "discord.exec.invoke",
  "params": {
    "packageAlias": "discordjs",
    "symbol": "TextChannel#send",
    "kind": "function",
    "args": ["hello from invoke"],
    "target": "channel",
    "context": {
      "channelId": "123456789012345678"
    },
    "dryRun": false,
    "requirePreflightPass": true,
    "allowWrite": true
  }
}
```

### 5) Batch Invocation

```json
{
  "mode": "bot",
  "identityId": "default-bot",
  "method": "automation.write",
  "operation": "discord.exec.batch",
  "params": {
    "mode": "best_effort",
    "haltOnPolicyBlock": false,
    "maxParallelism": 4,
    "dryRun": true,
    "items": [
      {
        "packageAlias": "discordjs",
        "symbol": "TextChannel#send",
        "kind": "function",
        "target": "channel",
        "context": {
          "channelId": "123456789012345678"
        },
        "args": ["hello from batch"]
      }
    ]
  }
}
```

## Legacy Dynamic Compatibility

Legacy operation strings are not supported. Use only vNext operations:

- `discord.meta.packages`
- `discord.meta.symbols`
- `discord.meta.preflight`
- `discord.exec.invoke`
- `discord.exec.batch`

## Notes on Operation Counts

If you expect thousands of discovered symbols, this is by design:

- The MCP registry exposes a small, fixed operation surface.
- Package discovery is exposed through `discord.meta.packages`.
- Symbol discovery is exposed through `discord.meta.symbols`.
- Execution preflight is exposed through `discord.meta.preflight`.
- Single and batch execution are exposed through `discord.exec.invoke` and `discord.exec.batch`.
- Runtime discovery includes `enum` exports (for example `ChannelType`, `ActivityType`).
- Startup logs print loaded package aliases and versions.

## Security Guidance

- Keep tokens private and rotate regularly.
- Use minimum Discord permissions required.
- Prefer `dryRun` for risky operations.
- Use `allowWrite` only when intended.
- Enable audit logging in production.

## Scripts

- `npm run build` - compile TypeScript
- `npm run dev` (or `bun run dev`) - build once, then run `tsc -w` + `node --watch` with forced pretty logs
- `npm start` - run compiled stdio server
- `npm run web` - run compiled Hono HTTP/SSE server on port 1455
