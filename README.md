# Discord MCP Server

> **⚠️ Security Notice**: This project handles Discord credentials and privileged Discord operations. Treat all tokens and secrets as sensitive.

Discord MCP Server exposes Discord.js through one MCP tool with a dynamic symbol router.

## Current Architecture

This repository now uses the **dynamic Discord.js routing architecture**:

- **MCP tool**: `discord_manage`
- **Static operations**:
  - `get_discordjs_symbols`
  - `invoke_discordjs_symbol`
- **Dynamic operation format**:
  - `discordjs.<kind>.<symbol>`
  - Example: `discordjs.function.TextChannel%23send`

### Domain Method Contract

`discord_manage` uses the contract below:

- `mode`: `bot` or `user`
- `identityId`: identity record (for example `default-bot`)
- `method`: one of
  - `server.read`, `server.write`, `channels.read`, `channels.write`,
  - `messages.read`, `messages.write`, `members.read`, `members.write`,
  - `roles.read`, `roles.write`, `automation.read`, `automation.write`
- `operation`: static op or dynamic `discordjs.<kind>.<symbol>`
- `params` or `args`

Dynamic `discordjs.*` operations are validated under `automation.write`.

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

# Optional OAuth (HTTP mode)
# DISCORD_CLIENT_ID=...
# DISCORD_CLIENT_SECRET=...
# DISCORD_OAUTH_REDIRECT_URI=http://localhost:3001/oauth/discord/callback
```

## HTTP Endpoints

When `MCP_HTTP_PORT` (or `PORT`) is set:

- `GET /sse`
- `POST /message`
- `GET /health`
- `GET /oauth/discord/start`
- `GET /oauth/discord/callback`

## Usage Examples

### 1) Discover Symbols

```json
{
  "mode": "bot",
  "identityId": "default-bot",
  "method": "automation.read",
  "operation": "get_discordjs_symbols",
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

- The MCP registry exposes **few static operations**.
- Discord.js breadth is exposed through **dynamic symbol routing** (`discordjs.<kind>.<symbol>`).
- Use `get_discordjs_symbols` to discover available symbols and operation keys.
- Runtime discovery includes `enum` exports (for example `ChannelType`, `ActivityType`).

## Security Guidance

- Keep tokens private and rotate regularly.
- Use minimum Discord permissions required.
- Prefer `dryRun` for risky operations.
- Use `allowWrite` only when intended.
- Enable audit logging in production.

## Scripts

- `npm run build` - compile TypeScript
- `npm run dev` - run via `tsx`
- `npm start` - run compiled stdio server
- `npm run web` - run HTTP/SSE server
- `npm run web:build` - build then run HTTP/SSE
