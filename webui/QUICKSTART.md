# Quick Start Guide - Discord MCP Web UI

## Step 1: Get Your API Keys

### Discord Bot Token
1. Go to https://discord.com/developers/applications
2. Create a new application or select existing
3. Go to "Bot" section
4. Copy the bot token
5. Invite bot to your server with proper permissions

### Groq API Key
1. Go to https://console.groq.com
2. Sign up or log in
3. Navigate to "API Keys"
4. Create new API key
5. Copy the key

### Discord Guild ID
1. Enable Developer Mode in Discord (User Settings → Advanced → Developer Mode)
2. Right-click your server icon
3. Click "Copy Server ID"

## Step 2: Configure Environment

Create or edit `.env` file:

```bash
cp .env.example .env
```

Then edit `.env` and add your keys:

```env
DISCORD_TOKEN=your_bot_token_from_step_1
DISCORD_GUILD_ID=your_server_id_from_step_1
GROQ_API_KEY=your_groq_api_key_from_step_1
WEB_PORT=3000
```

## Step 3: Start the Web Server

### Development Mode (Recommended for testing)
```bash
npm run web
```

### Production Mode
```bash
npm run build
npm run web:build
```

## Step 4: Access the Web UI

Open your browser to:
```
http://localhost:3000
```

## Step 5: Try It Out!

Type natural language commands:

- "List all channels in my server"
- "Send 'Hello World' to channel 123456789"
- "Get server information"
- "Create a new text channel called test-channel"

## Troubleshooting

### "Groq AI: Offline"
- Check that `GROQ_API_KEY` is set correctly in `.env`
- Restart the web server

### "Discord: Offline"
- Verify `DISCORD_TOKEN` is correct
- Make sure bot is invited to your server
- Check bot has necessary permissions

### "Port already in use"
```bash
# Use a different port
WEB_PORT=3001 npm run web
```

### "Channel not found" errors
- The bot needs to be in the server
- Use correct channel IDs (right-click → Copy ID in Discord)
- For "list channels" command, provide your guild ID

## Example Commands

### Get Started
```
"Show me all channels"
```
*Note: You'll need to provide your guild ID when asked*

### Send a Message
```
"Send 'Hello everyone!' to channel 1234567890"
```

### Create Channel
```
"Create a new text channel called announcements in my server"
```
*Note: You'll need to provide your guild ID*

### Read Messages
```
"Show me the last 10 messages from channel 1234567890"
```

## Next Steps

- Read the full documentation in `README.md` (in this folder)
- Explore more Discord tools in the main project `../README.md`
- Check `../ARCHITECTURE_PATTERNS.md` for system design
- See `../TROUBLESHOOTING.md` for common issues

## Support

For issues or questions:
- Check the documentation files
- Review the logs in your terminal
- Open an issue on GitHub
