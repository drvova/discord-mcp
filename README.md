# Discord MCP Server

> **⚠️ Security Notice**: This project handles Discord credentials and privileged Discord operations. Treat all tokens and secrets as sensitive.

Discord MCP Server exposes Discord.js through one MCP tool with a dynamic symbol router.

## Current Architecture

This repository now uses the **dynamic Discord.js routing architecture**:

- **MCP tool**: `discord_manage`
- **HTTP runtime**: Hono (`@hono/node-server`)
- **Web UI**: Svelte app served by the same Hono process under `/app`
- **Discovery operation**:
  - `discordjs.meta.symbols` (method: `automation.read`)
- **Invocation operation format**:
  - `discordjs.<kind>.<symbol>` (method: `automation.write`)
  - Example: `discordjs.function.TextChannel%23send`

### Domain Method Contract

`discord_manage` uses the contract below:

- `mode`: `bot` or `user`
- `identityId`: identity record (for example `default-bot`)
- `method`: one of
  - `server.read`, `server.write`, `channels.read`, `channels.write`,
  - `messages.read`, `messages.write`, `members.read`, `members.write`,
  - `roles.read`, `roles.write`, `automation.read`, `automation.write`
- `operation`: dynamic operation key (`discordjs.meta.symbols` or `discordjs.<kind>.<symbol>`)
- `params` or `args`

- Discovery operation `discordjs.meta.symbols` is validated under `automation.read`.
- Invocation operations `discordjs.<kind>.<symbol>` are validated under `automation.write`.

Static operation keys (`get_discordjs_symbols`, `invoke_discordjs_symbol`) are removed and now return validation errors.

Runtime kind behavior:
- Dynamic `enum` symbols are discovered directly from Discord.js runtime exports.
- `interface`, `type`, `namespace`, and `external` remain accepted for compatibility, but may return empty results in runtime-only discovery mode.

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
npm --prefix web install
npm run ui:build
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

# Full web stack (build Svelte + backend, then run HTTP mode)
npm run web:full
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

# Optional OAuth (HTTP mode)
# DISCORD_CLIENT_ID=...
# DISCORD_CLIENT_SECRET=...
# DISCORD_OAUTH_REDIRECT_URI=http://localhost:3001/oauth/discord/callback

# Optional web UI + OIDC bridge
# DISCORD_WEB_UI_MOUNT_PATH=/app
# DISCORD_WEB_UI_DIST_PATH=./web/build
# DISCORD_WEB_UI_STORE_PATH=./data/web-ui-state.json
# DISCORD_WEB_UI_SESSION_COOKIE_NAME=discord_mcp_web_session
# DISCORD_WEB_UI_SESSION_TTL_SECONDS=604800
# DISCORD_WEB_ALLOW_DEV_AUTH=true
# DISCORD_WEB_OIDC_ISSUER=https://issuer.example.com
# DISCORD_WEB_OIDC_CLIENT_ID=...
# DISCORD_WEB_OIDC_CLIENT_SECRET=...
# DISCORD_WEB_OIDC_REDIRECT_URI=http://localhost:3001/auth/codex/callback
# DISCORD_WEB_OIDC_SCOPES=openid profile email
# DISCORD_WEB_OIDC_PKCE_REQUIRED=true
# DISCORD_WEB_PLANNER_API_KEY=...
# DISCORD_WEB_PLANNER_BASE_URL=https://api.openai.com/v1
# DISCORD_WEB_PLANNER_MODEL=gpt-4o-mini
```

## HTTP Endpoints

When `MCP_HTTP_PORT` (or `PORT`) is set:

- `GET /sse`
- `POST /message`
- `GET /health`
- `GET /oauth/discord/start`
- `GET /oauth/discord/callback`
- `GET /auth/codex/start` (primary Codex-style login entrypoint)
- `GET /auth/codex/callback` (primary callback)
- `GET /auth/oidc/start` (alias)
- `GET /auth/oidc/callback` (alias)
- `GET /api/session`
- `POST /api/session/logout`
- `POST /api/session/identity`
- `GET /api/chat/threads`
- `POST /api/chat/threads`
- `GET /api/chat/threads/:threadId/messages`
- `POST /api/chat/plan`
- `POST /api/chat/execute`
- `GET /app/` (SvelteKit web UI when `web/build` exists)

## Web UI Runtime (Single Server)

Use one command to build UI + backend and run Hono on `:3001`:

```bash
npm run web:dev
```

This flow:

- Builds the SvelteKit app into `web/build`
- Compiles backend TypeScript
- Runs a single Hono server on `http://localhost:3001`
- Serves UI directly at `http://localhost:3001/app/` (no Vite proxy required)

Missing Discord OAuth callback env vars (`DISCORD_CLIENT_SECRET`,
`DISCORD_OAUTH_REDIRECT_URI`) no longer block HTTP startup; only the
`/oauth/discord/*` callback exchange remains unavailable until configured.

## Typed HTTP Client (`hc`)

You can use the generated typed client from Hono route types:

```ts
import { createHttpClient } from "./src/http-client.js";

const client = createHttpClient("http://localhost:3001");
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

## Web UI Flow

- The UI is served by Hono at `/app/`.
- Login starts at `/auth/codex/start` and returns via `/auth/codex/callback` (OIDC aliases are also supported).
- When OIDC is not configured and `DISCORD_WEB_ALLOW_DEV_AUTH=true` (default outside production), `/auth/codex/start` creates a local dev session automatically.
- Session state is cookie-based and persisted in `DISCORD_WEB_UI_STORE_PATH`.
- Chat planning uses dynamic operation generation and defaults write operations to `dryRun: true`.
- Live writes require explicit confirmation in the UI (`confirmWrites: true`).

## Usage Examples

### 1) Discover Symbols

```json
{
  "mode": "bot",
  "identityId": "default-bot",
  "method": "automation.read",
  "operation": "discordjs.meta.symbols",
  "params": {
    "kinds": ["function"],
    "query": "TextChannel#send",
    "page": 1,
    "pageSize": 20,
    "includeKindCounts": true
  }
}
```

### 2) Dynamic Invocation (`TextChannel#send`)

```json
{
  "mode": "bot",
  "identityId": "default-bot",
  "method": "automation.write",
  "operation": "discordjs.function.TextChannel%23send",
  "params": {
    "args": ["hello from dynamic router"],
    "target": "channel",
    "context": {
      "guildId": "123456789012345678",
      "channelId": "123456789012345678"
    },
    "allowWrite": true,
    "policyMode": "strict"
  }
}
```

### 3) Dry Run Before Executing

```json
{
  "mode": "bot",
  "identityId": "default-bot",
  "method": "automation.write",
  "operation": "discordjs.function.TextChannel%23send",
  "params": {
    "dryRun": true,
    "target": "channel",
    "context": {
      "channelId": "123456789012345678"
    }
  }
}
```

## Notes on Operation Counts

If you expect thousands of operations in the MCP registry, this is by design:

- The MCP registry exposes a small, fixed operation surface.
- Discovery is exposed through `discordjs.meta.symbols`.
- Discord.js breadth is exposed through dynamic symbol routing (`discordjs.<kind>.<symbol>`).
- Runtime discovery includes `enum` exports (for example `ChannelType`, `ActivityType`).

## Security Guidance

- Keep tokens private and rotate regularly.
- Use minimum Discord permissions required.
- Prefer `dryRun` for risky operations.
- Use `allowWrite` only when intended.
- Enable audit logging in production.

## Scripts

- `npm run build` - compile TypeScript
- `npm run dev` - build once, then run `tsc -w` + `node --watch`
- `npm start` - run compiled stdio server
- `npm run web` - run compiled Hono HTTP/SSE server on port 3001
- `npm run web:build` - build then run HTTP/SSE
- `npm run ui:build` - build SvelteKit web UI into `web/build`
- `npm run web:full` - build UI + backend and run HTTP server
