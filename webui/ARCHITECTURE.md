# Web UI Architecture

## Overview

The Discord MCP Web UI is a standalone web application that provides an AI-powered interface for managing Discord servers through natural language commands.

## Technology Stack

- **Frontend**: Pure HTML/CSS/JavaScript (no framework dependencies)
- **Backend**: Express.js (Node.js)
- **AI Engine**: Groq SDK with LLaMA 3.3 70B model
- **Discord Integration**: Discord MCP Server core modules
- **Type Safety**: TypeScript

## Directory Structure

```
webui/
├── src/
│   └── web-server.ts          # Express server with Groq integration
├── public/
│   └── index.html             # Single-page web application
├── README.md                  # Full documentation
├── QUICKSTART.md              # Quick start guide
└── ARCHITECTURE.md            # This file
```

## Component Architecture

### 1. Web Server (`src/web-server.ts`)

**Responsibilities:**
- HTTP server setup and routing
- Groq AI client initialization
- Discord service integration
- API endpoint handling
- Static file serving

**Key Components:**
- Express app configuration
- DiscordController initialization
- Groq client setup
- Tool definitions and execution
- Chat conversation handling

**Endpoints:**
- `GET /` - Serves the web UI
- `POST /api/chat` - AI chat endpoint
- `GET /api/health` - Service health check

### 2. Web Interface (`public/index.html`)

**Architecture:**
- Single-page application (SPA)
- No external dependencies
- Real-time UI updates
- Responsive design

**Key Features:**
- Chat interface with message history
- Loading states and animations
- Status indicators for services
- Example command cards
- Error handling and display

### 3. Discord Integration

**Flow:**
```
Web UI → Express API → Groq AI → Discord Tools → Discord API
            ↓             ↓           ↓
        Static Files  Tool Defs   Tool Exec
```

**Integration Points:**
- Imports `DiscordController` from main project
- Accesses `DiscordService` methods
- Maps Groq tool calls to Discord operations

## Data Flow

### Chat Request Flow

1. **User Input**
   - User types message in web interface
   - Frontend sends POST to `/api/chat`

2. **AI Processing**
   - Server forwards to Groq API
   - Groq analyzes intent
   - Returns tool calls if needed

3. **Tool Execution**
   - Server executes Discord tools
   - Collects results
   - Sends back to Groq for formatting

4. **Response**
   - Groq formats user-friendly response
   - Server returns to frontend
   - UI displays message and results

### Example Flow

```
User: "List all channels"
  ↓
Frontend POST /api/chat
  ↓
Groq AI: Analyze intent → discord_list_channels
  ↓
Execute: discordService.listChannels(guildId)
  ↓
Results → Groq: Format response
  ↓
"Here are your channels: #general, #announcements..."
  ↓
Display in UI
```

## AI Tool System

### Tool Definition Format

```typescript
{
    type: "function",
    function: {
        name: "discord_tool_name",
        description: "What the tool does",
        parameters: {
            type: "object",
            properties: { /* params */ },
            required: ["param1"]
        }
    }
}
```

### Available Tools

1. **discord_send_message** - Send messages to channels
2. **discord_list_channels** - List all channels
3. **discord_get_server_info** - Get server information
4. **discord_create_text_channel** - Create new channels
5. **discord_read_messages** - Read message history

### Adding New Tools

To add a new Discord tool:

1. Add tool definition in `getAvailableTools()`
2. Add execution case in `executeDiscordTool()`
3. Ensure Discord service method exists
4. Test with natural language commands

## Configuration

### Environment Variables

```env
DISCORD_TOKEN=xxx           # Required: Discord bot token
DISCORD_GUILD_ID=xxx        # Required: Default guild ID
GROQ_API_KEY=xxx           # Required: Groq API key
WEB_PORT=3000              # Optional: Web server port
```

### Build Configuration

- TypeScript compiles to `dist/webui/src/`
- Public assets served from `webui/public/`
- Source maps enabled for debugging
- ES2022 module system

## Security Considerations

### Current Implementation

- CORS enabled for all origins (development)
- API keys kept server-side only
- No authentication system
- Discord operations validated by bot permissions

### Production Recommendations

1. **CORS**: Restrict to specific origins
2. **Rate Limiting**: Add per-IP rate limits
3. **Authentication**: Add user authentication
4. **Input Validation**: Validate all user inputs
5. **API Key Rotation**: Regular key rotation
6. **HTTPS**: Use SSL/TLS in production
7. **CSP Headers**: Content Security Policy

## Performance

### Optimization Strategies

1. **Caching**
   - Keep conversation history (last 20 messages)
   - Cache Discord server data temporarily

2. **Async Operations**
   - Non-blocking Discord API calls
   - Parallel tool execution where possible

3. **Response Time**
   - Groq: ~500-1000ms
   - Discord API: ~200-500ms
   - Total: 1-3 seconds typical

### Scalability

**Current Limits:**
- Single-server deployment
- In-memory conversation storage
- Stateless HTTP requests

**Future Enhancements:**
- Redis for shared state
- Load balancing support
- WebSocket for real-time updates
- Database for persistent history

## Error Handling

### Error Types

1. **Configuration Errors**
   - Missing API keys
   - Invalid environment variables

2. **Discord Errors**
   - Permission denied
   - Invalid IDs
   - Rate limiting

3. **AI Errors**
   - Groq API failures
   - Token limits
   - Timeout issues

4. **Network Errors**
   - Connection failures
   - Request timeouts

### Error Responses

```typescript
{
    error: "Error message",
    details: "Additional context"
}
```

## Development Workflow

### Local Development

```bash
# Start dev server with hot reload
npm run web

# The server watches for file changes
# Edit files and save to see changes
```

### Production Build

```bash
# Compile TypeScript
npm run build

# Start production server
npm run web:build
```

### Testing

Currently no automated tests. Manual testing workflow:

1. Start server: `npm run web`
2. Open browser: `http://localhost:3000`
3. Test commands:
   - List channels
   - Send message
   - Get server info
   - Create channel
4. Verify responses and errors

## Future Architecture Plans

### Phase 1: Enhanced Features
- [ ] More Discord tools (roles, members, voice)
- [ ] File upload support
- [ ] Rich embeds and buttons
- [ ] Auto-complete for channel/role IDs

### Phase 2: Persistence
- [ ] User accounts and authentication
- [ ] Persistent conversation history
- [ ] Saved commands and templates
- [ ] Multi-server support

### Phase 3: Real-time
- [ ] WebSocket integration
- [ ] Live Discord event updates
- [ ] Real-time message streaming
- [ ] Notification system

### Phase 4: Advanced AI
- [ ] Multi-step workflows
- [ ] Custom AI agents per server
- [ ] Learning from user preferences
- [ ] Automated moderation suggestions

## Integration with Main Project

### Dependency Management

The web UI depends on:
- `DiscordController` from `src/core/`
- `DiscordService` from `src/`
- Shared types from `src/types.ts`

### Build System

- Shares TypeScript configuration
- Compiles alongside main project
- Maintains separate output directory
- Independent deployment possible

### Version Compatibility

Web UI is versioned with main project:
- Breaking changes: Major version bump
- New features: Minor version bump
- Bug fixes: Patch version bump

## Troubleshooting

### Common Issues

**"Groq AI: Offline"**
- Check `GROQ_API_KEY` environment variable
- Verify API key is valid
- Check Groq service status

**"Discord: Offline"**
- Verify `DISCORD_TOKEN` is correct
- Check bot is in the server
- Verify bot permissions

**"Port in use"**
- Change `WEB_PORT` in environment
- Kill existing process on port 3000

**Build Errors**
- Run `npm install` to update dependencies
- Clear dist folder and rebuild
- Check TypeScript errors

## Contributing

When contributing to the web UI:

1. Follow existing code style
2. Update documentation
3. Test all features
4. Consider security implications
5. Maintain backward compatibility

## License

MIT License - Same as main Discord MCP project
