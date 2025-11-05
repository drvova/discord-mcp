import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import Groq from "groq-sdk";
import { DiscordController } from "../../src/core/DiscordController.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.WEB_PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "../public")));

let discordController: DiscordController;
let groqClient: Groq;

// Initialize services
async function initialize() {
    discordController = new DiscordController();
    await discordController.initialize();

    const groqApiKey = process.env.GROQ_API_KEY;
    if (!groqApiKey) {
        console.warn(
            "GROQ_API_KEY not found in environment variables. AI features will be disabled.",
        );
    } else {
        groqClient = new Groq({ apiKey: groqApiKey });
    }
}

// Get available Discord tools
function getAvailableTools() {
    return [
        {
            type: "function",
            function: {
                name: "discord_send_message",
                description: "Send a message to a Discord channel",
                parameters: {
                    type: "object",
                    properties: {
                        channelId: {
                            type: "string",
                            description:
                                "The ID of the channel to send the message to",
                        },
                        message: {
                            type: "string",
                            description: "The message content to send",
                        },
                    },
                    required: ["channelId", "message"],
                },
            },
        },
        {
            type: "function",
            function: {
                name: "discord_list_channels",
                description: "List all channels in a Discord server",
                parameters: {
                    type: "object",
                    properties: {
                        guildId: {
                            type: "string",
                            description: "The ID of the Discord server",
                        },
                    },
                    required: ["guildId"],
                },
            },
        },
        {
            type: "function",
            function: {
                name: "discord_get_server_info",
                description: "Get information about a Discord server",
                parameters: {
                    type: "object",
                    properties: {
                        guildId: {
                            type: "string",
                            description: "The ID of the Discord server",
                        },
                    },
                    required: ["guildId"],
                },
            },
        },
        {
            type: "function",
            function: {
                name: "discord_create_text_channel",
                description: "Create a new text channel in a Discord server",
                parameters: {
                    type: "object",
                    properties: {
                        guildId: {
                            type: "string",
                            description: "The ID of the Discord server",
                        },
                        name: {
                            type: "string",
                            description: "The name of the new channel",
                        },
                        categoryId: {
                            type: "string",
                            description:
                                "Optional category ID to place the channel in",
                        },
                    },
                    required: ["guildId", "name"],
                },
            },
        },
        {
            type: "function",
            function: {
                name: "discord_read_messages",
                description: "Read messages from a Discord channel",
                parameters: {
                    type: "object",
                    properties: {
                        channelId: {
                            type: "string",
                            description:
                                "The ID of the channel to read messages from",
                        },
                        limit: {
                            type: "integer",
                            description:
                                "Number of messages to retrieve as an integer (default: 50, max: 100). MUST be a number, not a string. Example: 50",
                            minimum: 1,
                            maximum: 100,
                            default: 50,
                        },
                    },
                    required: ["channelId"],
                },
            },
        },
    ];
}

// Execute Discord tool
async function executeDiscordTool(toolName: string, args: any) {
    const discordService = discordController.getDiscordService();

    try {
        switch (toolName) {
            case "discord_send_message":
                return await discordService.sendMessage(
                    args.channelId,
                    args.message,
                );

            case "discord_list_channels":
                return await discordService.listChannels(args.guildId);

            case "discord_get_server_info":
                return await discordService.getServerInfo(args.guildId);

            case "discord_create_text_channel":
                return await discordService.createTextChannel(
                    args.guildId,
                    args.name,
                    args.categoryId,
                );

            case "discord_read_messages":
                const limit =
                    typeof args.limit === "string"
                        ? parseInt(args.limit, 10)
                        : args.limit || 50;
                return await discordService.readMessages(args.channelId, limit);

            default:
                throw new Error(`Unknown tool: ${toolName}`);
        }
    } catch (error: any) {
        return { error: error.message };
    }
}

// Chat endpoint with Groq
app.post("/api/chat", async (req, res) => {
    try {
        const { message, conversationHistory = [], context } = req.body;

        if (!message) {
            return res.status(400).json({ error: "Message is required" });
        }

        if (!groqClient) {
            return res.status(503).json({
                error: "Groq API is not configured. Please set GROQ_API_KEY environment variable.",
            });
        }

        let contextInfo = "";
        if (context?.guildId) {
            contextInfo = `\n\n## CURRENT SESSION CONTEXT\n\n`;
            contextInfo += `**Active Discord Server:** ${context.guildName || "Unknown"} (ID: ${context.guildId})\n`;

            if (context.channelId) {
                contextInfo += `**Active Channel:** #${context.channelName || "unknown"} (ID: ${context.channelId})\n`;
            } else {
                contextInfo += `**Active Channel:** None selected\n`;
            }

            if (
                context.availableChannels &&
                context.availableChannels.length > 0
            ) {
                contextInfo += `\n**Available Channels:**\n`;
                context.availableChannels.forEach((ch: any) => {
                    contextInfo += `- #${ch.name} (ID: ${ch.id}, Type: ${ch.type})\n`;
                });
            }

            contextInfo += `\n**IMPORTANT INSTRUCTIONS:**
- When the user says "send message to #channel-name" or "@channel-name", lookup the channel ID from the available channels list above
- If a channel is currently active, you can use that channel ID directly for operations
- Always use the exact channel IDs provided in the context
- If the user references a channel by name (like #general), find its ID in the available channels list
`;
        }

        const messages = [
            {
                role: "system",
                content: `# DISCORD MCP - CANONICAL CONSTITUTION${contextInfo}

You are Discord MCP, an intelligent Discord server management system operating under the Discord Management Constitutional Framework.

## ARTICLE I - IDENTITY AND PURPOSE

You are an AI-powered Discord server management assistant that translates natural language into Discord operations. Your purpose is to make Discord server administration intuitive, efficient, and error-free.

## ARTICLE II - OPERATIONAL CAPABILITIES

You have been granted the following Discord management powers:

### Section 1: Communication Powers
- **discord_send_message**: Transmit messages to any accessible channel
- **discord_read_messages**: Retrieve message history from channels

### Section 2: Information Powers
- **discord_list_channels**: Enumerate all channels with metadata and IDs
- **discord_get_server_info**: Query comprehensive server statistics and configuration

### Section 3: Administrative Powers
- **discord_create_text_channel**: Establish new text communication channels

## ARTICLE III - CONSTITUTIONAL OBLIGATIONS

### Section 1: Proactive Service
You SHALL automatically execute appropriate Discord operations when users express intent, without requiring explicit tool invocation requests.

### Section 2: Transparency Mandate
You SHALL:
- Announce operations before execution
- Explain results after completion
- Provide context for all actions taken

### Section 3: Information Completeness
When required parameters (channelId, guildId) are absent, you SHALL:
- Politely request missing information
- Offer to list available options when helpful
- Never guess or assume IDs

### Section 4: Error Handling Protocol
Upon operation failure, you SHALL:
- Explain the failure cause clearly
- Suggest corrective actions
- Provide alternative approaches when available

### Section 5: User Guidance
You SHALL:
- Recommend logical next steps after operations
- Educate users about Discord server management
- Format output for maximum readability

## ARTICLE IV - RESPONSE STANDARDS

### Section 1: Communication Style
- Use clear, professional, conversational language
- Avoid technical jargon unless necessary
- Be concise yet comprehensive

### Section 2: Data Presentation
- Format lists with clear structure
- Include relevant IDs with channel and server names
- Use markdown formatting for clarity
- Confirm all operations explicitly

### Section 3: Contextual Intelligence
- Remember conversation context
- Reference previous operations when relevant
- Maintain consistent server/channel references

## ARTICLE V - OPERATIONAL EXAMPLES

**Example 1: Channel Enumeration**
User: "Show me all channels"
Response: "I'll retrieve all channels from your Discord server." [executes discord_list_channels] "Your server has 12 channels organized in 3 categories: [formatted list with IDs]"

**Example 2: Missing Information**
User: "Send hello to general"
Response: "I need the channel ID to send a message. Would you like me to list all channels so you can identify #general, or do you have the channel ID?"

**Example 3: Successful Operation**
User: "Create a channel called announcements"
Response: "I'll create a new text channel named 'announcements'." [executes] "✓ Successfully created #announcements (ID: 123456789). Would you like me to configure permissions or move it to a specific category?"

## ARTICLE VI - PRIME DIRECTIVE

Above all: Make Discord server management **intuitive**, **reliable**, and **efficient**. You are the bridge between human intent and Discord's technical implementation.

This constitution governs all operations. Adherence is mandatory.`,
            },
            ...conversationHistory,
            {
                role: "user",
                content: message,
            },
        ];

        const completion = await groqClient.chat.completions.create({
            model: "llama-3.3-70b-versatile",
            messages: messages as any,
            tools: getAvailableTools() as any,
            tool_choice: "auto",
            temperature: 0.7,
            max_tokens: 2000,
        });

        const responseMessage = completion.choices[0].message;

        // Check if the model wants to call a tool
        if (
            responseMessage.tool_calls &&
            responseMessage.tool_calls.length > 0
        ) {
            const toolResults = [];

            for (const toolCall of responseMessage.tool_calls) {
                const functionName = toolCall.function.name;
                const functionArgs = JSON.parse(toolCall.function.arguments);

                const result = await executeDiscordTool(
                    functionName,
                    functionArgs,
                );
                toolResults.push({
                    tool_call_id: toolCall.id,
                    function_name: functionName,
                    result: result,
                });
            }

            // Get final response with tool results
            const finalMessages = [
                ...messages,
                responseMessage,
                ...toolResults.map((tr) => ({
                    role: "tool",
                    tool_call_id: tr.tool_call_id,
                    content: JSON.stringify(tr.result),
                })),
            ];

            const finalCompletion = await groqClient.chat.completions.create({
                model: "llama-3.3-70b-versatile",
                messages: finalMessages as any,
                temperature: 0.7,
                max_tokens: 2000,
            });

            return res.json({
                response: finalCompletion.choices[0].message.content,
                toolCalls: toolResults,
            });
        }

        res.json({
            response: responseMessage.content,
            toolCalls: [],
        });
    } catch (error: any) {
        console.error("Chat error:", error);
        res.status(500).json({
            error: "Failed to process chat message",
            details: error.message,
        });
    }
});

// Discord API endpoints
app.post("/api/discord/send-message", async (req, res) => {
    try {
        const { channelId, content } = req.body;

        if (!channelId || !content) {
            return res
                .status(400)
                .json({ error: "channelId and content are required" });
        }

        const discordService = discordController.getDiscordService();
        const result = await discordService.sendMessage(channelId, content);

        res.json({ success: true, result });
    } catch (error: any) {
        console.error("Send message error:", error);
        res.status(500).json({ error: error.message });
    }
});

app.post("/api/discord/send-gif", async (req, res) => {
    try {
        const { channelId, gifUrl, title } = req.body;

        if (!channelId || !gifUrl) {
            return res
                .status(400)
                .json({ error: "channelId and gifUrl are required" });
        }

        const discordService = discordController.getDiscordService();
        const result = await discordService.sendMessageWithEmbed(
            channelId,
            "",
            gifUrl,
            title,
        );

        res.json({ success: true, result });
    } catch (error: any) {
        console.error("Send GIF error:", error);
        res.status(500).json({ error: error.message });
    }
});

app.post("/api/discord/send-sticker", async (req, res) => {
    try {
        const { channelId, stickerId, content } = req.body;

        if (!channelId || !stickerId) {
            return res
                .status(400)
                .json({ error: "channelId and stickerId are required" });
        }

        const discordService = discordController.getDiscordService();
        const result = await discordService.sendSticker(
            channelId,
            stickerId,
            content,
        );

        res.json({ success: true, result });
    } catch (error: any) {
        console.error("Send sticker error:", error);
        res.status(500).json({ error: error.message });
    }
});

app.get("/api/discord/guilds", async (req, res) => {
    try {
        const discordService = discordController.getDiscordService();
        const client = (discordService as any).client;

        const guilds = Array.from(client.guilds.cache.values()).map(
            (guild: any) => ({
                id: guild.id,
                name: guild.name,
                memberCount: guild.memberCount,
                channelCount: guild.channels.cache.size,
                createdAt: guild.createdAt.toISOString(),
                icon: guild.iconURL(),
            }),
        );

        res.json(guilds);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

app.get("/api/discord/guilds/:guildId/channel-structure", async (req, res) => {
    try {
        const { guildId } = req.params;
        const discordService = discordController.getDiscordService();
        const client = (discordService as any).client;

        const guild = client.guilds.cache.get(guildId);
        if (!guild) {
            return res.status(404).json({ error: "Guild not found" });
        }

        const categories: any[] = [];
        const uncategorizedChannels: any[] = [];

        guild.channels.cache
            .filter((c: any) => c.type === 4) // CategoryChannel
            .sort((a: any, b: any) => a.position - b.position)
            .forEach((category: any) => {
                const channelsInCategory = guild.channels.cache
                    .filter((c: any) => c.parentId === category.id)
                    .sort((a: any, b: any) => a.position - b.position)
                    .map((c: any) => ({
                        id: c.id,
                        name: c.name,
                        type:
                            c.type === 0
                                ? "Text"
                                : c.type === 2
                                  ? "Voice"
                                  : "Other",
                        categoryId: category.id,
                        position: c.position,
                    }));

                categories.push({
                    id: category.id,
                    name: category.name,
                    channels: Array.from(channelsInCategory),
                    position: category.position,
                });
            });

        guild.channels.cache
            .filter((c: any) => !c.parentId && c.type !== 4)
            .sort((a: any, b: any) => a.position - b.position)
            .forEach((channel: any) => {
                uncategorizedChannels.push({
                    id: channel.id,
                    name: channel.name,
                    type:
                        channel.type === 0
                            ? "Text"
                            : channel.type === 2
                              ? "Voice"
                              : "Other",
                    position: channel.position,
                });
            });

        res.json({ categories, uncategorizedChannels });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

app.get("/api/discord/guilds/:guildId/info", async (req, res) => {
    try {
        const { guildId } = req.params;
        const discordService = discordController.getDiscordService();
        const info = await discordService.getServerInfo(guildId);
        res.json({ info });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

app.get("/api/discord/guilds/:guildId/emojis", async (req, res) => {
    try {
        const { guildId } = req.params;
        const discordService = discordController.getDiscordService();
        const client = (discordService as any).client;

        const guild = client.guilds.cache.get(guildId);
        if (!guild) {
            return res.status(404).json({ error: "Guild not found" });
        }

        const emojis = Array.from(guild.emojis.cache.values()).map(
            (emoji: any) => ({
                id: emoji.id,
                name: emoji.name,
                animated: emoji.animated || false,
                url: emoji.url,
                usage: `<:${emoji.name}:${emoji.id}>`,
                creator: emoji.author?.username,
            }),
        );

        res.json(emojis);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

app.get("/api/discord/guilds/:guildId/stickers", async (req, res) => {
    try {
        const { guildId } = req.params;
        const discordService = discordController.getDiscordService();
        const client = (discordService as any).client;

        const guild = client.guilds.cache.get(guildId);
        if (!guild) {
            return res.status(404).json({ error: "Guild not found" });
        }

        const stickers = Array.from(guild.stickers.cache.values()).map(
            (sticker: any) => ({
                id: sticker.id,
                name: sticker.name,
                description: sticker.description || "",
                tags: sticker.tags || "",
                format: sticker.format,
                url: sticker.url,
                creator: sticker.user?.username,
            }),
        );

        res.json(stickers);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

app.get("/api/tenor/search", async (req, res) => {
    try {
        const { q, limit = 20 } = req.query;

        if (!q) {
            return res.status(400).json({ error: "Search query is required" });
        }

        const tenorApiKey =
            process.env.TENOR_API_KEY ||
            "AIzaSyAyimkuYQYF_FXVALexPuGQctUWRURdCYQ";
        const url = `https://tenor.googleapis.com/v2/search?q=${encodeURIComponent(q as string)}&key=${tenorApiKey}&limit=${limit}&media_filter=gif,tinygif`;

        const response = await fetch(url);

        if (!response.ok) {
            throw new Error(`Tenor API error: ${response.statusText}`);
        }

        const data = await response.json();

        const gifs = data.results.map((gif: any) => ({
            id: gif.id,
            title: gif.content_description || gif.h1_title || "GIF",
            url: gif.media_formats.gif?.url || gif.media_formats.tinygif?.url,
            preview:
                gif.media_formats.tinygif?.url ||
                gif.media_formats.nanogif?.url,
            width: gif.media_formats.gif?.dims?.[0] || 498,
            height: gif.media_formats.gif?.dims?.[1] || 498,
        }));

        res.json(gifs);
    } catch (error: any) {
        console.error("Tenor API error:", error);
        res.status(500).json({ error: error.message });
    }
});

app.get("/api/tenor/featured", async (req, res) => {
    try {
        const { limit = 20 } = req.query;
        const tenorApiKey =
            process.env.TENOR_API_KEY ||
            "AIzaSyAyimkuYQYF_FXVALexPuGQctUWRURdCYQ";
        const url = `https://tenor.googleapis.com/v2/featured?key=${tenorApiKey}&limit=${limit}&media_filter=gif,tinygif`;

        const response = await fetch(url);

        if (!response.ok) {
            throw new Error(`Tenor API error: ${response.statusText}`);
        }

        const data = await response.json();

        const gifs = data.results.map((gif: any) => ({
            id: gif.id,
            title: gif.content_description || gif.h1_title || "GIF",
            url: gif.media_formats.gif?.url || gif.media_formats.tinygif?.url,
            preview:
                gif.media_formats.tinygif?.url ||
                gif.media_formats.nanogif?.url,
            width: gif.media_formats.gif?.dims?.[0] || 498,
            height: gif.media_formats.gif?.dims?.[1] || 498,
        }));

        res.json(gifs);
    } catch (error: any) {
        console.error("Tenor API error:", error);
        res.status(500).json({ error: error.message });
    }
});

// Health check endpoint
app.get("/api/health", (req, res) => {
    res.json({
        status: "ok",
        discord: discordController ? "connected" : "disconnected",
        groq: groqClient ? "configured" : "not configured",
    });
});

// Start server
async function startServer() {
    try {
        await initialize();

        app.listen(PORT, () => {
            console.log(
                `\n🌐 Discord MCP Web UI running at http://localhost:${PORT}`,
            );
            console.log(`📡 API endpoint: http://localhost:${PORT}/api/chat`);
            console.log(
                `\n✨ Groq AI: ${groqClient ? "Enabled" : "Disabled (set GROQ_API_KEY to enable)"}`,
            );
            console.log(
                `🤖 Discord: ${discordController ? "Connected" : "Disconnected"}\n`,
            );
        });
    } catch (error) {
        console.error("Failed to start server:", error);
        process.exit(1);
    }
}

startServer();
