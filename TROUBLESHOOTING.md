# Discord MCP Server Troubleshooting Guide

## Upstream Connect Error 111 (Connection Refused)

This error typically occurs when the MCP server has networking or stdio transport issues. Here are the solutions:

### 1. Docker Environment Issues

The error "upstream connect error or disconnect/reset before headers. reset reason: remote connection failure, transport failure reason: delayed connect error: 111" usually indicates:

- **Signal handling problems**: The container doesn't properly handle SIGTERM/SIGINT signals
- **Stdio transport issues**: The MCP server's stdio transport isn't configured correctly
- **Network isolation**: Container networking prevents proper communication

### 2. Solutions Implemented

#### A. Updated Dockerfile
- Added `dumb-init` for proper signal handling
- Created startup script for better stdio management
- Added proper environment variables

#### B. Docker Compose Configuration
- Proper networking setup with custom bridge network
- Health checks to monitor container status
- Correct stdio and tty configuration

#### C. Startup Script
- Proper signal trapping for graceful shutdown
- Environment variable validation
- Optimized Node.js options

### 3. How to Use

#### Option 1: Docker Compose (Recommended)
```bash
# Create .env file with your tokens
echo "DISCORD_TOKEN=your_bot_token_here" > .env
echo "DISCORD_GUILD_ID=your_guild_id_here" >> .env

# Start the service
docker-compose up -d

# Check logs
docker-compose logs -f discord-mcp

# Stop the service
docker-compose down
```

#### Option 2: Direct Docker Build
```bash
# Build the image
docker build -t discord-mcp .

# Run with proper stdio handling
docker run -it --rm \
  -e DISCORD_TOKEN="your_bot_token" \
  -e DISCORD_GUILD_ID="your_guild_id" \
  --name discord-mcp-server \
  discord-mcp
```

### 4. Debugging Steps

1. **Check container logs**:
   ```bash
   docker logs discord-mcp-server
   ```

2. **Verify environment variables**:
   ```bash
   docker exec discord-mcp-server env | grep DISCORD
   ```

3. **Test Discord connectivity**:
   ```bash
   docker exec discord-mcp-server node -e "console.log('Node.js is working')"
   ```

4. **Check network connectivity**:
   ```bash
   docker exec discord-mcp-server ping -c 3 discord.com
   ```

### 5. Common Issues and Fixes

#### Issue: "Discord client error" or "Failed to start Discord MCP server"
**Solution**: Check your Discord bot token and ensure it has proper permissions.

#### Issue: Container exits immediately
**Solution**: Ensure the startup script has execute permissions and environment variables are set.

#### Issue: MCP client can't connect
**Solution**: Use the Docker Compose setup with proper stdio configuration.

### 6. Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DISCORD_TOKEN` | Yes | Your Discord bot token |
| `DISCORD_GUILD_ID` | No | Default Discord server ID |
| `DISCORD_CLIENT_ID` | HTTP OAuth | Discord application client ID for install URL generation |
| `DISCORD_CLIENT_SECRET` | HTTP OAuth | Discord application client secret for callback token exchange |
| `DISCORD_OAUTH_REDIRECT_URI` | HTTP OAuth | Must match Discord Developer Portal OAuth2 redirect URI |
| `NODE_ENV` | No | Set to 'production' for optimized performance |

### 7. Network Requirements

- **Outbound HTTPS (443)**: Required for Discord API communication
- **Outbound WSS (443)**: Required for Discord Gateway connection
- **Stdio Transport**: MCP communication via stdin/stdout

### 8. Performance Optimization

- Memory limit: 512MB (configured in startup script)
- Health checks: Every 30 seconds
- Graceful shutdown: 10-second timeout
- Restart policy: Unless stopped

If you continue experiencing issues, please check the container logs and ensure your Discord bot has the required permissions, intents, and OAuth settings enabled.
