# Discord MCP Server

> **⚠️ SECURITY WARNING**: This project handles Discord bot tokens and server access. Please read our [Security Policy](SECURITY.md) before using or contributing.

A comprehensive Model Context Protocol (MCP) server for Discord API integration, providing powerful Discord bot management capabilities through a standardized interface.

## Features

This server provides **93 Discord tools** organized into the following categories:

| Category | Tools Count | Description |
|----------|-------------|-------------|
| Message Management | 18 tools | Send, edit, delete, reactions, pin, bulk operations |
| Channel Management | 25 tools | Create/edit/delete all channel types, positions, privacy |
| Member & Role Management | 12 tools | Add/remove roles, edit members, search, info retrieval |
| Voice & Audio | 6 tools | Join/leave voice, play audio, volume control |
| Webhooks | 4 tools | Create, delete, list, send webhook messages |
| Events & Scheduling | 4 tools | Create, edit, delete, list server events |
| Emoji & Stickers | 6 tools | Manage custom emojis and stickers |
| Privacy & Security | 7 tools | Auto-moderation, privacy controls, bulk settings |
| Server Administration | 6 tools | Server settings, welcome screen, widget management |
| Analytics & Export | 5 tools | Statistics, message history, chat log export |

### Key Tools

- **`discord_manage`** - Unified tool that handles all 93 operations through one interface
- **`comprehensive_channel_management`** - Multi-operation channel orchestrator
- **`bulk_set_privacy`** - Mass privacy control across channels/categories
- **`organize_channels`** - Advanced channel/category positioning system
- **`export_chat_log`** - Professional chat export in JSON/CSV/TXT formats

## Quick Start

### Prerequisites

- Node.js 18+ and npm
- Discord bot token (see setup below)

### Installation

```bash
# Clone the repository
git clone https://github.com/sashathelambo/discord-mcp.git
cd discord-mcp

# Install dependencies
npm install

# Build the project
npm run build

# Start the server
npm start
```

### Development Mode

```bash
npm run dev
```

## Configuration

### Discord Bot Setup

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Create a new application and bot
3. Copy the bot token to your `.env` file
4. **IMPORTANT**: Regenerate your token if you suspect it's been exposed

### Environment Variables

Create a `.env` file:

```env
# Your Discord bot token (KEEP SECRET!)
DISCORD_TOKEN=your_bot_token_here

# Default Discord server ID (optional)
DISCORD_GUILD_ID=your_guild_id_here
```

### Required Bot Permissions

```
Manage Server
Manage Roles  
Manage Channels
Manage Messages
View Channels
Send Messages
Connect (for voice)
Speak (for voice)
```

## Usage

### HTTP Mode (Optional)

Run the MCP server over HTTP/SSE (useful for `mcp-remote` and browser-based MCP clients):

```bash
# Start HTTP transport on port 3001
npm run web
```

### MCP Integration

Use with MCP-compatible clients:

```bash
# Via stdio
npx discord-mcp

# Via HTTP (port 3001)
MCP_HTTP_PORT=3001 npx discord-mcp
```

### Examples

#### Using the Master Control Tool

```typescript
// All operations through one unified interface
await discord_manage({
  action: 'send_message',
  channelId: '123',
  message: 'Hello World!'
});

await discord_manage({
  action: 'create_text_channel',
  guildId: '456',
  name: 'new-channel'
});

await discord_manage({
  action: 'comprehensive_channel_management',
  guildId: '456',
  operations: [
    { action: 'create_category', name: 'New Category' },
    { action: 'create_text_channel', name: 'general', categoryId: 'cat_id' },
    { action: 'set_channel_private', channelId: 'chan_id', isPrivate: true }
  ]
});
```

#### Using Individual Tools

```typescript
// Server information
await discord.getServerInfo(guildId);

// Advanced channel creation
await discord.createForumChannel(guildId, "discussions", categoryId, {
  topic: "Community discussions",
  slowmode: 30,
  isPrivate: true,
  allowedRoles: ["member_role_id"]
});

// Bulk privacy management
await discord.bulkSetPrivacy(guildId, {
  targets: [
    { id: "channel1", type: "channel", isPrivate: true },
    { id: "category1", type: "category", isPrivate: false }
  ]
});

// Export chat logs
await discord.exportChatLog(channelId, "JSON", {
  limit: 1000,
  dateRange: { start: "2024-01-01", end: "2024-12-31" }
});
```

## Security

### For Users

- Keep your Discord bot token secret
- Regularly rotate your tokens
- Monitor bot activity
- Use minimal required permissions

### For Contributors

- Never commit tokens or secrets
- Validate all user inputs
- Review dependencies for vulnerabilities
- Follow secure coding practices

## Tool Reference

<details>
<summary>Complete Tool List (93 Tools)</summary>

### Message Management Tools (18)

| Tool Name | Description |
|-----------|-------------|
| `send_message` | Send messages to channels |
| `edit_message` | Edit existing messages |
| `delete_message` | Delete specific messages |
| `read_messages` | Read message history from channels |
| `send_private_message` | Send DMs to users |
| `edit_private_message` | Edit private messages |
| `delete_private_message` | Delete private messages |
| `read_private_messages` | Read DM history |
| `add_reaction` | Add emoji reactions |
| `remove_reaction` | Remove emoji reactions |
| `pin_message` | Pin messages in channels |
| `unpin_message` | Unpin messages |
| `get_pinned_messages` | List pinned messages |
| `bulk_delete_messages` | Delete multiple messages |
| `crosspost_message` | Crosspost announcements |
| `get_message_history` | Advanced message history with pagination |
| `get_message_attachments` | Extract message attachments |
| `read_images` | Read and analyze images from messages |

### Channel Management Tools (25)

| Tool Name | Description |
|-----------|-------------|
| `create_text_channel` | Create text channels |
| `create_voice_channel` | Create voice channels |
| `create_forum_channel` | Create forum channels |
| `create_announcement_channel` | Create announcement channels |
| `create_stage_channel` | Create stage channels |
| `edit_channel_advanced` | Edit any channel with advanced settings |
| `delete_channel` | Delete channels |
| `find_channel` | Find channels by name |
| `list_channels` | List all server channels |
| `create_category` | Create channel categories |
| `delete_category` | Delete categories |
| `find_category` | Find categories by name |
| `list_channels_in_category` | List channels in specific category |
| `set_channel_position` | Move channel position |
| `set_channel_positions` | Move multiple channels |
| `set_category_position` | Move category position |
| `move_channel_to_category` | Move channels between categories |
| `organize_channels` | Comprehensive channel organization |
| `get_channel_structure` | Get complete channel hierarchy |
| `set_channel_private` | Set channel privacy settings |
| `set_category_private` | Set category privacy settings |
| `bulk_set_privacy` | Bulk privacy management |
| `comprehensive_channel_management` | All-in-one channel operations |
| `upload_file` | Upload files to channels |
| `export_chat_log` | Export chat logs (JSON/CSV/TXT) |

### Member & Role Management Tools (12)

| Tool Name | Description |
|-----------|-------------|
| `get_user_id_by_name` | Find user IDs by username |
| `get_members` | List server members with pagination |
| `search_members` | Search members by name |
| `edit_member` | Edit member properties |
| `get_member_info` | Get detailed member information |
| `create_role` | Create new server roles |
| `delete_role` | Delete server roles |
| `edit_role` | Modify role properties |
| `add_role_to_member` | Assign roles to members |
| `remove_role_from_member` | Remove roles from members |
| `get_roles` | List all server roles |
| `set_role_positions` | Reorder role hierarchy |

### Voice & Audio Tools (6)

| Tool Name | Description |
|-----------|-------------|
| `join_voice_channel` | Connect bot to voice channels |
| `leave_voice_channel` | Disconnect from voice channels |
| `play_audio` | Stream audio in voice channels |
| `stop_audio` | Stop audio playback |
| `set_volume` | Control audio volume |
| `get_voice_connections` | List active voice connections |

### Webhook Tools (4)

| Tool Name | Description |
|-----------|-------------|
| `create_webhook` | Create channel webhooks |
| `delete_webhook` | Delete webhooks |
| `list_webhooks` | List channel webhooks |
| `send_webhook_message` | Send messages via webhooks |

### Events & Scheduling Tools (4)

| Tool Name | Description |
|-----------|-------------|
| `create_event` | Create scheduled server events |
| `edit_event` | Edit existing events |
| `delete_event` | Delete server events |
| `get_events` | List all scheduled events |

### Emoji & Sticker Tools (6)

| Tool Name | Description |
|-----------|-------------|
| `create_emoji` | Create custom server emojis |
| `delete_emoji` | Delete custom emojis |
| `get_emojis` | List all server emojis |
| `create_sticker` | Create custom server stickers |
| `delete_sticker` | Delete custom stickers |
| `get_stickers` | List all server stickers |

### Privacy & Security Tools (7)

| Tool Name | Description |
|-----------|-------------|
| `create_automod_rule` | Create automoderation rules |
| `edit_automod_rule` | Edit automod rules |
| `delete_automod_rule` | Delete automod rules |
| `get_automod_rules` | List all automod rules |
| `create_invite` | Create server invites |
| `delete_invite` | Delete/revoke invites |
| `get_invites` | List all server invites |

### Server Administration Tools (6)

| Tool Name | Description |
|-----------|-------------|
| `get_server_info` | Get comprehensive server information |
| `edit_server` | Edit server settings |
| `get_server_widget` | Get server widget information |
| `get_welcome_screen` | Get welcome screen settings |
| `edit_welcome_screen` | Configure welcome screen |
| `get_server_stats` | Get comprehensive server statistics |

### Interactive Components Tools (4)

| Tool Name | Description |
|-----------|-------------|
| `send_embed` | Send rich embed messages |
| `send_button` | Send messages with interactive buttons |
| `send_select_menu` | Send messages with select menus |
| `send_modal` | Send modal dialogs (interaction context) |

### Master Control Tool (1)

| Tool Name | Description |
|-----------|-------------|
| `discord_manage` | Unified tool - access ALL 93 operations through one interface |

</details>

## Contributing

**Project Creator & Lead Developer**: [@sashathelambo](https://github.com/sashathelambo) (Dr. Vova)

This project is primarily developed and maintained by sashathelambo. For contributions:

1. Read our [Contributing Guidelines](CONTRIBUTING.md)
2. Follow our [Security Policy](SECURITY.md)
3. Use the PR template
4. Test thoroughly before submitting
5. Discuss major changes with [@sashathelambo](https://github.com/sashathelambo) first

### Development Guidelines

- Use TypeScript for all code
- Follow existing code style
- Add tests for new features
- Never commit sensitive data
- Update documentation

## Troubleshooting

### Common Issues

- **Token Invalid**: Regenerate your Discord bot token
- **Permission Denied**: Check bot permissions in Discord server
- **Build Errors**: Ensure Node.js 18+ and TypeScript are installed

### Getting Help

- Check our [documentation](docs/)
- [Report bugs](issues/new?template=bug_report.md)
- [Request features](issues/new?template=feature_request.md)
- Join our community discussions

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Disclaimer

This software is provided "as-is" without warranty. Users are responsible for:

- Complying with Discord's Terms of Service
- Securing their bot tokens and credentials  
- Using appropriate permissions and rate limiting
- Monitoring and maintaining their Discord bots

## Acknowledgments

- **[@sashathelambo](https://github.com/sashathelambo) (Dr. Vova)** - Project creator, lead developer, and architect of all 93 Discord tools
- Discord.js team for the excellent Discord API wrapper
- Model Context Protocol community for the standardized protocol
- Everyone who uses and supports this project
