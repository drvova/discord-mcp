// Core Discord.js imports organized by functionality
import { z } from "zod";
import { Partials } from "discord.js";
import { AuthConfigSchema, SwitchTokenSchema } from "./types.js";
import {
    // Core client and guild types
    Client,
    GatewayIntentBits,
    Guild,
    GuildMember,
    User,

    // Channel types
    TextChannel,
    VoiceChannel,
    StageChannel,
    CategoryChannel,
    GuildChannel,
    ThreadChannel,
    ChannelType,
    ThreadAutoArchiveDuration,

    // Message and content types
    Message,
    AttachmentBuilder,
    EmbedBuilder,

    // Permission and moderation types
    PermissionFlagsBits,
    PermissionOverwriteOptions,
    OverwriteType,
    AuditLogEvent,
    GuildBan,

    // Role management
    Role,
    ColorResolvable,

    // Server events and scheduling
    GuildScheduledEvent,
    GuildScheduledEventEntityType,
    GuildScheduledEventPrivacyLevel,
    GuildScheduledEventStatus,

    // Server customization
    Invite,
    GuildEmoji,
    Sticker,
    WelcomeScreen,
    WelcomeChannel,
    GuildVerificationLevel,

    // Auto moderation
    AutoModerationRule,
    AutoModerationRuleTriggerType,
    AutoModerationRuleEventType,
    AutoModerationActionType,

    // Interactive components
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ComponentType,

    // Utilities
    Collection,
    WebhookClient,
} from "discord.js";
import {
    joinVoiceChannel,
    createAudioPlayer,
    createAudioResource,
    AudioPlayerStatus,
    VoiceConnectionStatus,
    getVoiceConnection,
    VoiceConnection,
    AudioPlayer,
} from "@discordjs/voice";

export class DiscordService {
    private client: Client;
    private defaultGuildId?: string;
    private isReady: boolean = false;
    private audioPlayers: Map<string, AudioPlayer> = new Map();
    private voiceConnections: Map<string, VoiceConnection> = new Map();
    private currentAuthConfig: z.infer<typeof AuthConfigSchema>;

    constructor(authConfig?: z.infer<typeof AuthConfigSchema>) {
        // Default to bot token if no config provided
        this.currentAuthConfig = authConfig || {
            tokenType: "bot",
            token: process.env.DISCORD_TOKEN || "",
            intents: [
                "Guilds",
                "GuildMembers",
                "GuildMessages",
                "MessageContent",
                "DirectMessages",
                "GuildVoiceStates",
                "GuildModeration",
            ],
        };

        const intents = this.getIntentsForConfig(
            this.currentAuthConfig.intents,
        );

        this.client = new Client({
            intents,
            partials:
                this.currentAuthConfig.tokenType === "user"
                    ? [
                          Partials.User,
                          Partials.Channel,
                          Partials.GuildMember,
                          Partials.Message,
                      ]
                    : [],
        });

        this.defaultGuildId = process.env.DISCORD_GUILD_ID;
    }

    // Method to get current authentication configuration
    getCurrentAuthConfig(): z.infer<typeof AuthConfigSchema> {
        return { ...this.currentAuthConfig };
    }

    async initialize(): Promise<void> {
        const token = this.currentAuthConfig.token;
        if (!token) {
            const tokenEnvVar =
                this.currentAuthConfig.tokenType === "user"
                    ? "DISCORD_USER_TOKEN"
                    : "DISCORD_TOKEN";
            console.error(
                `ERROR: The environment variable ${tokenEnvVar} is not set. Please set it to run the application properly.`,
            );
            process.exit(1);
        }

        return new Promise((resolve, reject) => {
            this.client.once("ready", async () => {
                const userType =
                    this.currentAuthConfig.tokenType === "user"
                        ? "user account"
                        : "bot";
                console.error(
                    `Discord ${userType} logged in as ${this.client.user?.tag}`,
                );

                // Populate guild and channel cache
                try {
                    await this.client.guilds.fetch();
                    for (const guild of this.client.guilds.cache.values()) {
                        await guild.channels.fetch();
                    }
                    console.error(
                        `Cached ${this.client.guilds.cache.size} guilds with all channels`,
                    );
                } catch (error) {
                    console.error(
                        "Warning: Could not fully populate cache:",
                        error,
                    );
                }

                this.isReady = true;
                resolve();
            });

            this.client.on("error", (error) => {
                console.error("Discord client error:", error);
            });

            this.client.login(token).catch(reject);
        });
    }

    async switchToken(
        switchConfig: z.infer<typeof SwitchTokenSchema>,
    ): Promise<string> {
        const newToken =
            switchConfig.token ||
            (switchConfig.tokenType === "user"
                ? process.env.DISCORD_USER_TOKEN
                : process.env.DISCORD_TOKEN);

        if (!newToken) {
            const tokenEnvVar =
                switchConfig.tokenType === "user"
                    ? "DISCORD_USER_TOKEN"
                    : "DISCORD_TOKEN";
            throw new Error(
                `Token switch failed: ${tokenEnvVar} environment variable is not set`,
            );
        }

        // Store current state
        const wasReady = this.isReady;
        const oldConfig = { ...this.currentAuthConfig };

        try {
            // Clean up existing connections
            if (wasReady) {
                await this.destroy();
            }

            // Update auth config
            this.currentAuthConfig = {
                tokenType: switchConfig.tokenType,
                token: newToken,
                intents: oldConfig.intents, // Keep same intents
            };

            // Reinitialize client with new config
            const intents = this.getIntentsForConfig(
                this.currentAuthConfig.intents,
            );

            this.client = new Client({
                intents,
                partials:
                    this.currentAuthConfig.tokenType === "user"
                        ? [
                              Partials.User,
                              Partials.Channel,
                              Partials.GuildMember,
                              Partials.Message,
                          ]
                        : [],
            });

            this.isReady = false;
            this.audioPlayers.clear();
            this.voiceConnections.clear();

            await this.initialize();

            const userType =
                this.currentAuthConfig.tokenType === "user"
                    ? "user account"
                    : "bot";
            return `Successfully switched to ${userType} token. Logged in as ${this.client.user?.tag}`;
        } catch (error) {
            // Restore previous state on failure
            this.currentAuthConfig = oldConfig;
            if (wasReady) {
                await this.initialize(); // Try to restore previous connection
            }
            throw new Error(
                `Token switch failed: ${error instanceof Error ? error.message : "Unknown error"}`,
            );
        }
    }

    getAuthStatus(): {
        tokenType: string;
        isReady: boolean;
        userTag?: string;
        permissions: string[];
    } {
        const intents = this.currentAuthConfig.intents || [];
        return {
            tokenType: this.currentAuthConfig.tokenType,
            isReady: this.isReady,
            userTag: this.client.user?.tag,
            permissions: this.getPermissionsForTokenType(
                this.currentAuthConfig.tokenType,
                intents,
            ),
        };
    }

    private getIntentsForConfig(intentNames?: string[]): GatewayIntentBits[] {
        const intentMap: Record<string, GatewayIntentBits> = {
            Guilds: GatewayIntentBits.Guilds,
            GuildMembers: GatewayIntentBits.GuildMembers,
            GuildMessages: GatewayIntentBits.GuildMessages,
            MessageContent: GatewayIntentBits.MessageContent,
            DirectMessages: GatewayIntentBits.DirectMessages,
            GuildVoiceStates: GatewayIntentBits.GuildVoiceStates,
            GuildModeration: GatewayIntentBits.GuildModeration,
            GuildPresences: GatewayIntentBits.GuildPresences,
            GuildMessageReactions: GatewayIntentBits.GuildMessageReactions,
            DirectMessageReactions: GatewayIntentBits.DirectMessageReactions,
        };

        return (intentNames || [])
            .map((name) => intentMap[name])
            .filter(Boolean) as GatewayIntentBits[];
    }

    private validateUserTokenOperation(operationName: string): void {
        if (this.currentAuthConfig.tokenType === "user") {
            // Define operations that are not allowed for user tokens
            const restrictedOperations = [
                "banMember",
                "unbanMember",
                "kickMember",
                "timeoutMember",
                "removeTimeout",
                "createRole",
                "deleteRole",
                "editRole",
                "addRoleToMember",
                "removeRoleFromMember",
                "createAutomodRule",
                "editAutomodRule",
                "deleteAutomodRule",
            ];

            if (restrictedOperations.includes(operationName)) {
                throw new Error(
                    `Operation '${operationName}' is not available when using user token authentication. This requires bot token privileges.`,
                );
            }
        }
    }

    private getPermissionsForTokenType(
        tokenType: string,
        intents: string[],
    ): string[] {
        const basePermissions =
            tokenType === "user"
                ? [
                      "Send Messages",
                      "Read Messages",
                      "Manage Own Messages",
                      "Join Voice Channels",
                  ]
                : ["All Bot Permissions"];

        const intentPermissions: Record<string, string> = {
            GuildMembers: "View Server Members",
            GuildModeration: "Moderate Members",
            GuildPresences: "View Member Presences",
            GuildMessageReactions: "Manage Reactions",
            DirectMessageReactions: "Manage Reactions in DMs",
        };

        const additionalPermissions = intents
            .map((intent) => intentPermissions[intent])
            .filter(Boolean);

        return [...basePermissions, ...additionalPermissions];
    }

    private resolveGuildId(guildId?: string): string {
        const resolved = guildId || this.defaultGuildId;
        if (!resolved) {
            throw new Error("guildId cannot be null");
        }
        return resolved;
    }

    private ensureReady(): void {
        if (!this.isReady) {
            throw new Error("Discord client is not ready");
        }
    }

    // Server Information Tool
    async getServerInfo(guildId?: string): Promise<string> {
        this.ensureReady();
        this.validateUserTokenOperation("getServerInfo");
        const resolvedGuildId = this.resolveGuildId(guildId);

        const guild = this.client.guilds.cache.get(resolvedGuildId);
        if (!guild) {
            throw new Error("Discord server not found by guildId");
        }

        const owner = await guild.fetchOwner();

        return `Server Name: ${guild.name}
Server ID: ${guild.id}
Owner: ${owner.user.username}
Created On: ${guild.createdAt.toLocaleDateString()}
Members: ${guild.memberCount}
Channels:
 - Text: ${guild.channels.cache.filter((c) => c.type === ChannelType.GuildText).size}
 - Voice: ${guild.channels.cache.filter((c) => c.type === ChannelType.GuildVoice).size}
  - Categories: ${guild.channels.cache.filter((c) => c.type === ChannelType.GuildCategory).size}
Boosts:
 - Count: ${guild.premiumSubscriptionCount || 0}
 - Tier: ${guild.premiumTier}`;
    }

    // Message Management Tools
    async sendMessage(channelId: string, message: string): Promise<string> {
        this.ensureReady();

        const channel = this.client.channels.cache.get(
            channelId,
        ) as TextChannel;
        if (!channel || channel.type !== ChannelType.GuildText) {
            throw new Error("Channel not found by channelId");
        }

        const sentMessage = await channel.send(message);
        return `Message sent successfully. Message link: ${sentMessage.url}`;
    }

    async sendMessageWithEmbed(
        channelId: string,
        content: string,
        embedUrl: string,
        embedTitle?: string,
    ): Promise<string> {
        this.ensureReady();

        const channel = this.client.channels.cache.get(
            channelId,
        ) as TextChannel;
        if (!channel || channel.type !== ChannelType.GuildText) {
            throw new Error("Channel not found by channelId");
        }

        const embed = new EmbedBuilder().setImage(embedUrl).setColor(0x5865f2);

        if (embedTitle) {
            embed.setTitle(embedTitle);
        }

        const sentMessage = await channel.send({
            content: content || undefined,
            embeds: [embed],
        });

        return `Message with embed sent successfully. Message link: ${sentMessage.url}`;
    }

    async sendSticker(
        channelId: string,
        stickerId: string,
        content?: string,
    ): Promise<string> {
        this.ensureReady();

        const channel = this.client.channels.cache.get(
            channelId,
        ) as TextChannel;
        if (!channel || channel.type !== ChannelType.GuildText) {
            throw new Error("Channel not found by channelId");
        }

        const sentMessage = await channel.send({
            content: content || undefined,
            stickers: [stickerId],
        });

        return `Sticker sent successfully. Message link: ${sentMessage.url}`;
    }

    async editMessage(
        channelId: string,
        messageId: string,
        newMessage: string,
    ): Promise<string> {
        this.ensureReady();

        const channel = this.client.channels.cache.get(
            channelId,
        ) as TextChannel;
        if (!channel || channel.type !== ChannelType.GuildText) {
            throw new Error("Channel not found by channelId");
        }

        const message = await channel.messages.fetch(messageId);
        if (!message) {
            throw new Error("Message not found by messageId");
        }

        const editedMessage = await message.edit(newMessage);
        return `Message edited successfully. Message link: ${editedMessage.url}`;
    }

    async deleteMessage(channelId: string, messageId: string): Promise<string> {
        this.ensureReady();

        const channel = this.client.channels.cache.get(
            channelId,
        ) as TextChannel;
        if (!channel || channel.type !== ChannelType.GuildText) {
            throw new Error("Channel not found by channelId");
        }

        const message = await channel.messages.fetch(messageId);
        if (!message) {
            throw new Error("Message not found by messageId");
        }

        await message.delete();
        return "Message deleted successfully";
    }

    async readMessages(channelId: string, count?: string): Promise<string> {
        this.ensureReady();

        const limit = count ? parseInt(count) : 100;

        const channel = this.client.channels.cache.get(
            channelId,
        ) as TextChannel;
        if (!channel || channel.type !== ChannelType.GuildText) {
            throw new Error("Channel not found by channelId");
        }

        const messages = await channel.messages.fetch({ limit });
        const formattedMessages = this.formatMessages(
            Array.from(messages.values()),
        );

        return `**Retrieved ${messages.size} messages:** \n${formattedMessages.join("\n")}`;
    }

    async getUserIdByName(username: string, guildId?: string): Promise<string> {
        this.ensureReady();
        this.validateUserTokenOperation("getUserIdByName");
        const resolvedGuildId = this.resolveGuildId(guildId);

        const guild = this.client.guilds.cache.get(resolvedGuildId);
        if (!guild) {
            throw new Error("Discord server not found by guildId");
        }

        let name = username;
        let discriminator: string | null = null;

        if (username.includes("#")) {
            const idx = username.lastIndexOf("#");
            name = username.substring(0, idx);
            discriminator = username.substring(idx + 1);
        }

        // Fetch all members if not cached
        await guild.members.fetch();

        let members = guild.members.cache.filter(
            (m) => m.user.username.toLowerCase() === name.toLowerCase(),
        );

        if (discriminator) {
            members = members.filter(
                (m) => m.user.discriminator === discriminator,
            );
        }

        if (members.size === 0) {
            throw new Error(`No user found with username ${username}`);
        }

        if (members.size > 1) {
            const userList = members
                .map(
                    (m) =>
                        `${m.user.username}#${m.user.discriminator} (ID: ${m.user.id})`,
                )
                .join(", ");
            throw new Error(
                `Multiple users found with username '${username}'. List: ${userList}. Please specify the full username#discriminator.`,
            );
        }

        return members.first()!.user.id;
    }

    async sendPrivateMessage(userId: string, message: string): Promise<string> {
        this.ensureReady();

        const user = await this.client.users.fetch(userId);
        if (!user) {
            throw new Error("User not found by userId");
        }

        const dmChannel = await user.createDM();
        const sentMessage = await dmChannel.send(message);

        return `Message sent successfully. Message link: ${sentMessage.url}`;
    }

    async editPrivateMessage(
        userId: string,
        messageId: string,
        newMessage: string,
    ): Promise<string> {
        this.ensureReady();

        const user = await this.client.users.fetch(userId);
        if (!user) {
            throw new Error("User not found by userId");
        }

        const dmChannel = await user.createDM();
        const message = await dmChannel.messages.fetch(messageId);
        if (!message) {
            throw new Error("Message not found by messageId");
        }

        const editedMessage = await message.edit(newMessage);
        return `Message edited successfully. Message link: ${editedMessage.url}`;
    }

    async deletePrivateMessage(
        userId: string,
        messageId: string,
    ): Promise<string> {
        this.ensureReady();

        const user = await this.client.users.fetch(userId);
        if (!user) {
            throw new Error("User not found by userId");
        }

        const dmChannel = await user.createDM();
        const message = await dmChannel.messages.fetch(messageId);
        if (!message) {
            throw new Error("Message not found by messageId");
        }

        await message.delete();
        return "Message deleted successfully";
    }

    async readPrivateMessages(userId: string, count?: string): Promise<string> {
        this.ensureReady();

        const limit = count ? parseInt(count) : 100;

        const user = await this.client.users.fetch(userId);
        if (!user) {
            throw new Error("User not found by userId");
        }

        const dmChannel = await user.createDM();
        const messages = await dmChannel.messages.fetch({ limit });
        const formattedMessages = this.formatMessages(
            Array.from(messages.values()),
        );

        return `**Retrieved ${messages.size} messages:** \n${formattedMessages.join("\n")}`;
    }

    async addReaction(
        channelId: string,
        messageId: string,
        emoji: string,
    ): Promise<string> {
        this.ensureReady();

        const channel = this.client.channels.cache.get(
            channelId,
        ) as TextChannel;
        if (!channel || channel.type !== ChannelType.GuildText) {
            throw new Error("Channel not found by channelId");
        }

        const message = await channel.messages.fetch(messageId);
        if (!message) {
            throw new Error("Message not found by messageId");
        }

        await message.react(emoji);
        return `Added reaction successfully. Message link: ${message.url}`;
    }

    async removeReaction(
        channelId: string,
        messageId: string,
        emoji: string,
    ): Promise<string> {
        this.ensureReady();

        const channel = this.client.channels.cache.get(
            channelId,
        ) as TextChannel;
        if (!channel || channel.type !== ChannelType.GuildText) {
            throw new Error("Channel not found by channelId");
        }

        const message = await channel.messages.fetch(messageId);
        if (!message) {
            throw new Error("Message not found by messageId");
        }

        const reaction = message.reactions.cache.find(
            (r) => r.emoji.name === emoji,
        );
        if (reaction) {
            await reaction.users.remove(this.client.user!.id);
        }

        return `Removed reaction successfully. Message link: ${message.url}`;
    }

    // Channel Management Tools
    async createTextChannel(
        guildId: string | undefined,
        name: string,
        categoryId?: string,
    ): Promise<string> {
        this.ensureReady();
        const resolvedGuildId = this.resolveGuildId(guildId);

        const guild = this.client.guilds.cache.get(resolvedGuildId);
        if (!guild) {
            throw new Error("Discord server not found by guildId");
        }

        let textChannel;
        if (categoryId) {
            const category = guild.channels.cache.get(
                categoryId,
            ) as CategoryChannel;
            if (!category || category.type !== ChannelType.GuildCategory) {
                throw new Error("Category not found by categoryId");
            }
            textChannel = await guild.channels.create({
                name,
                type: ChannelType.GuildText,
                parent: category,
            });
            return `Created new text channel: ${textChannel.name} (ID: ${textChannel.id}) in category: ${category.name}`;
        } else {
            textChannel = await guild.channels.create({
                name,
                type: ChannelType.GuildText,
            });
            return `Created new text channel: ${textChannel.name} (ID: ${textChannel.id})`;
        }
    }

    async createVoiceChannel(
        guildId: string | undefined,
        name: string,
        categoryId?: string,
        userLimit?: number,
        bitrate?: number,
    ): Promise<string> {
        this.ensureReady();
        const resolvedGuildId = this.resolveGuildId(guildId);

        const guild = this.client.guilds.cache.get(resolvedGuildId);
        if (!guild) {
            throw new Error("Discord server not found by guildId");
        }

        // Check bot permissions
        const botMember = guild.members.cache.get(this.client.user!.id);
        if (!botMember?.permissions.has(PermissionFlagsBits.ManageChannels)) {
            throw new Error("Bot doesn't have permission to manage channels");
        }

        try {
            // Validate user limit (0-99, where 0 means unlimited)
            let validUserLimit = userLimit;
            if (userLimit !== undefined) {
                if (userLimit < 0 || userLimit > 99) {
                    throw new Error(
                        "User limit must be between 0 and 99 (0 = unlimited)",
                    );
                }
                validUserLimit = userLimit;
            }

            // Validate bitrate (8000-384000 depending on server boost level)
            let validBitrate = bitrate;
            if (bitrate !== undefined) {
                // Get server's maximum bitrate based on boost level
                const maxBitrate = guild.maximumBitrate || 64000; // Default to 64kbps if not available

                if (bitrate < 8000 || bitrate > maxBitrate) {
                    throw new Error(
                        `Bitrate must be between 8000 and ${maxBitrate} (server's maximum based on boost level)`,
                    );
                }
                validBitrate = bitrate;
            }

            let voiceChannel;
            const channelOptions: any = {
                name,
                type: ChannelType.GuildVoice,
            };

            // Add optional properties if provided
            if (validUserLimit !== undefined) {
                channelOptions.userLimit = validUserLimit;
            }
            if (validBitrate !== undefined) {
                channelOptions.bitrate = validBitrate;
            }

            if (categoryId) {
                const category = guild.channels.cache.get(
                    categoryId,
                ) as CategoryChannel;
                if (!category || category.type !== ChannelType.GuildCategory) {
                    throw new Error("Category not found by categoryId");
                }
                channelOptions.parent = category;

                voiceChannel = await guild.channels.create(channelOptions);

                const details = [];
                if (validUserLimit !== undefined)
                    details.push(
                        `user limit: ${validUserLimit === 0 ? "unlimited" : validUserLimit}`,
                    );
                if (validBitrate !== undefined)
                    details.push(`bitrate: ${validBitrate}kbps`);

                return `Created new voice channel: ${voiceChannel.name} (ID: ${voiceChannel.id}) in category: ${category.name}${details.length > 0 ? ` with ${details.join(", ")}` : ""}`;
            } else {
                voiceChannel = await guild.channels.create(channelOptions);

                const details = [];
                if (validUserLimit !== undefined)
                    details.push(
                        `user limit: ${validUserLimit === 0 ? "unlimited" : validUserLimit}`,
                    );
                if (validBitrate !== undefined)
                    details.push(`bitrate: ${validBitrate}kbps`);

                return `Created new voice channel: ${voiceChannel.name} (ID: ${voiceChannel.id})${details.length > 0 ? ` with ${details.join(", ")}` : ""}`;
            }
        } catch (error) {
            throw new Error(
                `Failed to create voice channel: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    async createForumChannel(
        guildId: string | undefined,
        name: string,
        categoryId?: string,
        options?: {
            topic?: string;
            slowmode?: number;
            defaultReactionEmoji?: string;
            isPrivate?: boolean;
            allowedRoles?: string[];
        },
    ): Promise<string> {
        this.ensureReady();
        const resolvedGuildId = this.resolveGuildId(guildId);

        const guild = this.client.guilds.cache.get(resolvedGuildId);
        if (!guild) {
            throw new Error("Discord server not found by guildId");
        }

        // Check bot permissions
        const botMember = guild.members.cache.get(this.client.user!.id);
        if (!botMember?.permissions.has(PermissionFlagsBits.ManageChannels)) {
            throw new Error("Bot doesn't have permission to manage channels");
        }

        try {
            const channelOptions: any = {
                name,
                type: ChannelType.GuildForum,
            };

            // Add optional properties
            if (options?.topic) {
                channelOptions.topic = options.topic;
            }
            if (options?.slowmode && options.slowmode > 0) {
                if (options.slowmode > 21600) {
                    // Max 6 hours
                    throw new Error(
                        "Slowmode cannot exceed 21600 seconds (6 hours)",
                    );
                }
                channelOptions.rateLimitPerUser = options.slowmode;
            }
            if (options?.defaultReactionEmoji) {
                channelOptions.defaultReactionEmoji =
                    options.defaultReactionEmoji;
            }

            // Handle category
            if (categoryId) {
                const category = guild.channels.cache.get(
                    categoryId,
                ) as CategoryChannel;
                if (!category || category.type !== ChannelType.GuildCategory) {
                    throw new Error("Category not found by categoryId");
                }
                channelOptions.parent = category;
            }

            const forumChannel = await guild.channels.create(channelOptions);

            // Set privacy and role permissions if specified
            if (options?.isPrivate || options?.allowedRoles) {
                await this.configureChannelPrivacy(
                    forumChannel,
                    options.isPrivate,
                    options.allowedRoles,
                    guild,
                );
            }

            const details = [];
            if (options?.topic) details.push(`topic: "${options.topic}"`);
            if (options?.slowmode)
                details.push(`slowmode: ${options.slowmode}s`);
            if (options?.isPrivate) details.push("private channel");
            if (options?.allowedRoles?.length)
                details.push(
                    `${options.allowedRoles.length} role(s) granted access`,
                );

            return `Created forum channel: ${forumChannel.name} (ID: ${forumChannel.id})${categoryId ? ` in category` : ""}${details.length > 0 ? ` with ${details.join(", ")}` : ""}`;
        } catch (error) {
            throw new Error(
                `Failed to create forum channel: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    async createAnnouncementChannel(
        guildId: string | undefined,
        name: string,
        categoryId?: string,
        options?: {
            topic?: string;
            slowmode?: number;
            isPrivate?: boolean;
            allowedRoles?: string[];
        },
    ): Promise<string> {
        this.ensureReady();
        const resolvedGuildId = this.resolveGuildId(guildId);

        const guild = this.client.guilds.cache.get(resolvedGuildId);
        if (!guild) {
            throw new Error("Discord server not found by guildId");
        }

        // Check bot permissions
        const botMember = guild.members.cache.get(this.client.user!.id);
        if (!botMember?.permissions.has(PermissionFlagsBits.ManageChannels)) {
            throw new Error("Bot doesn't have permission to manage channels");
        }

        try {
            const channelOptions: any = {
                name,
                type: ChannelType.GuildAnnouncement,
            };

            // Add optional properties
            if (options?.topic) {
                channelOptions.topic = options.topic;
            }
            if (options?.slowmode && options.slowmode > 0) {
                if (options.slowmode > 21600) {
                    throw new Error(
                        "Slowmode cannot exceed 21600 seconds (6 hours)",
                    );
                }
                channelOptions.rateLimitPerUser = options.slowmode;
            }

            // Handle category
            if (categoryId) {
                const category = guild.channels.cache.get(
                    categoryId,
                ) as CategoryChannel;
                if (!category || category.type !== ChannelType.GuildCategory) {
                    throw new Error("Category not found by categoryId");
                }
                channelOptions.parent = category;
            }

            const announcementChannel =
                await guild.channels.create(channelOptions);

            // Set privacy and role permissions if specified
            if (options?.isPrivate || options?.allowedRoles) {
                await this.configureChannelPrivacy(
                    announcementChannel,
                    options.isPrivate,
                    options.allowedRoles,
                    guild,
                );
            }

            const details = [];
            if (options?.topic) details.push(`topic: "${options.topic}"`);
            if (options?.slowmode)
                details.push(`slowmode: ${options.slowmode}s`);
            if (options?.isPrivate) details.push("private channel");
            if (options?.allowedRoles?.length)
                details.push(
                    `${options.allowedRoles.length} role(s) granted access`,
                );

            return `Created announcement channel: ${announcementChannel.name} (ID: ${announcementChannel.id})${categoryId ? ` in category` : ""}${details.length > 0 ? ` with ${details.join(", ")}` : ""}`;
        } catch (error) {
            throw new Error(
                `Failed to create announcement channel: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    async createStageChannel(
        guildId: string | undefined,
        name: string,
        categoryId?: string,
        options?: {
            topic?: string;
            bitrate?: number;
            isPrivate?: boolean;
            allowedRoles?: string[];
        },
    ): Promise<string> {
        this.ensureReady();
        const resolvedGuildId = this.resolveGuildId(guildId);

        const guild = this.client.guilds.cache.get(resolvedGuildId);
        if (!guild) {
            throw new Error("Discord server not found by guildId");
        }

        // Check bot permissions
        const botMember = guild.members.cache.get(this.client.user!.id);
        if (!botMember?.permissions.has(PermissionFlagsBits.ManageChannels)) {
            throw new Error("Bot doesn't have permission to manage channels");
        }

        try {
            const channelOptions: any = {
                name,
                type: ChannelType.GuildStageVoice,
            };

            // Add optional properties
            if (options?.topic) {
                channelOptions.topic = options.topic;
            }
            if (options?.bitrate) {
                const maxBitrate = guild.maximumBitrate || 64000;
                if (options.bitrate < 8000 || options.bitrate > maxBitrate) {
                    throw new Error(
                        `Bitrate must be between 8000 and ${maxBitrate} (server's maximum based on boost level)`,
                    );
                }
                channelOptions.bitrate = options.bitrate;
            }

            // Handle category
            if (categoryId) {
                const category = guild.channels.cache.get(
                    categoryId,
                ) as CategoryChannel;
                if (!category || category.type !== ChannelType.GuildCategory) {
                    throw new Error("Category not found by categoryId");
                }
                channelOptions.parent = category;
            }

            const stageChannel = await guild.channels.create(channelOptions);

            // Set privacy and role permissions if specified
            if (options?.isPrivate || options?.allowedRoles) {
                await this.configureChannelPrivacy(
                    stageChannel,
                    options.isPrivate,
                    options.allowedRoles,
                    guild,
                );
            }

            const details = [];
            if (options?.topic) details.push(`topic: "${options.topic}"`);
            if (options?.bitrate)
                details.push(`bitrate: ${options.bitrate}kbps`);
            if (options?.isPrivate) details.push("private channel");
            if (options?.allowedRoles?.length)
                details.push(
                    `${options.allowedRoles.length} role(s) granted access`,
                );

            return `Created stage channel: ${stageChannel.name} (ID: ${stageChannel.id})${categoryId ? ` in category` : ""}${details.length > 0 ? ` with ${details.join(", ")}` : ""}`;
        } catch (error) {
            throw new Error(
                `Failed to create stage channel: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    private async configureChannelPrivacy(
        channel: any,
        isPrivate?: boolean,
        allowedRoles?: string[],
        guild?: any,
    ): Promise<void> {
        if (!isPrivate && !allowedRoles?.length) return;

        try {
            const permissionOverwrites = [];

            // If private, deny @everyone access first
            if (isPrivate) {
                permissionOverwrites.push({
                    id: guild.id, // @everyone role
                    deny: [PermissionFlagsBits.ViewChannel],
                    type: 0, // Role type
                });
            }

            // Grant access to specific roles
            if (allowedRoles?.length) {
                for (const roleId of allowedRoles) {
                    const role = guild.roles.cache.get(roleId);
                    if (!role) {
                        throw new Error(`Role not found: ${roleId}`);
                    }

                    permissionOverwrites.push({
                        id: roleId,
                        allow: [
                            PermissionFlagsBits.ViewChannel,
                            PermissionFlagsBits.Connect,
                        ], // Connect for voice channels
                        type: 0, // Role type
                    });
                }
            }

            // Apply permission overwrites
            if (permissionOverwrites.length > 0) {
                await channel.permissionOverwrites.set(permissionOverwrites);
            }
        } catch (error) {
            throw new Error(
                `Failed to configure channel privacy: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    async editChannelAdvanced(
        guildId: string | undefined,
        channelId: string,
        options: {
            name?: string;
            topic?: string;
            slowmode?: number;
            userLimit?: number;
            bitrate?: number;
            isPrivate?: boolean;
            allowedRoles?: string[];
            categoryId?: string | null;
        },
    ): Promise<string> {
        this.ensureReady();
        const resolvedGuildId = this.resolveGuildId(guildId);

        const guild = this.client.guilds.cache.get(resolvedGuildId);
        if (!guild) {
            throw new Error("Discord server not found by guildId");
        }

        // Check bot permissions
        const botMember = guild.members.cache.get(this.client.user!.id);
        if (!botMember?.permissions.has(PermissionFlagsBits.ManageChannels)) {
            throw new Error("Bot doesn't have permission to manage channels");
        }

        try {
            const channel = guild.channels.cache.get(channelId);
            if (!channel) {
                throw new Error(`Channel not found: ${channelId}`);
            }

            const editOptions: any = {};
            const changes: string[] = [];

            // Basic properties
            if (options.name !== undefined) {
                if (options.name.length === 0 || options.name.length > 100) {
                    throw new Error(
                        "Channel name must be between 1 and 100 characters",
                    );
                }
                editOptions.name = options.name;
                changes.push(`name to "${options.name}"`);
            }

            if (options.topic !== undefined) {
                if (options.topic.length > 1024) {
                    throw new Error(
                        "Channel topic cannot exceed 1024 characters",
                    );
                }
                editOptions.topic = options.topic;
                changes.push(`topic to "${options.topic}"`);
            }

            // Rate limiting (slowmode)
            if (options.slowmode !== undefined) {
                if (options.slowmode < 0 || options.slowmode > 21600) {
                    throw new Error(
                        "Slowmode must be between 0 and 21600 seconds (6 hours)",
                    );
                }
                editOptions.rateLimitPerUser = options.slowmode;
                changes.push(`slowmode to ${options.slowmode}s`);
            }

            // Voice-specific options
            if (options.userLimit !== undefined) {
                if (
                    channel.type !== ChannelType.GuildVoice &&
                    channel.type !== ChannelType.GuildStageVoice
                ) {
                    throw new Error(
                        "User limit can only be set on voice and stage channels",
                    );
                }
                if (options.userLimit < 0 || options.userLimit > 99) {
                    throw new Error(
                        "User limit must be between 0 and 99 (0 = unlimited)",
                    );
                }
                editOptions.userLimit = options.userLimit;
                changes.push(
                    `user limit to ${options.userLimit === 0 ? "unlimited" : options.userLimit}`,
                );
            }

            if (options.bitrate !== undefined) {
                if (
                    channel.type !== ChannelType.GuildVoice &&
                    channel.type !== ChannelType.GuildStageVoice
                ) {
                    throw new Error(
                        "Bitrate can only be set on voice and stage channels",
                    );
                }
                const maxBitrate = guild.maximumBitrate || 64000;
                if (options.bitrate < 8000 || options.bitrate > maxBitrate) {
                    throw new Error(
                        `Bitrate must be between 8000 and ${maxBitrate} (server's maximum based on boost level)`,
                    );
                }
                editOptions.bitrate = options.bitrate;
                changes.push(`bitrate to ${options.bitrate}kbps`);
            }

            // Category change
            if (options.categoryId !== undefined) {
                if (options.categoryId === null) {
                    editOptions.parent = null;
                    changes.push("removed from category");
                } else {
                    const category = guild.channels.cache.get(
                        options.categoryId,
                    );
                    if (
                        !category ||
                        category.type !== ChannelType.GuildCategory
                    ) {
                        throw new Error("Category not found by categoryId");
                    }
                    editOptions.parent = category;
                    changes.push(`moved to category "${category.name}"`);
                }
            }

            // Apply basic edits
            if (Object.keys(editOptions).length > 0) {
                await channel.edit(editOptions);
            }

            // Handle privacy settings separately
            if (
                options.isPrivate !== undefined ||
                options.allowedRoles !== undefined
            ) {
                await this.configureChannelPrivacy(
                    channel,
                    options.isPrivate,
                    options.allowedRoles,
                    guild,
                );
                if (options.isPrivate) changes.push("made private");
                if (options.allowedRoles?.length)
                    changes.push(
                        `granted access to ${options.allowedRoles.length} role(s)`,
                    );
            }

            if (changes.length === 0) {
                return "No changes specified for channel edit";
            }

            return `Successfully edited channel "${channel.name}" (ID: ${channelId}). Changed: ${changes.join(", ")}`;
        } catch (error) {
            throw new Error(
                `Failed to edit channel: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    async setChannelPrivate(
        guildId: string | undefined,
        channelId: string,
        options: {
            isPrivate: boolean;
            allowedRoles?: string[];
            allowedMembers?: string[];
            syncToCategory?: boolean;
        },
    ): Promise<string> {
        this.ensureReady();
        const resolvedGuildId = this.resolveGuildId(guildId);

        const guild = this.client.guilds.cache.get(resolvedGuildId);
        if (!guild) {
            throw new Error("Discord server not found by guildId");
        }

        // Check bot permissions
        const botMember = guild.members.cache.get(this.client.user!.id);
        if (!botMember?.permissions.has(PermissionFlagsBits.ManageChannels)) {
            throw new Error("Bot doesn't have permission to manage channels");
        }

        try {
            const channel = guild.channels.cache.get(channelId);
            if (!channel) {
                throw new Error(`Channel not found: ${channelId}`);
            }

            const permissionOverwrites = [];
            const changes: string[] = [];

            if (options.isPrivate) {
                // Make private: deny @everyone access
                permissionOverwrites.push({
                    id: guild.id, // @everyone role
                    deny: [PermissionFlagsBits.ViewChannel],
                    type: 0, // Role type
                });
                changes.push("made private (denied @everyone access)");
            } else {
                // Make public: allow @everyone access
                permissionOverwrites.push({
                    id: guild.id, // @everyone role
                    allow: [PermissionFlagsBits.ViewChannel],
                    type: 0, // Role type
                });
                changes.push("made public (granted @everyone access)");
            }

            // Grant access to specific roles
            if (options.allowedRoles?.length) {
                for (const roleId of options.allowedRoles) {
                    const role = guild.roles.cache.get(roleId);
                    if (!role) {
                        throw new Error(`Role not found: ${roleId}`);
                    }

                    const permissions = [PermissionFlagsBits.ViewChannel];
                    // Add Connect permission for voice channels
                    if (
                        channel.type === ChannelType.GuildVoice ||
                        channel.type === ChannelType.GuildStageVoice
                    ) {
                        permissions.push(PermissionFlagsBits.Connect);
                    }

                    permissionOverwrites.push({
                        id: roleId,
                        allow: permissions,
                        type: 0, // Role type
                    });
                }
                changes.push(
                    `granted access to ${options.allowedRoles.length} role(s)`,
                );
            }

            // Grant access to specific members
            if (options.allowedMembers?.length) {
                for (const memberId of options.allowedMembers) {
                    const member = guild.members.cache.get(memberId);
                    if (!member) {
                        throw new Error(`Member not found: ${memberId}`);
                    }

                    const permissions = [PermissionFlagsBits.ViewChannel];
                    // Add Connect permission for voice channels
                    if (
                        channel.type === ChannelType.GuildVoice ||
                        channel.type === ChannelType.GuildStageVoice
                    ) {
                        permissions.push(PermissionFlagsBits.Connect);
                    }

                    permissionOverwrites.push({
                        id: memberId,
                        allow: permissions,
                        type: 1, // Member type
                    });
                }
                changes.push(
                    `granted access to ${options.allowedMembers.length} member(s)`,
                );
            }

            // Apply permission overwrites
            await (channel as any).permissionOverwrites.set(
                permissionOverwrites,
            );

            // Optionally sync to category
            if (options.syncToCategory && channel.parent) {
                try {
                    await (channel as any).lockPermissions();
                    changes.push("synced permissions with category");
                } catch (error) {
                    // Don't fail the whole operation if sync fails
                    changes.push("(failed to sync with category)");
                }
            }

            return `Successfully updated privacy for channel "${channel.name}" (ID: ${channelId}). Changes: ${changes.join(", ")}`;
        } catch (error) {
            throw new Error(
                `Failed to set channel privacy: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    async setCategoryPrivate(
        guildId: string | undefined,
        categoryId: string,
        options: {
            isPrivate: boolean;
            allowedRoles?: string[];
            allowedMembers?: string[];
            applyToChannels?: boolean;
        },
    ): Promise<string> {
        this.ensureReady();
        const resolvedGuildId = this.resolveGuildId(guildId);

        const guild = this.client.guilds.cache.get(resolvedGuildId);
        if (!guild) {
            throw new Error("Discord server not found by guildId");
        }

        // Check bot permissions
        const botMember = guild.members.cache.get(this.client.user!.id);
        if (!botMember?.permissions.has(PermissionFlagsBits.ManageChannels)) {
            throw new Error("Bot doesn't have permission to manage channels");
        }

        try {
            const category = guild.channels.cache.get(categoryId);
            if (!category || category.type !== ChannelType.GuildCategory) {
                throw new Error(
                    `Category not found or not a category: ${categoryId}`,
                );
            }

            const permissionOverwrites = [];
            const changes: string[] = [];

            if (options.isPrivate) {
                // Make private: deny @everyone access
                permissionOverwrites.push({
                    id: guild.id, // @everyone role
                    deny: [PermissionFlagsBits.ViewChannel],
                    type: 0, // Role type
                });
                changes.push("made private (denied @everyone access)");
            } else {
                // Make public: allow @everyone access
                permissionOverwrites.push({
                    id: guild.id, // @everyone role
                    allow: [PermissionFlagsBits.ViewChannel],
                    type: 0, // Role type
                });
                changes.push("made public (granted @everyone access)");
            }

            // Grant access to specific roles
            if (options.allowedRoles?.length) {
                for (const roleId of options.allowedRoles) {
                    const role = guild.roles.cache.get(roleId);
                    if (!role) {
                        throw new Error(`Role not found: ${roleId}`);
                    }

                    permissionOverwrites.push({
                        id: roleId,
                        allow: [
                            PermissionFlagsBits.ViewChannel,
                            PermissionFlagsBits.Connect,
                        ],
                        type: 0, // Role type
                    });
                }
                changes.push(
                    `granted access to ${options.allowedRoles.length} role(s)`,
                );
            }

            // Grant access to specific members
            if (options.allowedMembers?.length) {
                for (const memberId of options.allowedMembers) {
                    const member = guild.members.cache.get(memberId);
                    if (!member) {
                        throw new Error(`Member not found: ${memberId}`);
                    }

                    permissionOverwrites.push({
                        id: memberId,
                        allow: [
                            PermissionFlagsBits.ViewChannel,
                            PermissionFlagsBits.Connect,
                        ],
                        type: 1, // Member type
                    });
                }
                changes.push(
                    `granted access to ${options.allowedMembers.length} member(s)`,
                );
            }

            // Apply permission overwrites to category
            await category.permissionOverwrites.set(permissionOverwrites);

            // Optionally apply to all channels in category
            if (options.applyToChannels) {
                const channelsInCategory = guild.channels.cache.filter(
                    (ch) => ch.parentId === categoryId,
                );
                let syncedChannels = 0;

                for (const [, channel] of channelsInCategory) {
                    try {
                        await (channel as any).lockPermissions();
                        syncedChannels++;
                    } catch (error) {
                        // Continue with other channels if one fails
                    }
                }

                if (syncedChannels > 0) {
                    changes.push(
                        `applied to ${syncedChannels} channel(s) in category`,
                    );
                }
            }

            return `Successfully updated privacy for category "${category.name}" (ID: ${categoryId}). Changes: ${changes.join(", ")}`;
        } catch (error) {
            throw new Error(
                `Failed to set category privacy: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    async bulkSetPrivacy(
        guildId: string | undefined,
        targets: Array<{
            id: string;
            type: "channel" | "category";
            isPrivate: boolean;
            allowedRoles?: string[];
            allowedMembers?: string[];
        }>,
    ): Promise<string> {
        this.ensureReady();
        const resolvedGuildId = this.resolveGuildId(guildId);

        const guild = this.client.guilds.cache.get(resolvedGuildId);
        if (!guild) {
            throw new Error("Discord server not found by guildId");
        }

        // Check bot permissions
        const botMember = guild.members.cache.get(this.client.user!.id);
        if (!botMember?.permissions.has(PermissionFlagsBits.ManageChannels)) {
            throw new Error("Bot doesn't have permission to manage channels");
        }

        try {
            const results: string[] = [];
            let successCount = 0;
            let failureCount = 0;

            for (const target of targets) {
                try {
                    if (target.type === "channel") {
                        await this.setChannelPrivate(guildId, target.id, {
                            isPrivate: target.isPrivate,
                            allowedRoles: target.allowedRoles,
                            allowedMembers: target.allowedMembers,
                        });
                    } else if (target.type === "category") {
                        await this.setCategoryPrivate(guildId, target.id, {
                            isPrivate: target.isPrivate,
                            allowedRoles: target.allowedRoles,
                            allowedMembers: target.allowedMembers,
                        });
                    }
                    successCount++;
                } catch (error) {
                    failureCount++;
                    results.push(
                        `Failed ${target.type} ${target.id}: ${error instanceof Error ? error.message : String(error)}`,
                    );
                }
            }

            const summary = [`Successfully updated ${successCount} target(s)`];
            if (failureCount > 0) {
                summary.push(`${failureCount} failed`);
            }

            if (results.length > 0) {
                summary.push(`Errors: ${results.join("; ")}`);
            }

            return summary.join(". ");
        } catch (error) {
            throw new Error(
                `Failed bulk privacy update: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    async comprehensiveChannelManagement(
        guildId: string | undefined,
        operations: any[],
    ): Promise<string> {
        this.ensureReady();
        const resolvedGuildId = this.resolveGuildId(guildId);

        const guild = this.client.guilds.cache.get(resolvedGuildId);
        if (!guild) {
            throw new Error("Discord server not found by guildId");
        }

        const results: string[] = [];
        let successCount = 0;
        let failureCount = 0;

        for (let i = 0; i < operations.length; i++) {
            const operation = operations[i];
            const operationId = `Operation ${i + 1} (${operation.action})`;

            try {
                let result = "";

                switch (operation.action) {
                    case "create_text_channel":
                        result = await this.createTextChannel(
                            resolvedGuildId,
                            operation.name,
                            operation.categoryId,
                        );
                        break;

                    case "create_voice_channel":
                        result = await this.createVoiceChannel(
                            resolvedGuildId,
                            operation.name,
                            operation.categoryId,
                            operation.userLimit,
                            operation.bitrate,
                        );
                        break;

                    case "create_forum_channel":
                        result = await this.createForumChannel(
                            resolvedGuildId,
                            operation.name,
                            operation.categoryId,
                            {
                                topic: operation.topic,
                                slowmode: operation.slowmode,
                                defaultReactionEmoji:
                                    operation.defaultReactionEmoji,
                                isPrivate: operation.isPrivate,
                                allowedRoles: operation.allowedRoles,
                            },
                        );
                        break;

                    case "create_announcement_channel":
                        result = await this.createAnnouncementChannel(
                            resolvedGuildId,
                            operation.name,
                            operation.categoryId,
                            {
                                topic: operation.topic,
                                slowmode: operation.slowmode,
                                isPrivate: operation.isPrivate,
                                allowedRoles: operation.allowedRoles,
                            },
                        );
                        break;

                    case "create_stage_channel":
                        result = await this.createStageChannel(
                            resolvedGuildId,
                            operation.name,
                            operation.categoryId,
                            {
                                topic: operation.topic,
                                bitrate: operation.bitrate,
                                isPrivate: operation.isPrivate,
                                allowedRoles: operation.allowedRoles,
                            },
                        );
                        break;

                    case "create_category":
                        result = await this.createCategory(
                            resolvedGuildId,
                            operation.name,
                        );
                        break;

                    case "edit_channel_advanced":
                        if (!operation.channelId) {
                            throw new Error(
                                "channelId required for edit_channel_advanced",
                            );
                        }
                        result = await this.editChannelAdvanced(
                            resolvedGuildId,
                            operation.channelId,
                            {
                                name: operation.name,
                                topic: operation.topic,
                                slowmode: operation.slowmode,
                                userLimit: operation.userLimit,
                                bitrate: operation.bitrate,
                                isPrivate: operation.isPrivate,
                                allowedRoles: operation.allowedRoles,
                                categoryId: operation.categoryId,
                            },
                        );
                        break;

                    case "delete_channel":
                        if (!operation.channelId) {
                            throw new Error(
                                "channelId required for delete_channel",
                            );
                        }
                        result = await this.deleteChannel(
                            resolvedGuildId,
                            operation.channelId,
                        );
                        break;

                    case "delete_category":
                        if (!operation.targetCategoryId) {
                            throw new Error(
                                "targetCategoryId required for delete_category",
                            );
                        }
                        result = await this.deleteCategory(
                            resolvedGuildId,
                            operation.targetCategoryId,
                        );
                        break;

                    case "set_channel_position":
                        if (
                            !operation.channelId ||
                            operation.position === undefined
                        ) {
                            throw new Error(
                                "channelId and position required for set_channel_position",
                            );
                        }
                        result = await this.setChannelPosition(
                            resolvedGuildId,
                            operation.channelId,
                            operation.position,
                        );
                        break;

                    case "set_category_position":
                        if (
                            !operation.targetCategoryId ||
                            operation.position === undefined
                        ) {
                            throw new Error(
                                "targetCategoryId and position required for set_category_position",
                            );
                        }
                        result = await this.setCategoryPosition(
                            resolvedGuildId,
                            operation.targetCategoryId,
                            operation.position,
                        );
                        break;

                    case "move_channel_to_category":
                        if (!operation.channelId) {
                            throw new Error(
                                "channelId required for move_channel_to_category",
                            );
                        }
                        result = await this.moveChannelToCategory(
                            resolvedGuildId,
                            operation.channelId,
                            operation.categoryId,
                        );
                        break;

                    case "set_channel_private":
                        if (
                            !operation.channelId ||
                            operation.isPrivate === undefined
                        ) {
                            throw new Error(
                                "channelId and isPrivate required for set_channel_private",
                            );
                        }
                        result = await this.setChannelPrivate(
                            resolvedGuildId,
                            operation.channelId,
                            {
                                isPrivate: operation.isPrivate,
                                allowedRoles: operation.allowedRoles,
                                allowedMembers: operation.allowedMembers,
                                syncToCategory: operation.syncToCategory,
                            },
                        );
                        break;

                    case "set_category_private":
                        if (
                            !operation.targetCategoryId ||
                            operation.isPrivate === undefined
                        ) {
                            throw new Error(
                                "targetCategoryId and isPrivate required for set_category_private",
                            );
                        }
                        result = await this.setCategoryPrivate(
                            resolvedGuildId,
                            operation.targetCategoryId,
                            {
                                isPrivate: operation.isPrivate,
                                allowedRoles: operation.allowedRoles,
                                allowedMembers: operation.allowedMembers,
                                applyToChannels: operation.applyToChannels,
                            },
                        );
                        break;

                    default:
                        throw new Error(`Unknown action: ${operation.action}`);
                }

                results.push(`✅ ${operationId}: ${result}`);
                successCount++;
            } catch (error) {
                const errorMsg =
                    error instanceof Error ? error.message : String(error);
                results.push(`❌ ${operationId}: ${errorMsg}`);
                failureCount++;
            }
        }

        const summary = [
            `Comprehensive Channel Management completed: ${successCount} succeeded, ${failureCount} failed`,
            "",
            "Detailed Results:",
            ...results,
        ];

        return summary.join("\n");
    }

    async deleteChannel(
        guildId: string | undefined,
        channelId: string,
    ): Promise<string> {
        this.ensureReady();
        const resolvedGuildId = this.resolveGuildId(guildId);

        const guild = this.client.guilds.cache.get(resolvedGuildId);
        if (!guild) {
            throw new Error("Discord server not found by guildId");
        }

        const channel = guild.channels.cache.get(channelId);
        if (!channel) {
            throw new Error("Channel not found by channelId");
        }

        const channelType = ChannelType[channel.type];
        const channelName = channel.name;

        await channel.delete();
        return `Deleted ${channelType} channel: ${channelName}`;
    }

    async findChannel(
        guildId: string | undefined,
        channelName: string,
    ): Promise<string> {
        this.ensureReady();
        const resolvedGuildId = this.resolveGuildId(guildId);

        const guild = this.client.guilds.cache.get(resolvedGuildId);
        if (!guild) {
            throw new Error("Discord server not found by guildId");
        }

        const channels = guild.channels.cache.filter(
            (c) => c.name.toLowerCase() === channelName.toLowerCase(),
        );

        if (channels.size === 0) {
            throw new Error(`No channels found with name ${channelName}`);
        }

        if (channels.size > 1) {
            const channelList = channels
                .map(
                    (c) =>
                        `- ${ChannelType[c.type]} channel: ${c.name} (ID: ${c.id})`,
                )
                .join("\n");
            return `Retrieved ${channels.size} channels:\n${channelList}`;
        }

        const channel = channels.first()!;
        return `Retrieved ${ChannelType[channel.type]} channel: ${channel.name} (ID: ${channel.id})`;
    }

    async listChannels(guildId?: string): Promise<string> {
        this.ensureReady();
        const resolvedGuildId = this.resolveGuildId(guildId);

        const guild = this.client.guilds.cache.get(resolvedGuildId);
        if (!guild) {
            throw new Error("Discord server not found by guildId");
        }

        const channels = guild.channels.cache;
        if (channels.size === 0) {
            throw new Error("No channels found by guildId");
        }

        const channelList = channels
            .map(
                (c) =>
                    `- ${ChannelType[c.type]} channel: ${c.name} (ID: ${c.id})`,
            )
            .join("\n");

        return `Retrieved ${channels.size} channels:\n${channelList}`;
    }

    // Category Management Tools
    async createCategory(
        guildId: string | undefined,
        name: string,
    ): Promise<string> {
        this.ensureReady();
        const resolvedGuildId = this.resolveGuildId(guildId);

        const guild = this.client.guilds.cache.get(resolvedGuildId);
        if (!guild) {
            throw new Error("Discord server not found by guildId");
        }

        const category = await guild.channels.create({
            name,
            type: ChannelType.GuildCategory,
        });

        return `Created new category: ${category.name}`;
    }

    async deleteCategory(
        guildId: string | undefined,
        categoryId: string,
    ): Promise<string> {
        this.ensureReady();
        const resolvedGuildId = this.resolveGuildId(guildId);

        const guild = this.client.guilds.cache.get(resolvedGuildId);
        if (!guild) {
            throw new Error("Discord server not found by guildId");
        }

        const category = guild.channels.cache.get(
            categoryId,
        ) as CategoryChannel;
        if (!category || category.type !== ChannelType.GuildCategory) {
            throw new Error("Category not found by categoryId");
        }

        const categoryName = category.name;
        await category.delete();

        return `Deleted category: ${categoryName}`;
    }

    async findCategory(
        guildId: string | undefined,
        categoryName: string,
    ): Promise<string> {
        this.ensureReady();
        const resolvedGuildId = this.resolveGuildId(guildId);

        const guild = this.client.guilds.cache.get(resolvedGuildId);
        if (!guild) {
            throw new Error("Discord server not found by guildId");
        }

        const categories = guild.channels.cache.filter(
            (c) =>
                c.type === ChannelType.GuildCategory &&
                c.name.toLowerCase() === categoryName.toLowerCase(),
        );

        if (categories.size === 0) {
            throw new Error(`Category ${categoryName} not found`);
        }

        if (categories.size > 1) {
            const categoryList = categories
                .map((c) => `**${c.name}** - \`${c.id}\``)
                .join(", ");
            throw new Error(
                `Multiple channels found with name ${categoryName}.\nList: ${categoryList}.\nPlease specify the channel ID.`,
            );
        }

        const category = categories.first()!;
        return `Retrieved category: ${category.name}, with ID: ${category.id}`;
    }

    async listChannelsInCategory(
        guildId: string | undefined,
        categoryId: string,
    ): Promise<string> {
        this.ensureReady();
        const resolvedGuildId = this.resolveGuildId(guildId);

        const guild = this.client.guilds.cache.get(resolvedGuildId);
        if (!guild) {
            throw new Error("Discord server not found by guildId");
        }

        const category = guild.channels.cache.get(
            categoryId,
        ) as CategoryChannel;
        if (!category || category.type !== ChannelType.GuildCategory) {
            throw new Error("Category not found by categoryId");
        }

        const channels = category.children.cache;
        if (channels.size === 0) {
            throw new Error("Category not contains any channels");
        }

        const channelList = channels
            .map(
                (c) =>
                    `- ${ChannelType[c.type]} channel: ${c.name} (ID: ${c.id})`,
            )
            .join("\n");

        return `Retrieved ${channels.size} channels:\n${channelList}`;
    }

    // Webhook Management Tools
    async createWebhook(channelId: string, name: string): Promise<string> {
        this.ensureReady();

        const channel = this.client.channels.cache.get(
            channelId,
        ) as TextChannel;
        if (!channel || channel.type !== ChannelType.GuildText) {
            throw new Error("Channel not found by channelId");
        }

        const webhook = await channel.createWebhook({
            name,
        });

        return `Created ${name} webhook: ${webhook.url}`;
    }

    async deleteWebhook(webhookId: string): Promise<string> {
        this.ensureReady();

        const webhook = await this.client.fetchWebhook(webhookId);
        if (!webhook) {
            throw new Error("Webhook not found by webhookId");
        }

        const webhookName = webhook.name;
        await webhook.delete();

        return `Deleted ${webhookName} webhook`;
    }

    async listWebhooks(channelId: string): Promise<string> {
        this.ensureReady();

        const channel = this.client.channels.cache.get(
            channelId,
        ) as TextChannel;
        if (!channel || channel.type !== ChannelType.GuildText) {
            throw new Error("Channel not found by channelId");
        }

        const webhooks = await channel.fetchWebhooks();
        if (webhooks.size === 0) {
            throw new Error("No webhooks found");
        }

        const formattedWebhooks = webhooks.map(
            (w) => `- (ID: ${w.id}) **[${w.name}]** \`\`\`${w.url}\`\`\``,
        );

        return `**Retrieved ${formattedWebhooks.length} webhooks:** \n${formattedWebhooks.join("\n")}`;
    }

    async sendWebhookMessage(
        webhookUrl: string,
        message: string,
    ): Promise<string> {
        this.ensureReady();

        const webhookClient = new WebhookClient({ url: webhookUrl });
        const sentMessage = await webhookClient.send(message);

        // Webhook messages don't have a direct URL, so we return success
        return "Message sent successfully via webhook";
    }

    // Helper methods
    private formatMessages(messages: Message[]): string[] {
        return messages.map((m) => {
            const authorName = m.author.username;
            const timestamp = m.createdAt.toISOString();
            const content = m.content || "[No content]";
            const messageId = m.id;

            return `- (ID: ${messageId}) **[${authorName}]** \`${timestamp}\`: \`\`\`${content}\`\`\``;
        });
    }

    // Voice & Audio Tools
    async joinVoiceChannel(
        guildId: string,
        channelId: string,
    ): Promise<string> {
        this.ensureReady();
        const resolvedGuildId = this.resolveGuildId(guildId);

        const guild = this.client.guilds.cache.get(resolvedGuildId);
        if (!guild) {
            throw new Error("Discord server not found by guildId");
        }

        const channel = guild.channels.cache.get(channelId);
        if (
            !channel ||
            (channel.type !== ChannelType.GuildVoice &&
                channel.type !== ChannelType.GuildStageVoice)
        ) {
            throw new Error("Voice channel not found by channelId");
        }

        const voiceChannel = channel as VoiceChannel | StageChannel;

        try {
            const connection = joinVoiceChannel({
                channelId: voiceChannel.id,
                guildId: guild.id,
                adapterCreator: guild.voiceAdapterCreator,
            });

            // Store connection
            this.voiceConnections.set(guild.id, connection);

            // Create audio player for this guild if it doesn't exist
            if (!this.audioPlayers.has(guild.id)) {
                const player = createAudioPlayer();
                this.audioPlayers.set(guild.id, player);
                connection.subscribe(player);
            }

            return `Successfully joined voice channel: ${voiceChannel.name} in ${guild.name}`;
        } catch (error) {
            throw new Error(
                `Failed to join voice channel: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    async leaveVoiceChannel(
        guildId: string,
        channelId: string,
    ): Promise<string> {
        this.ensureReady();
        const resolvedGuildId = this.resolveGuildId(guildId);

        const connection = getVoiceConnection(resolvedGuildId);
        if (!connection) {
            throw new Error("No active voice connection in this server");
        }

        try {
            connection.destroy();
            this.voiceConnections.delete(resolvedGuildId);

            // Clean up audio player
            const player = this.audioPlayers.get(resolvedGuildId);
            if (player) {
                player.stop();
                this.audioPlayers.delete(resolvedGuildId);
            }

            return "Successfully left voice channel";
        } catch (error) {
            throw new Error(
                `Failed to leave voice channel: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    async playAudio(guildId: string, audioUrl: string): Promise<string> {
        this.ensureReady();
        const resolvedGuildId = this.resolveGuildId(guildId);

        const connection = this.voiceConnections.get(resolvedGuildId);
        if (!connection) {
            throw new Error(
                "Bot is not connected to a voice channel in this server",
            );
        }

        const player = this.audioPlayers.get(resolvedGuildId);
        if (!player) {
            throw new Error("Audio player not initialized for this server");
        }

        try {
            // Create audio resource from URL or file path
            const resource = createAudioResource(audioUrl);

            // Play the audio
            player.play(resource);

            // Wait for the player to become idle or error
            return new Promise((resolve, reject) => {
                player.once(AudioPlayerStatus.Playing, () => {
                    resolve(`Started playing audio from: ${audioUrl}`);
                });

                player.once("error", (error) => {
                    reject(new Error(`Audio playback error: ${error.message}`));
                });
            });
        } catch (error) {
            throw new Error(
                `Failed to play audio: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    async stopAudio(guildId: string): Promise<string> {
        this.ensureReady();
        const resolvedGuildId = this.resolveGuildId(guildId);

        const player = this.audioPlayers.get(resolvedGuildId);
        if (!player) {
            throw new Error("No audio player found for this server");
        }

        try {
            player.stop();
            return "Audio playback stopped";
        } catch (error) {
            throw new Error(
                `Failed to stop audio: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    async setVolume(guildId: string, volume: number): Promise<string> {
        this.ensureReady();
        const resolvedGuildId = this.resolveGuildId(guildId);

        // Note: Discord.js voice doesn't have built-in volume control
        // You would need to use a transformer stream or external library
        // For now, we'll return a message indicating this limitation

        const player = this.audioPlayers.get(resolvedGuildId);
        if (!player) {
            throw new Error("No audio player found for this server");
        }

        // This is a placeholder - actual volume control would require
        // additional implementation with audio transformers
        return `Volume control is not directly supported. Consider using audio processing libraries for volume adjustment. Requested volume: ${volume}%`;
    }

    async getVoiceConnections(): Promise<string> {
        this.ensureReady();

        if (this.voiceConnections.size === 0) {
            return "No active voice connections";
        }

        const connections: string[] = [];
        for (const [guildId, connection] of this.voiceConnections) {
            const guild = this.client.guilds.cache.get(guildId);
            if (guild) {
                const channelId = connection.joinConfig.channelId;
                const channel = guild.channels.cache.get(channelId || "");
                const channelName = channel ? channel.name : "Unknown Channel";
                const status = connection.state.status;
                connections.push(
                    `- ${guild.name}: ${channelName} (Status: ${status})`,
                );
            }
        }

        return `Active voice connections:\n${connections.join("\n")}`;
    }

    // Moderation Tools
    async unbanMember(
        userId: string,
        guildId?: string,
        reason?: string,
    ): Promise<string> {
        this.ensureReady();
        this.validateUserTokenOperation("unbanMember");
        const resolvedGuildId = this.resolveGuildId(guildId);

        const guild = this.client.guilds.cache.get(resolvedGuildId);
        if (!guild) {
            throw new Error("Discord server not found by guildId");
        }

        // Check bot permissions
        const botMember = guild.members.cache.get(this.client.user!.id);
        if (!botMember?.permissions.has(PermissionFlagsBits.BanMembers)) {
            throw new Error("Bot doesn't have permission to ban members");
        }

        try {
            const member = await guild.members.fetch(userId).catch(() => null);
            const username = member ? member.user.username : userId;

            await guild.bans.create(userId, {
                reason: reason || "No reason provided",
                deleteMessageSeconds: 0,
            });

            return `Successfully banned user ${username} (ID: ${userId}) from ${guild.name}. Reason: ${reason || "No reason provided"}`;
        } catch (error) {
            throw new Error(
                `Failed to ban member: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    async kickMember(
        userId: string,
        guildId?: string,
        reason?: string,
    ): Promise<string> {
        this.ensureReady();
        const resolvedGuildId = this.resolveGuildId(guildId);

        const guild = this.client.guilds.cache.get(resolvedGuildId);
        if (!guild) {
            throw new Error("Discord server not found by guildId");
        }

        // Check bot permissions
        const botMember = guild.members.cache.get(this.client.user!.id);
        if (!botMember?.permissions.has(PermissionFlagsBits.KickMembers)) {
            throw new Error("Bot doesn't have permission to kick members");
        }

        try {
            const member = await guild.members.fetch(userId);
            if (!member) {
                throw new Error("Member not found in this server");
            }

            // Check if bot can kick this member (role hierarchy)
            if (!member.kickable) {
                throw new Error(
                    "Cannot kick this member (insufficient permissions or role hierarchy)",
                );
            }

            await member.kick(reason || "No reason provided");

            return `Successfully kicked ${member.user.username} (ID: ${userId}) from ${guild.name}. Reason: ${reason || "No reason provided"}`;
        } catch (error) {
            throw new Error(
                `Failed to kick member: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    async timeoutMember(
        userId: string,
        duration: number,
        guildId?: string,
        reason?: string,
    ): Promise<string> {
        this.ensureReady();
        this.validateUserTokenOperation("timeoutMember");
        const resolvedGuildId = this.resolveGuildId(guildId);

        const guild = this.client.guilds.cache.get(resolvedGuildId);
        if (!guild) {
            throw new Error("Discord server not found by guildId");
        }

        // Check bot permissions
        const botMember = guild.members.cache.get(this.client.user!.id);
        if (!botMember?.permissions.has(PermissionFlagsBits.ModerateMembers)) {
            throw new Error("Bot doesn't have permission to timeout members");
        }

        try {
            const member = await guild.members.fetch(userId);
            if (!member) {
                throw new Error("Member not found in this server");
            }

            // Check if bot can timeout this member (role hierarchy)
            if (!member.moderatable) {
                throw new Error(
                    "Cannot timeout this member (insufficient permissions or role hierarchy)",
                );
            }

            // Discord timeout duration is in milliseconds
            const timeoutDuration = duration * 60 * 1000; // Convert minutes to milliseconds
            const maxTimeout = 28 * 24 * 60 * 60 * 1000; // 28 days in milliseconds

            if (timeoutDuration > maxTimeout) {
                throw new Error("Timeout duration cannot exceed 28 days");
            }

            await member.timeout(
                timeoutDuration,
                reason || "No reason provided",
            );

            return `Successfully timed out ${member.user.username} (ID: ${userId}) for ${duration} minutes. Reason: ${reason || "No reason provided"}`;
        } catch (error) {
            throw new Error(
                `Failed to timeout member: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    async removeTimeout(
        userId: string,
        guildId?: string,
        reason?: string,
    ): Promise<string> {
        this.ensureReady();
        this.validateUserTokenOperation("removeTimeout");
        const resolvedGuildId = this.resolveGuildId(guildId);

        const guild = this.client.guilds.cache.get(resolvedGuildId);
        if (!guild) {
            throw new Error("Discord server not found by guildId");
        }

        // Check bot permissions
        const botMember = guild.members.cache.get(this.client.user!.id);
        if (!botMember?.permissions.has(PermissionFlagsBits.ModerateMembers)) {
            throw new Error("Bot doesn't have permission to remove timeouts");
        }

        try {
            const member = await guild.members.fetch(userId);
            if (!member) {
                throw new Error("Member not found in this server");
            }

            // Check if member is actually timed out
            if (!member.isCommunicationDisabled()) {
                throw new Error("Member is not currently timed out");
            }

            await member.timeout(null, reason || "Timeout removed");

            return `Successfully removed timeout for ${member.user.username} (ID: ${userId}). Reason: ${reason || "Timeout removed"}`;
        } catch (error) {
            throw new Error(
                `Failed to remove timeout: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    async getAuditLogs(
        guildId: string | undefined,
        limit?: number,
    ): Promise<string> {
        this.ensureReady();
        const resolvedGuildId = this.resolveGuildId(guildId);

        const guild = this.client.guilds.cache.get(resolvedGuildId);
        if (!guild) {
            throw new Error("Discord server not found by guildId");
        }

        // Check bot permissions
        const botMember = guild.members.cache.get(this.client.user!.id);
        if (!botMember?.permissions.has(PermissionFlagsBits.ViewAuditLog)) {
            throw new Error("Bot doesn't have permission to view audit logs");
        }

        try {
            const auditLogs = await guild.fetchAuditLogs({
                limit: limit || 50,
            });

            const formattedLogs = auditLogs.entries.map((entry) => {
                const actionType = AuditLogEvent[entry.action];
                const executor = entry.executor?.username || "Unknown";
                const target = entry.target;
                const targetName =
                    target && "username" in target
                        ? target.username
                        : target && "name" in target
                          ? target.name
                          : target && "id" in target
                            ? `ID: ${target.id}`
                            : "Unknown";
                const timestamp = entry.createdAt.toISOString();
                const reason = entry.reason || "No reason provided";

                return `- [${timestamp}] **${actionType}** by ${executor} on ${targetName} - Reason: ${reason}`;
            });

            return `**Retrieved ${formattedLogs.length} audit log entries:**\n${formattedLogs.join("\n")}`;
        } catch (error) {
            throw new Error(
                `Failed to fetch audit logs: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    async getBans(guildId: string | undefined): Promise<string> {
        this.ensureReady();
        const resolvedGuildId = this.resolveGuildId(guildId);

        const guild = this.client.guilds.cache.get(resolvedGuildId);
        if (!guild) {
            throw new Error("Discord server not found by guildId");
        }

        // Check bot permissions
        const botMember = guild.members.cache.get(this.client.user!.id);
        if (!botMember?.permissions.has(PermissionFlagsBits.BanMembers)) {
            throw new Error("Bot doesn't have permission to view bans");
        }

        try {
            const bans = await guild.bans.fetch();

            if (bans.size === 0) {
                return "No bans found in this server";
            }

            const formattedBans = bans.map((ban: GuildBan) => {
                const reason = ban.reason || "No reason provided";
                return `- **${ban.user.username}** (ID: ${ban.user.id}) - Reason: ${reason}`;
            });

            return `**Retrieved ${formattedBans.length} bans:**\n${formattedBans.join("\n")}`;
        } catch (error) {
            throw new Error(
                `Failed to fetch bans: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    // Role Management Tools
    async createRole(
        name: string,
        guildId?: string,
        color?: string,
        permissions?: string[],
    ): Promise<string> {
        this.ensureReady();
        this.validateUserTokenOperation("createRole");
        const resolvedGuildId = this.resolveGuildId(guildId);

        const guild = this.client.guilds.cache.get(resolvedGuildId);
        if (!guild) {
            throw new Error("Discord server not found by guildId");
        }

        // Check bot permissions
        const botMember = guild.members.cache.get(this.client.user!.id);
        if (!botMember?.permissions.has(PermissionFlagsBits.ManageRoles)) {
            throw new Error("Bot doesn't have permission to manage roles");
        }

        try {
            const roleOptions: any = {
                name,
                mentionable: true,
            };

            // Set color if provided
            if (color) {
                roleOptions.color = color as ColorResolvable;
            }

            // Set permissions if provided
            if (permissions && permissions.length > 0) {
                const permissionBits = [];
                for (const perm of permissions) {
                    if (perm in PermissionFlagsBits) {
                        permissionBits.push(
                            PermissionFlagsBits[
                                perm as keyof typeof PermissionFlagsBits
                            ],
                        );
                    }
                }
                if (permissionBits.length > 0) {
                    roleOptions.permissions = permissionBits;
                }
            }

            const role = await guild.roles.create(roleOptions);

            return `Successfully created role: ${role.name} (ID: ${role.id}) with color ${role.hexColor}`;
        } catch (error) {
            throw new Error(
                `Failed to create role: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    async deleteRole(roleId: string, guildId?: string): Promise<string> {
        this.ensureReady();
        this.validateUserTokenOperation("deleteRole");
        const resolvedGuildId = this.resolveGuildId(guildId);

        const guild = this.client.guilds.cache.get(resolvedGuildId);
        if (!guild) {
            throw new Error("Discord server not found by guildId");
        }

        // Check bot permissions
        const botMember = guild.members.cache.get(this.client.user!.id);
        if (!botMember?.permissions.has(PermissionFlagsBits.ManageRoles)) {
            throw new Error("Bot doesn't have permission to manage roles");
        }

        try {
            const role = guild.roles.cache.get(roleId);
            if (!role) {
                throw new Error("Role not found by roleId");
            }

            // Check role hierarchy
            const botHighestRole = botMember.roles.highest;
            if (role.position >= botHighestRole.position) {
                throw new Error(
                    "Cannot delete this role (insufficient permissions or role hierarchy)",
                );
            }

            const roleName = role.name;
            await role.delete();

            return `Successfully deleted role: ${roleName} (ID: ${roleId})`;
        } catch (error) {
            throw new Error(
                `Failed to delete role: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    async editRole(
        roleId: string,
        guildId?: string,
        name?: string,
        color?: string,
        permissions?: string[],
    ): Promise<string> {
        this.ensureReady();
        this.validateUserTokenOperation("editRole");
        const resolvedGuildId = this.resolveGuildId(guildId);

        const guild = this.client.guilds.cache.get(resolvedGuildId);
        if (!guild) {
            throw new Error("Discord server not found by guildId");
        }

        // Check bot permissions
        const botMember = guild.members.cache.get(this.client.user!.id);
        if (!botMember?.permissions.has(PermissionFlagsBits.ManageRoles)) {
            throw new Error("Bot doesn't have permission to manage roles");
        }

        try {
            const role = guild.roles.cache.get(roleId);
            if (!role) {
                throw new Error(`Role not found: ${roleId}`);
            }

            // Cannot edit @everyone role
            if (role.id === guild.id) {
                throw new Error("Cannot edit @everyone role");
            }

            // Check role hierarchy - bot cannot edit roles at or above its highest role
            const botHighestRole = botMember.roles.highest;
            if (
                role.position >= botHighestRole.position &&
                role.id !== botMember.roles.highest.id
            ) {
                throw new Error(
                    `Cannot edit role "${role.name}" (position ${role.position}) - bot's highest role "${botHighestRole.name}" is at position ${botHighestRole.position}. Bot can only edit roles below its highest role.`,
                );
            }

            const editOptions: any = {};
            const changes: string[] = [];

            // Validate and set name
            if (name !== undefined) {
                if (name.length === 0 || name.length > 100) {
                    throw new Error(
                        "Role name must be between 1 and 100 characters",
                    );
                }
                editOptions.name = name;
                changes.push(`name to "${name}"`);
            }

            // Validate and set color
            if (color !== undefined) {
                // Handle different color formats
                let validColor = color;
                if (
                    color.toLowerCase() === "default" ||
                    color.toLowerCase() === "none"
                ) {
                    validColor = "#000000"; // Default color
                } else if (color.startsWith("#")) {
                    // Validate hex color
                    if (!/^#[0-9A-F]{6}$/i.test(color)) {
                        throw new Error(
                            `Invalid hex color format: ${color}. Use format #RRGGBB (e.g., #FF0000 for red)`,
                        );
                    }
                    validColor = color;
                } else if (/^[0-9A-F]{6}$/i.test(color)) {
                    // Add # if missing
                    validColor = `#${color}`;
                } else {
                    throw new Error(
                        `Invalid color format: ${color}. Use hex format #RRGGBB or 'default'`,
                    );
                }

                editOptions.color = validColor as ColorResolvable;
                changes.push(`color to ${validColor}`);
            }

            // Validate and set permissions
            if (permissions !== undefined && permissions.length > 0) {
                const permissionBits = [];
                const invalidPermissions = [];

                for (const perm of permissions) {
                    if (perm in PermissionFlagsBits) {
                        permissionBits.push(
                            PermissionFlagsBits[
                                perm as keyof typeof PermissionFlagsBits
                            ],
                        );
                    } else {
                        invalidPermissions.push(perm);
                    }
                }

                if (invalidPermissions.length > 0) {
                    const validPermissions = Object.keys(PermissionFlagsBits)
                        .slice(0, 10)
                        .join(", "); // Show first 10
                    throw new Error(
                        `Invalid permissions: ${invalidPermissions.join(", ")}. Valid permissions include: ${validPermissions}... (use get_roles to see all permissions)`,
                    );
                }

                if (permissionBits.length > 0) {
                    editOptions.permissions = permissionBits;
                    changes.push(
                        `permissions (${permissions.length} permissions set)`,
                    );
                }
            }

            if (Object.keys(editOptions).length === 0) {
                return "No changes specified for role edit";
            }

            const updatedRole = await role.edit(editOptions);

            return `Successfully edited role "${updatedRole.name}" (ID: ${roleId}). Changed: ${changes.join(", ")}`;
        } catch (error) {
            throw new Error(
                `Failed to edit role: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    async addRoleToMember(
        userId: string,
        roleId: string,
        guildId?: string,
    ): Promise<string> {
        this.ensureReady();
        this.validateUserTokenOperation("addRoleToMember");
        const resolvedGuildId = this.resolveGuildId(guildId);

        const guild = this.client.guilds.cache.get(resolvedGuildId);
        if (!guild) {
            throw new Error("Discord server not found by guildId");
        }

        // Check bot permissions
        const botMember = guild.members.cache.get(this.client.user!.id);
        if (!botMember?.permissions.has(PermissionFlagsBits.ManageRoles)) {
            throw new Error("Bot doesn't have permission to manage roles");
        }

        try {
            const member = await guild.members.fetch(userId);
            if (!member) {
                throw new Error("Member not found in this server");
            }

            const role = guild.roles.cache.get(roleId);
            if (!role) {
                throw new Error("Role not found by roleId");
            }

            // Check role hierarchy
            const botHighestRole = botMember.roles.highest;
            if (role.position >= botHighestRole.position) {
                throw new Error(
                    "Cannot assign this role (insufficient permissions or role hierarchy)",
                );
            }

            // Check if member already has the role
            if (member.roles.cache.has(roleId)) {
                return `Member ${member.user.username} already has the role ${role.name}`;
            }

            await member.roles.add(role);

            return `Successfully added role ${role.name} to ${member.user.username} (ID: ${userId})`;
        } catch (error) {
            throw new Error(
                `Failed to add role to member: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    async removeRoleFromMember(
        userId: string,
        roleId: string,
        guildId?: string,
    ): Promise<string> {
        this.ensureReady();
        this.validateUserTokenOperation("removeRoleFromMember");
        const resolvedGuildId = this.resolveGuildId(guildId);

        const guild = this.client.guilds.cache.get(resolvedGuildId);
        if (!guild) {
            throw new Error("Discord server not found by guildId");
        }

        // Check bot permissions
        const botMember = guild.members.cache.get(this.client.user!.id);
        if (!botMember?.permissions.has(PermissionFlagsBits.ManageRoles)) {
            throw new Error("Bot doesn't have permission to manage roles");
        }

        try {
            const member = await guild.members.fetch(userId);
            if (!member) {
                throw new Error("Member not found in this server");
            }

            const role = guild.roles.cache.get(roleId);
            if (!role) {
                throw new Error("Role not found by roleId");
            }

            // Check role hierarchy
            const botHighestRole = botMember.roles.highest;
            if (role.position >= botHighestRole.position) {
                throw new Error(
                    "Cannot remove this role (insufficient permissions or role hierarchy)",
                );
            }

            // Check if member has the role
            if (!member.roles.cache.has(roleId)) {
                return `Member ${member.user.username} doesn't have the role ${role.name}`;
            }

            await member.roles.remove(role);

            return `Successfully removed role ${role.name} from ${member.user.username} (ID: ${userId})`;
        } catch (error) {
            throw new Error(
                `Failed to remove role from member: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    async getRoles(guildId: string | undefined): Promise<string> {
        this.ensureReady();
        const resolvedGuildId = this.resolveGuildId(guildId);

        const guild = this.client.guilds.cache.get(resolvedGuildId);
        if (!guild) {
            throw new Error("Discord server not found by guildId");
        }

        try {
            // Get the bot's highest role for permission context
            const botMember = guild.members.cache.get(this.client.user!.id);
            const botHighestRole = botMember?.roles.highest;
            const hasManageRoles = botMember?.permissions.has(
                PermissionFlagsBits.ManageRoles,
            );

            const roles = guild.roles.cache.sort(
                (a, b) => b.position - a.position,
            );

            if (roles.size === 0) {
                return "No roles found in this server";
            }

            const formattedRoles = roles.map((role: Role) => {
                const memberCount = role.members.size;
                const isManageable =
                    botHighestRole &&
                    role.position < botHighestRole.position &&
                    role.id !== guild.id;
                const isEveryone = role.id === guild.id;
                const permissions =
                    role.permissions.toArray().join(", ") || "None";

                return `- **${role.name}** (ID: \`${role.id}\`)
  - Color: ${role.hexColor}
  - Position: ${role.position}
  - Members: ${memberCount}
  - Mentionable: ${role.mentionable ? "Yes" : "No"}
  - Hoisted: ${role.hoist ? "Yes" : "No"}
  - Special: ${isEveryone ? "@everyone role" : "Regular role"}
  - Bot can reposition: ${isManageable && hasManageRoles ? "✅ Yes" : "❌ No"}${!isManageable && !isEveryone ? ` (${role.position >= (botHighestRole?.position || 0) ? "higher/equal position" : "permission issue"})` : ""}`;
            });

            return `📋 **Roles in ${guild.name}** (${formattedRoles.length} total)

🤖 **Bot Status:**
- Bot's highest role: **${botHighestRole?.name}** (Position: ${botHighestRole?.position})
- Has "Manage Roles" permission: ${hasManageRoles ? "✅ Yes" : "❌ No"}

📝 **Role Positioning Rules:**
- Bot can only move roles **below** its highest role
- @everyone role cannot be repositioned
- Positions are 0-based (0 = bottom, higher number = top)

🎭 **Server Roles:**

${formattedRoles.join("\n\n")}`;
        } catch (error) {
            throw new Error(
                `Failed to fetch roles: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    async setRolePositions(
        guildId: string | undefined,
        rolePositions: Array<{ roleId: string; position: number }>,
    ): Promise<string> {
        this.ensureReady();
        const resolvedGuildId = this.resolveGuildId(guildId);

        const guild = this.client.guilds.cache.get(resolvedGuildId);
        if (!guild) {
            throw new Error("Discord server not found by guildId");
        }

        // Check bot permissions
        const botMember = guild.members.cache.get(this.client.user!.id);
        if (!botMember?.permissions.has(PermissionFlagsBits.ManageRoles)) {
            throw new Error("Bot doesn't have permission to manage roles");
        }

        try {
            const botHighestRole = botMember.roles.highest;
            const positionChanges: Array<{ role: Role; position: number }> = [];

            // Validate all roles and positions
            for (const { roleId, position } of rolePositions) {
                const role = guild.roles.cache.get(roleId);
                if (!role) {
                    throw new Error(`Role not found: ${roleId}`);
                }

                // Skip @everyone role (it cannot be repositioned)
                if (role.id === guild.id) {
                    throw new Error(`Cannot reposition @everyone role`);
                }

                // Check role hierarchy - bot cannot move roles at or above its highest role
                if (
                    role.position >= botHighestRole.position &&
                    role.id !== botMember.roles.highest.id
                ) {
                    throw new Error(
                        `Cannot reposition role "${role.name}" (position ${role.position}) - bot's highest role "${botHighestRole.name}" is at position ${botHighestRole.position}. Bot can only move roles below its highest role.`,
                    );
                }

                // Validate position is reasonable (Discord roles are 1-indexed, but we accept 0-based)
                if (position < 0) {
                    throw new Error(
                        `Invalid position ${position} for role ${role.name}. Position must be 0 or higher.`,
                    );
                }

                positionChanges.push({ role, position });
            }

            if (positionChanges.length === 0) {
                return "No roles to reposition";
            }

            // Apply position changes using the correct format for Discord.js
            await guild.roles.setPositions(positionChanges);

            const changedRoles = positionChanges
                .map(
                    ({ role, position }) =>
                        `${role.name} (${role.id}) to position ${position}`,
                )
                .join(", ");

            return `Successfully updated ${positionChanges.length} role positions: ${changedRoles}`;
        } catch (error) {
            throw new Error(
                `Failed to set role positions: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    // Channel Management Tools
    async setChannelPosition(
        guildId: string | undefined,
        channelId: string,
        position: number,
    ): Promise<string> {
        this.ensureReady();
        const resolvedGuildId = this.resolveGuildId(guildId);

        const guild = this.client.guilds.cache.get(resolvedGuildId);
        if (!guild) {
            throw new Error("Guild not found");
        }

        // Check bot permissions
        const botMember = guild.members.cache.get(this.client.user!.id);
        if (!botMember?.permissions.has(PermissionFlagsBits.ManageChannels)) {
            throw new Error("Bot doesn't have permission to manage channels");
        }

        try {
            const channel = guild.channels.cache.get(channelId);
            if (!channel) {
                throw new Error("Channel not found in this guild");
            }

            // Cast to a channel type that supports setPosition
            const editableChannel = channel as any;
            if (typeof editableChannel.setPosition !== "function") {
                throw new Error(
                    "Channel type does not support position changes",
                );
            }

            await editableChannel.setPosition(position);

            return `Successfully moved channel "${channel.name}" to position ${position}`;
        } catch (error) {
            throw new Error(
                `Failed to set channel position: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    async setChannelPositions(
        guildId: string | undefined,
        channelPositions: Array<{ channelId: string; position: number }>,
    ): Promise<string> {
        this.ensureReady();
        const resolvedGuildId = this.resolveGuildId(guildId);

        const guild = this.client.guilds.cache.get(resolvedGuildId);
        if (!guild) {
            throw new Error("Guild not found");
        }

        // Check bot permissions
        const botMember = guild.members.cache.get(this.client.user!.id);
        if (!botMember?.permissions.has(PermissionFlagsBits.ManageChannels)) {
            throw new Error("Bot doesn't have permission to manage channels");
        }

        try {
            const positionChanges: Array<{ channel: any; position: number }> =
                [];

            // Validate all channels and positions
            for (const { channelId, position } of channelPositions) {
                const channel = guild.channels.cache.get(channelId);
                if (!channel) {
                    throw new Error(
                        `Channel with ID ${channelId} not found in this guild`,
                    );
                }

                positionChanges.push({ channel, position });
            }

            // Apply position changes
            await guild.channels.setPositions(positionChanges);

            const changedChannels = positionChanges
                .map(
                    ({ channel, position }) =>
                        `${channel.name} to position ${position}`,
                )
                .join(", ");

            return `Successfully updated channel positions: ${changedChannels}`;
        } catch (error) {
            throw new Error(
                `Failed to set channel positions: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    async moveChannelToCategory(
        guildId: string | undefined,
        channelId: string,
        categoryId: string | null,
    ): Promise<string> {
        this.ensureReady();
        const resolvedGuildId = this.resolveGuildId(guildId);

        const guild = this.client.guilds.cache.get(resolvedGuildId);
        if (!guild) {
            throw new Error("Guild not found");
        }

        // Check bot permissions
        const botMember = guild.members.cache.get(this.client.user!.id);
        if (!botMember?.permissions.has(PermissionFlagsBits.ManageChannels)) {
            throw new Error("Bot doesn't have permission to manage channels");
        }

        try {
            const channel = guild.channels.cache.get(channelId);
            if (!channel) {
                throw new Error("Channel not found in this guild");
            }

            let category = null;
            if (categoryId) {
                category = guild.channels.cache.get(categoryId);
                if (!category || category.type !== ChannelType.GuildCategory) {
                    throw new Error(
                        "Category not found or invalid category type",
                    );
                }
            }

            const editableChannel = channel as any;
            if (typeof editableChannel.setParent !== "function") {
                throw new Error(
                    "Channel type does not support category assignment",
                );
            }

            await editableChannel.setParent(categoryId);

            const action = categoryId
                ? `moved to category "${category?.name}"`
                : "removed from category";
            return `Successfully ${action} channel "${channel.name}"`;
        } catch (error) {
            throw new Error(
                `Failed to move channel to category: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    async setCategoryPosition(
        guildId: string | undefined,
        categoryId: string,
        position: number,
    ): Promise<string> {
        this.ensureReady();
        const resolvedGuildId = this.resolveGuildId(guildId);

        const guild = this.client.guilds.cache.get(resolvedGuildId);
        if (!guild) {
            throw new Error("Guild not found");
        }

        // Check bot permissions
        const botMember = guild.members.cache.get(this.client.user!.id);
        if (!botMember?.permissions.has(PermissionFlagsBits.ManageChannels)) {
            throw new Error("Bot doesn't have permission to manage channels");
        }

        try {
            const category = guild.channels.cache.get(categoryId);
            if (!category || category.type !== ChannelType.GuildCategory) {
                throw new Error("Category not found or not a category channel");
            }

            await category.setPosition(position);

            return `Successfully moved category "${category.name}" to position ${position}`;
        } catch (error) {
            throw new Error(
                `Failed to set category position: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    async organizeChannels(
        guildId: string | undefined,
        organization: {
            categories?: Array<{ categoryId: string; position: number }>;
            channels?: Array<{
                channelId: string;
                position?: number;
                categoryId?: string | null;
            }>;
        },
    ): Promise<string> {
        this.ensureReady();
        const resolvedGuildId = this.resolveGuildId(guildId);

        const guild = this.client.guilds.cache.get(resolvedGuildId);
        if (!guild) {
            throw new Error("Guild not found");
        }

        // Check bot permissions
        const botMember = guild.members.cache.get(this.client.user!.id);
        if (!botMember?.permissions.has(PermissionFlagsBits.ManageChannels)) {
            throw new Error("Bot doesn't have permission to manage channels");
        }

        try {
            const results: string[] = [];

            // First, organize categories
            if (organization.categories && organization.categories.length > 0) {
                const categoryChanges: Array<{
                    channel: any;
                    position: number;
                }> = [];

                for (const {
                    categoryId,
                    position,
                } of organization.categories) {
                    const category = guild.channels.cache.get(categoryId);
                    if (
                        !category ||
                        category.type !== ChannelType.GuildCategory
                    ) {
                        throw new Error(
                            `Category with ID ${categoryId} not found or not a category`,
                        );
                    }
                    categoryChanges.push({ channel: category, position });
                }

                if (categoryChanges.length > 0) {
                    await guild.channels.setPositions(categoryChanges);
                    results.push(
                        `Repositioned ${categoryChanges.length} categories`,
                    );
                }
            }

            // Then, organize channels (move to categories and set positions)
            if (organization.channels && organization.channels.length > 0) {
                let movedToCategories = 0;
                let repositioned = 0;

                for (const {
                    channelId,
                    position,
                    categoryId,
                } of organization.channels) {
                    const channel = guild.channels.cache.get(channelId);
                    if (!channel) {
                        throw new Error(
                            `Channel with ID ${channelId} not found`,
                        );
                    }

                    const editableChannel = channel as any;

                    // Move to category if specified
                    if (categoryId !== undefined) {
                        if (
                            categoryId &&
                            !guild.channels.cache.get(categoryId)
                        ) {
                            throw new Error(
                                `Category with ID ${categoryId} not found`,
                            );
                        }

                        if (typeof editableChannel.setParent === "function") {
                            await editableChannel.setParent(categoryId);
                            movedToCategories++;
                        }
                    }

                    // Set position if specified
                    if (position !== undefined) {
                        if (typeof editableChannel.setPosition === "function") {
                            await editableChannel.setPosition(position);
                            repositioned++;
                        }
                    }
                }

                if (movedToCategories > 0) {
                    results.push(
                        `Moved ${movedToCategories} channels to new categories`,
                    );
                }
                if (repositioned > 0) {
                    results.push(`Repositioned ${repositioned} channels`);
                }
            }

            return `Successfully organized server: ${results.join(", ")}`;
        } catch (error) {
            throw new Error(
                `Failed to organize channels: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    async getChannelStructure(guildId: string | undefined): Promise<string> {
        this.ensureReady();
        const resolvedGuildId = this.resolveGuildId(guildId);

        const guild = this.client.guilds.cache.get(resolvedGuildId);
        if (!guild) {
            throw new Error("Guild not found");
        }

        try {
            const channels = guild.channels.cache
                .filter((channel) => {
                    // Only include channels that have a position property
                    const channelWithPosition = channel as any;
                    return channelWithPosition.position !== undefined;
                })
                .sort((a, b) => {
                    const aPos = (a as any).position || 0;
                    const bPos = (b as any).position || 0;
                    return aPos - bPos;
                });

            const structure: string[] = [];
            const categories = new Map();
            const orphanChannels: any[] = [];

            // Group channels by category
            channels.forEach((channel) => {
                if (channel.type === ChannelType.GuildCategory) {
                    categories.set(channel.id, {
                        category: channel,
                        channels: [],
                    });
                } else if (channel.parent) {
                    if (!categories.has(channel.parent.id)) {
                        categories.set(channel.parent.id, {
                            category: channel.parent,
                            channels: [],
                        });
                    }
                    categories.get(channel.parent.id).channels.push(channel);
                } else {
                    orphanChannels.push(channel);
                }
            });

            // Build structure string
            structure.push(`📋 **Channel Structure for ${guild.name}**\n`);

            // Show orphan channels first (channels not in any category)
            if (orphanChannels.length > 0) {
                structure.push("🔸 **Uncategorized Channels:**");
                orphanChannels.forEach((channel) => {
                    const emoji = this.getChannelEmoji(channel.type);
                    const position = (channel as any).position || 0;
                    structure.push(
                        `  ${emoji} ${channel.name} (ID: ${channel.id}, Position: ${position})`,
                    );
                });
                structure.push("");
            }

            // Show categories and their channels
            const sortedCategories = Array.from(categories.values()).sort(
                (a, b) => {
                    const aPos = (a.category as any).position || 0;
                    const bPos = (b.category as any).position || 0;
                    return aPos - bPos;
                },
            );

            sortedCategories.forEach(
                ({ category, channels: categoryChannels }) => {
                    const categoryPosition = (category as any).position || 0;
                    structure.push(
                        `📁 **${category.name}** (ID: ${category.id}, Position: ${categoryPosition})`,
                    );

                    const sortedChannels = categoryChannels.sort(
                        (a: any, b: any) => {
                            const aPos = a.position || 0;
                            const bPos = b.position || 0;
                            return aPos - bPos;
                        },
                    );
                    sortedChannels.forEach((channel: any) => {
                        const emoji = this.getChannelEmoji(channel.type);
                        const position = channel.position || 0;
                        structure.push(
                            `  ${emoji} ${channel.name} (ID: ${channel.id}, Position: ${position})`,
                        );
                    });
                    structure.push("");
                },
            );

            return structure.join("\n");
        } catch (error) {
            throw new Error(
                `Failed to get channel structure: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    private getChannelEmoji(channelType: ChannelType): string {
        switch (channelType) {
            case ChannelType.GuildText:
                return "💬";
            case ChannelType.GuildVoice:
                return "🔊";
            case ChannelType.GuildAnnouncement:
                return "📢";
            case ChannelType.GuildStageVoice:
                return "🎭";
            case ChannelType.GuildForum:
                return "💭";
            default:
                return "📄";
        }
    }

    // Permission Management Tools
    async setChannelPermissions(
        channelId: string,
        targetId: string,
        targetType: "role" | "member",
        permissions: {
            allow?: string[];
            deny?: string[];
        },
    ): Promise<string> {
        this.ensureReady();

        const channel = this.client.channels.cache.get(
            channelId,
        ) as GuildChannel;
        if (!channel || !channel.guild) {
            throw new Error("Channel not found or not a guild channel");
        }

        // Check bot permissions
        const botMember = channel.guild.members.cache.get(this.client.user!.id);
        if (!botMember?.permissions.has(PermissionFlagsBits.ManageChannels)) {
            throw new Error("Bot doesn't have permission to manage channels");
        }

        try {
            // Calculate permission bits
            let allowBits = BigInt(0);
            let denyBits = BigInt(0);

            // Process allow permissions
            if (permissions.allow && permissions.allow.length > 0) {
                for (const perm of permissions.allow) {
                    if (perm in PermissionFlagsBits) {
                        allowBits |=
                            PermissionFlagsBits[
                                perm as keyof typeof PermissionFlagsBits
                            ];
                    }
                }
            }

            // Process deny permissions
            if (permissions.deny && permissions.deny.length > 0) {
                for (const perm of permissions.deny) {
                    if (perm in PermissionFlagsBits) {
                        denyBits |=
                            PermissionFlagsBits[
                                perm as keyof typeof PermissionFlagsBits
                            ];
                    }
                }
            }

            // Validate target exists
            if (targetType === "role") {
                const role = channel.guild.roles.cache.get(targetId);
                if (!role) {
                    throw new Error("Role not found by targetId");
                }
            } else {
                const member = await channel.guild.members
                    .fetch(targetId)
                    .catch(() => null);
                if (!member) {
                    throw new Error("Member not found by targetId");
                }
            }

            // Apply permission overwrites
            await channel.permissionOverwrites.create(targetId, {
                ViewChannel: permissions.allow?.includes("ViewChannel")
                    ? true
                    : permissions.deny?.includes("ViewChannel")
                      ? false
                      : null,
                SendMessages: permissions.allow?.includes("SendMessages")
                    ? true
                    : permissions.deny?.includes("SendMessages")
                      ? false
                      : null,
                ReadMessageHistory: permissions.allow?.includes(
                    "ReadMessageHistory",
                )
                    ? true
                    : permissions.deny?.includes("ReadMessageHistory")
                      ? false
                      : null,
                ManageMessages: permissions.allow?.includes("ManageMessages")
                    ? true
                    : permissions.deny?.includes("ManageMessages")
                      ? false
                      : null,
                ManageChannels: permissions.allow?.includes("ManageChannels")
                    ? true
                    : permissions.deny?.includes("ManageChannels")
                      ? false
                      : null,
                ManageRoles: permissions.allow?.includes("ManageRoles")
                    ? true
                    : permissions.deny?.includes("ManageRoles")
                      ? false
                      : null,
            });

            const targetName =
                targetType === "role"
                    ? channel.guild.roles.cache.get(targetId)?.name || targetId
                    : (
                          await channel.guild.members
                              .fetch(targetId)
                              .catch(() => null)
                      )?.user.username || targetId;

            return (
                `Successfully set permissions for ${targetType} ${targetName} in channel ${channel.name}. ` +
                `Allowed: ${permissions.allow?.join(", ") || "none"}, ` +
                `Denied: ${permissions.deny?.join(", ") || "none"}`
            );
        } catch (error) {
            throw new Error(
                `Failed to set channel permissions: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    async getChannelPermissions(channelId: string): Promise<string> {
        this.ensureReady();

        const channel = this.client.channels.cache.get(
            channelId,
        ) as GuildChannel;
        if (!channel || !channel.guild) {
            throw new Error("Channel not found or not a guild channel");
        }

        try {
            const overwrites = channel.permissionOverwrites.cache;

            if (overwrites.size === 0) {
                return `No permission overwrites found for channel ${channel.name}`;
            }

            const formattedOverwrites: string[] = [];

            for (const [id, overwrite] of overwrites) {
                const isRole = overwrite.type === OverwriteType.Role;
                let targetName = id;

                if (isRole) {
                    const role = channel.guild.roles.cache.get(id);
                    targetName = role ? `@${role.name}` : `Role ID: ${id}`;
                } else {
                    const member = await channel.guild.members
                        .fetch(id)
                        .catch(() => null);
                    targetName = member
                        ? `@${member.user.username}`
                        : `User ID: ${id}`;
                }

                // Get allowed and denied permissions
                const allowedPerms: string[] = [];
                const deniedPerms: string[] = [];

                // Check each permission flag
                for (const [permName, permValue] of Object.entries(
                    PermissionFlagsBits,
                )) {
                    if (overwrite.allow.has(permValue)) {
                        allowedPerms.push(permName);
                    }
                    if (overwrite.deny.has(permValue)) {
                        deniedPerms.push(permName);
                    }
                }

                formattedOverwrites.push(
                    `- **${targetName}** (${isRole ? "Role" : "Member"}):\n` +
                        `  - Allowed: ${allowedPerms.length > 0 ? allowedPerms.join(", ") : "None"}\n` +
                        `  - Denied: ${deniedPerms.length > 0 ? deniedPerms.join(", ") : "None"}`,
                );
            }

            return `**Permission overwrites for channel ${channel.name}:**\n${formattedOverwrites.join("\n\n")}`;
        } catch (error) {
            throw new Error(
                `Failed to get channel permissions: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    async syncChannelPermissions(channelId: string): Promise<string> {
        this.ensureReady();

        const channel = this.client.channels.cache.get(
            channelId,
        ) as GuildChannel;
        if (!channel || !channel.guild) {
            throw new Error("Channel not found or not a guild channel");
        }

        // Check if channel has a parent category
        if (!channel.parent) {
            throw new Error(
                "Channel does not have a parent category to sync with",
            );
        }

        // Check bot permissions
        const botMember = channel.guild.members.cache.get(this.client.user!.id);
        if (!botMember?.permissions.has(PermissionFlagsBits.ManageChannels)) {
            throw new Error("Bot doesn't have permission to manage channels");
        }

        try {
            const categoryName = channel.parent.name;
            const oldOverwritesCount = channel.permissionOverwrites.cache.size;

            // Sync permissions with parent category
            await channel.lockPermissions();

            const newOverwritesCount = channel.permissionOverwrites.cache.size;

            return (
                `Successfully synced permissions for channel ${channel.name} with category ${categoryName}. ` +
                `Permission overwrites changed from ${oldOverwritesCount} to ${newOverwritesCount}.`
            );
        } catch (error) {
            throw new Error(
                `Failed to sync channel permissions: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    // Thread Management Tools
    async createThread(
        channelId: string,
        name: string,
        autoArchiveDuration?: ThreadAutoArchiveDuration,
        messageId?: string,
    ): Promise<string> {
        this.ensureReady();

        const channel = this.client.channels.cache.get(
            channelId,
        ) as TextChannel;
        if (
            !channel ||
            (channel.type !== ChannelType.GuildText &&
                channel.type !== ChannelType.GuildAnnouncement)
        ) {
            throw new Error("Channel not found or not a text channel");
        }

        try {
            let thread: ThreadChannel;

            if (messageId) {
                // Create thread from a specific message
                const message = await channel.messages.fetch(messageId);
                if (!message) {
                    throw new Error("Message not found by messageId");
                }

                thread = await message.startThread({
                    name,
                    autoArchiveDuration:
                        autoArchiveDuration || ThreadAutoArchiveDuration.OneDay,
                });

                return `Successfully created thread "${thread.name}" (ID: ${thread.id}) from message in ${channel.name}. Auto-archive: ${autoArchiveDuration || "24"} hours`;
            } else {
                // Create thread in the channel
                thread = await channel.threads.create({
                    name,
                    autoArchiveDuration:
                        autoArchiveDuration || ThreadAutoArchiveDuration.OneDay,
                    type: ChannelType.GuildPublicThread,
                });

                return `Successfully created thread "${thread.name}" (ID: ${thread.id}) in ${channel.name}. Auto-archive: ${autoArchiveDuration || "24"} hours`;
            }
        } catch (error) {
            throw new Error(
                `Failed to create thread: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    async archiveThread(threadId: string, reason?: string): Promise<string> {
        this.ensureReady();

        const thread = this.client.channels.cache.get(
            threadId,
        ) as ThreadChannel;
        if (!thread || !thread.isThread()) {
            throw new Error("Thread not found by threadId");
        }

        if (thread.archived) {
            return `Thread "${thread.name}" is already archived`;
        }

        try {
            await thread.setArchived(true, reason || "Thread archived via bot");
            return `Successfully archived thread "${thread.name}" (ID: ${thread.id})`;
        } catch (error) {
            throw new Error(
                `Failed to archive thread: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    async unarchiveThread(threadId: string, reason?: string): Promise<string> {
        this.ensureReady();

        const thread = this.client.channels.cache.get(
            threadId,
        ) as ThreadChannel;
        if (!thread || !thread.isThread()) {
            throw new Error("Thread not found by threadId");
        }

        if (!thread.archived) {
            return `Thread "${thread.name}" is not archived`;
        }

        try {
            await thread.setArchived(
                false,
                reason || "Thread unarchived via bot",
            );
            return `Successfully unarchived thread "${thread.name}" (ID: ${thread.id})`;
        } catch (error) {
            throw new Error(
                `Failed to unarchive thread: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    async lockThread(threadId: string, reason?: string): Promise<string> {
        this.ensureReady();

        const thread = this.client.channels.cache.get(
            threadId,
        ) as ThreadChannel;
        if (!thread || !thread.isThread()) {
            throw new Error("Thread not found by threadId");
        }

        if (thread.locked) {
            return `Thread "${thread.name}" is already locked`;
        }

        // Check bot permissions
        const botMember = thread.guild.members.cache.get(this.client.user!.id);
        if (!botMember?.permissions.has(PermissionFlagsBits.ManageThreads)) {
            throw new Error("Bot doesn't have permission to manage threads");
        }

        try {
            await thread.setLocked(true, reason || "Thread locked via bot");
            return `Successfully locked thread "${thread.name}" (ID: ${thread.id}). New messages are now disabled.`;
        } catch (error) {
            throw new Error(
                `Failed to lock thread: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    async unlockThread(threadId: string, reason?: string): Promise<string> {
        this.ensureReady();

        const thread = this.client.channels.cache.get(
            threadId,
        ) as ThreadChannel;
        if (!thread || !thread.isThread()) {
            throw new Error("Thread not found by threadId");
        }

        if (!thread.locked) {
            return `Thread "${thread.name}" is not locked`;
        }

        // Check bot permissions
        const botMember = thread.guild.members.cache.get(this.client.user!.id);
        if (!botMember?.permissions.has(PermissionFlagsBits.ManageThreads)) {
            throw new Error("Bot doesn't have permission to manage threads");
        }

        try {
            await thread.setLocked(false, reason || "Thread unlocked via bot");
            return `Successfully unlocked thread "${thread.name}" (ID: ${thread.id}). New messages are now allowed.`;
        } catch (error) {
            throw new Error(
                `Failed to unlock thread: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    async joinThread(threadId: string): Promise<string> {
        this.ensureReady();

        const thread = this.client.channels.cache.get(
            threadId,
        ) as ThreadChannel;
        if (!thread || !thread.isThread()) {
            throw new Error("Thread not found by threadId");
        }

        try {
            // Check if bot is already a member
            const botId = this.client.user!.id;
            const isMember = thread.members.cache.has(botId);

            if (isMember) {
                return `Bot is already a member of thread "${thread.name}"`;
            }

            await thread.join();
            return `Successfully joined thread "${thread.name}" (ID: ${thread.id})`;
        } catch (error) {
            throw new Error(
                `Failed to join thread: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    async leaveThread(threadId: string): Promise<string> {
        this.ensureReady();

        const thread = this.client.channels.cache.get(
            threadId,
        ) as ThreadChannel;
        if (!thread || !thread.isThread()) {
            throw new Error("Thread not found by threadId");
        }

        try {
            // Check if bot is a member
            const botId = this.client.user!.id;
            const isMember = thread.members.cache.has(botId);

            if (!isMember) {
                return `Bot is not a member of thread "${thread.name}"`;
            }

            await thread.leave();
            return `Successfully left thread "${thread.name}" (ID: ${thread.id})`;
        } catch (error) {
            throw new Error(
                `Failed to leave thread: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    async getActiveThreads(guildId?: string): Promise<string> {
        this.ensureReady();
        const resolvedGuildId = this.resolveGuildId(guildId);

        const guild = this.client.guilds.cache.get(resolvedGuildId);
        if (!guild) {
            throw new Error("Discord server not found by guildId");
        }

        try {
            // Fetch all active threads
            const threads = await guild.channels.fetchActiveThreads();

            if (threads.threads.size === 0) {
                return "No active threads found in this server";
            }

            const formattedThreads: string[] = [];

            // Sort threads by parent channel
            const threadsByParent = new Map<string, ThreadChannel[]>();

            threads.threads.forEach((thread) => {
                const parentId = thread.parentId || "unknown";
                if (!threadsByParent.has(parentId)) {
                    threadsByParent.set(parentId, []);
                }
                threadsByParent.get(parentId)!.push(thread);
            });

            // Format threads grouped by parent channel
            for (const [parentId, channelThreads] of threadsByParent) {
                const parentChannel = guild.channels.cache.get(parentId);
                const parentName = parentChannel
                    ? parentChannel.name
                    : "Unknown Channel";

                formattedThreads.push(`\n**Parent Channel: ${parentName}**`);

                for (const thread of channelThreads) {
                    const memberCount = thread.memberCount || 0;
                    const isLocked = thread.locked ? "🔒" : "";
                    const isArchived = thread.archived ? "📦" : "";
                    const autoArchive = thread.autoArchiveDuration || 60;

                    formattedThreads.push(
                        `  - ${isLocked}${isArchived} **${thread.name}** (ID: ${thread.id})\n` +
                            `    - Members: ${memberCount}\n` +
                            `    - Auto-archive: ${autoArchive} minutes\n` +
                            `    - Created: ${thread.createdAt?.toLocaleString() || "Unknown"}`,
                    );
                }
            }

            return `**Found ${threads.threads.size} active threads:**${formattedThreads.join("\n")}`;
        } catch (error) {
            throw new Error(
                `Failed to fetch active threads: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    // Additional Message Management Tools
    async pinMessage(channelId: string, messageId: string): Promise<string> {
        this.ensureReady();

        const channel = this.client.channels.cache.get(
            channelId,
        ) as TextChannel;
        if (!channel || channel.type !== ChannelType.GuildText) {
            throw new Error("Channel not found or not a text channel");
        }

        try {
            const message = await channel.messages.fetch(messageId);
            if (!message) {
                throw new Error("Message not found by messageId");
            }

            await message.pin();
            return `Successfully pinned message in ${channel.name}. Message link: ${message.url}`;
        } catch (error) {
            throw new Error(
                `Failed to pin message: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    async unpinMessage(channelId: string, messageId: string): Promise<string> {
        this.ensureReady();

        const channel = this.client.channels.cache.get(
            channelId,
        ) as TextChannel;
        if (!channel || channel.type !== ChannelType.GuildText) {
            throw new Error("Channel not found or not a text channel");
        }

        try {
            const message = await channel.messages.fetch(messageId);
            if (!message) {
                throw new Error("Message not found by messageId");
            }

            if (!message.pinned) {
                return `Message is not pinned in ${channel.name}`;
            }

            await message.unpin();
            return `Successfully unpinned message in ${channel.name}`;
        } catch (error) {
            throw new Error(
                `Failed to unpin message: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    async getPinnedMessages(channelId: string): Promise<string> {
        this.ensureReady();

        const channel = this.client.channels.cache.get(
            channelId,
        ) as TextChannel;
        if (!channel || channel.type !== ChannelType.GuildText) {
            throw new Error("Channel not found or not a text channel");
        }

        try {
            const pinnedMessages = await channel.messages.fetchPinned();

            if (pinnedMessages.size === 0) {
                return `No pinned messages found in ${channel.name}`;
            }

            const formattedMessages = pinnedMessages.map((message) => {
                const authorName = message.author.username;
                const timestamp = message.createdAt.toISOString();
                const content = message.content || "[No content]";
                return `- **${authorName}** (${timestamp}): ${content.substring(0, 100)}${content.length > 100 ? "..." : ""}\n  Link: ${message.url}`;
            });

            return `**Found ${pinnedMessages.size} pinned messages in ${channel.name}:**\n${formattedMessages.join("\n")}`;
        } catch (error) {
            throw new Error(
                `Failed to fetch pinned messages: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    async bulkDeleteMessages(
        channelId: string,
        messageIds: string[],
        filterOld?: boolean,
    ): Promise<string> {
        this.ensureReady();

        const channel = this.client.channels.cache.get(
            channelId,
        ) as TextChannel;
        if (!channel || channel.type !== ChannelType.GuildText) {
            throw new Error("Channel not found or not a text channel");
        }

        try {
            // Filter out messages older than 14 days if requested (Discord limitation)
            let messagesToDelete = messageIds;

            if (filterOld !== false) {
                const twoWeeksAgo = Date.now() - 14 * 24 * 60 * 60 * 1000;
                const validMessages: string[] = [];

                for (const messageId of messageIds) {
                    try {
                        const message = await channel.messages.fetch(messageId);
                        if (message.createdTimestamp > twoWeeksAgo) {
                            validMessages.push(messageId);
                        }
                    } catch (error) {
                        // Message doesn't exist, skip it
                    }
                }
                messagesToDelete = validMessages;
            }

            if (messagesToDelete.length === 0) {
                return "No valid messages to delete";
            }

            if (messagesToDelete.length === 1) {
                // Use single delete for one message
                await channel.messages.delete(messagesToDelete[0]);
                return `Successfully deleted 1 message from ${channel.name}`;
            } else {
                // Use bulk delete for multiple messages
                const deleted = await channel.bulkDelete(
                    messagesToDelete,
                    true,
                );
                return `Successfully deleted ${deleted.size} messages from ${channel.name}`;
            }
        } catch (error) {
            throw new Error(
                `Failed to bulk delete messages: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    async crosspostMessage(
        channelId: string,
        messageId: string,
    ): Promise<string> {
        this.ensureReady();

        const channel = this.client.channels.cache.get(channelId);
        if (
            !channel ||
            (channel.type !== ChannelType.GuildAnnouncement &&
                channel.type !== ChannelType.GuildText)
        ) {
            throw new Error("Channel not found or not an announcement channel");
        }

        const announcementChannel = channel as TextChannel;

        try {
            const message = await announcementChannel.messages.fetch(messageId);
            if (!message) {
                throw new Error("Message not found by messageId");
            }

            if (message.crosspostable) {
                await message.crosspost();
                return `Successfully crossposted message in ${announcementChannel.name}. Message link: ${message.url}`;
            } else {
                return `Message cannot be crossposted (may already be crossposted or not eligible)`;
            }
        } catch (error) {
            throw new Error(
                `Failed to crosspost message: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    // Enhanced Member Management Tools
    async getMembers(
        guildId?: string,
        limit?: number,
        after?: string,
    ): Promise<string> {
        this.ensureReady();
        const resolvedGuildId = this.resolveGuildId(guildId);

        const guild = this.client.guilds.cache.get(resolvedGuildId);
        if (!guild) {
            throw new Error("Discord server not found by guildId");
        }

        try {
            const fetchOptions: any = { limit: limit || 100 };
            if (after) {
                fetchOptions.after = after;
            }

            const memberResult = await guild.members.fetch(fetchOptions);

            // Handle both single member and collection results
            const memberCollection =
                memberResult instanceof Collection
                    ? memberResult
                    : new Collection<string, GuildMember>([
                          [memberResult.id, memberResult],
                      ]);

            const formattedMembers = Array.from(memberCollection.values()).map(
                (member: GuildMember) => {
                    const joinedAt =
                        member.joinedAt?.toLocaleDateString() || "Unknown";
                    const roles =
                        member.roles.cache
                            .filter((role: Role) => role.name !== "@everyone")
                            .map((role: Role) => role.name)
                            .join(", ") || "None";

                    return `- **${member.user.username}** (${member.user.id})
  - Nickname: ${member.nickname || "None"}
  - Joined: ${joinedAt}
  - Roles: ${roles}
  - Status: ${member.presence?.status || "Unknown"}`;
                },
            );

            return `**Retrieved ${memberCollection.size} members from ${guild.name}:**\n${formattedMembers.join("\n\n")}`;
        } catch (error) {
            throw new Error(
                `Failed to fetch members: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    async searchMembers(
        guildId?: string,
        query?: string,
        limit?: number,
    ): Promise<string> {
        this.ensureReady();
        const resolvedGuildId = this.resolveGuildId(guildId);

        const guild = this.client.guilds.cache.get(resolvedGuildId);
        if (!guild) {
            throw new Error("Discord server not found by guildId");
        }

        if (!query) {
            throw new Error("Search query is required");
        }

        try {
            // Search by username/nickname
            const results = await guild.members.search({
                query: query,
                limit: limit || 10,
            });

            if (results.size === 0) {
                return `No members found matching query "${query}"`;
            }

            const formattedResults = Array.from(results.values()).map(
                (member: GuildMember) => {
                    const joinedAt =
                        member.joinedAt?.toLocaleDateString() || "Unknown";
                    return `- **${member.user.username}** (${member.user.id})
  - Nickname: ${member.nickname || "None"}
  - Joined: ${joinedAt}`;
                },
            );

            return `**Found ${results.size} members matching "${query}":**\n${formattedResults.join("\n\n")}`;
        } catch (error) {
            throw new Error(
                `Failed to search members: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    async editMember(
        guildId?: string,
        userId?: string,
        nickname?: string,
        roles?: string[],
    ): Promise<string> {
        this.ensureReady();
        const resolvedGuildId = this.resolveGuildId(guildId);

        const guild = this.client.guilds.cache.get(resolvedGuildId);
        if (!guild) {
            throw new Error("Discord server not found by guildId");
        }

        if (!userId) {
            throw new Error("User ID is required");
        }

        try {
            const member = await guild.members.fetch(userId);
            if (!member) {
                throw new Error("Member not found in this server");
            }

            const changes: string[] = [];

            // Update nickname
            if (nickname !== undefined) {
                await member.setNickname(nickname);
                changes.push(`nickname to "${nickname || "None"}"`);
            }

            // Update roles
            if (roles !== undefined && roles.length > 0) {
                const roleObjects = roles.map((roleId) => {
                    const role = guild.roles.cache.get(roleId);
                    if (!role) {
                        throw new Error(`Role not found: ${roleId}`);
                    }
                    return role;
                });

                await member.roles.set(roleObjects);
                changes.push(
                    `roles to: ${roleObjects.map((r) => r.name).join(", ")}`,
                );
            }

            if (changes.length === 0) {
                return "No changes specified for member edit";
            }

            return `Successfully edited member ${member.user.username}. Changed: ${changes.join(", ")}`;
        } catch (error) {
            throw new Error(
                `Failed to edit member: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    async getMemberInfo(guildId?: string, userId?: string): Promise<string> {
        this.ensureReady();
        const resolvedGuildId = this.resolveGuildId(guildId);

        const guild = this.client.guilds.cache.get(resolvedGuildId);
        if (!guild) {
            throw new Error("Discord server not found by guildId");
        }

        if (!userId) {
            throw new Error("User ID is required");
        }

        try {
            const member = await guild.members.fetch(userId);
            if (!member) {
                throw new Error("Member not found in this server");
            }

            const user = member.user;
            const joinedAt = member.joinedAt?.toLocaleString() || "Unknown";
            const createdAt = user.createdAt.toLocaleString();
            const roles =
                member.roles.cache
                    .filter((role) => role.name !== "@everyone")
                    .map((role) => `${role.name} (${role.id})`)
                    .join("\n  - ") || "None";

            const permissions =
                member.permissions.toArray().join(", ") || "None";

            return `**Member Information for ${user.username}:**
- **User ID:** ${user.id}
- **Nickname:** ${member.nickname || "None"}
- **Account Created:** ${createdAt}
- **Joined Server:** ${joinedAt}
- **Highest Role:** ${member.roles.highest.name}
- **Avatar:** ${user.displayAvatarURL()}
- **Bot:** ${user.bot ? "Yes" : "No"}
- **Roles:**
  - ${roles}
- **Key Permissions:** ${permissions.substring(0, 500)}${permissions.length > 500 ? "..." : ""}`;
        } catch (error) {
            throw new Error(
                `Failed to get member info: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    // Event & Scheduling Tools
    async createEvent(
        guildId?: string,
        name?: string,
        description?: string,
        startTime?: string,
        endTime?: string,
        location?: string,
        channelId?: string,
    ): Promise<string> {
        this.ensureReady();
        const resolvedGuildId = this.resolveGuildId(guildId);

        const guild = this.client.guilds.cache.get(resolvedGuildId);
        if (!guild) {
            throw new Error("Discord server not found by guildId");
        }

        if (!name || !startTime) {
            throw new Error("Event name and start time are required");
        }

        try {
            const startDate = new Date(startTime);
            const endDate = endTime ? new Date(endTime) : undefined;

            // Validate dates
            if (isNaN(startDate.getTime())) {
                throw new Error(
                    "Invalid start time format. Use ISO 8601 format (e.g., 2024-01-01T15:00:00Z)",
                );
            }

            if (endDate && isNaN(endDate.getTime())) {
                throw new Error("Invalid end time format. Use ISO 8601 format");
            }

            if (startDate < new Date()) {
                throw new Error("Start time cannot be in the past");
            }

            // Determine event type and entity
            let entityType = GuildScheduledEventEntityType.External;
            let channel = null;

            if (channelId) {
                channel = guild.channels.cache.get(channelId);
                if (channel) {
                    if (
                        channel.type === ChannelType.GuildVoice ||
                        channel.type === ChannelType.GuildStageVoice
                    ) {
                        entityType = GuildScheduledEventEntityType.Voice;
                    } else {
                        throw new Error(
                            "Channel must be a voice or stage channel for voice events",
                        );
                    }
                }
            }

            const eventOptions: any = {
                name,
                description: description || undefined,
                scheduledStartTime: startDate,
                scheduledEndTime: endDate,
                privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
                entityType,
            };

            if (entityType === GuildScheduledEventEntityType.Voice && channel) {
                eventOptions.channel = channel;
            } else if (entityType === GuildScheduledEventEntityType.External) {
                eventOptions.entityMetadata = {
                    location: location || "External Location",
                };
            }

            const event = await guild.scheduledEvents.create(eventOptions);

            return `Successfully created event "${event.name}" (ID: ${event.id})
- Start: ${event.scheduledStartAt?.toLocaleString()}
- End: ${event.scheduledEndAt?.toLocaleString() || "No end time"}
- Type: ${entityType === GuildScheduledEventEntityType.Voice ? "Voice" : "External"}
- Location: ${entityType === GuildScheduledEventEntityType.Voice ? channel?.name : location || "External"}`;
        } catch (error) {
            throw new Error(
                `Failed to create event: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    async editEvent(
        guildId?: string,
        eventId?: string,
        name?: string,
        description?: string,
        startTime?: string,
        endTime?: string,
        location?: string,
    ): Promise<string> {
        this.ensureReady();
        const resolvedGuildId = this.resolveGuildId(guildId);

        const guild = this.client.guilds.cache.get(resolvedGuildId);
        if (!guild) {
            throw new Error("Discord server not found by guildId");
        }

        if (!eventId) {
            throw new Error("Event ID is required");
        }

        try {
            const event = await guild.scheduledEvents.fetch(eventId);
            if (!event) {
                throw new Error("Event not found by eventId");
            }

            const editOptions: any = {};
            const changes: string[] = [];

            if (name !== undefined) {
                editOptions.name = name;
                changes.push(`name to "${name}"`);
            }

            if (description !== undefined) {
                editOptions.description = description;
                changes.push(`description`);
            }

            if (startTime !== undefined) {
                const startDate = new Date(startTime);
                if (isNaN(startDate.getTime())) {
                    throw new Error("Invalid start time format");
                }
                if (startDate < new Date()) {
                    throw new Error("Start time cannot be in the past");
                }
                editOptions.scheduledStartTime = startDate;
                changes.push(`start time to ${startDate.toLocaleString()}`);
            }

            if (endTime !== undefined) {
                const endDate = new Date(endTime);
                if (isNaN(endDate.getTime())) {
                    throw new Error("Invalid end time format");
                }
                editOptions.scheduledEndTime = endDate;
                changes.push(`end time to ${endDate.toLocaleString()}`);
            }

            if (
                location !== undefined &&
                event.entityType === GuildScheduledEventEntityType.External
            ) {
                editOptions.entityMetadata = { location };
                changes.push(`location to "${location}"`);
            }

            if (Object.keys(editOptions).length === 0) {
                return "No changes specified for event edit";
            }

            const updatedEvent = await event.edit(editOptions);

            return `Successfully edited event "${updatedEvent.name}" (ID: ${eventId}). Changed: ${changes.join(", ")}`;
        } catch (error) {
            throw new Error(
                `Failed to edit event: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    async deleteEvent(guildId?: string, eventId?: string): Promise<string> {
        this.ensureReady();
        const resolvedGuildId = this.resolveGuildId(guildId);

        const guild = this.client.guilds.cache.get(resolvedGuildId);
        if (!guild) {
            throw new Error("Discord server not found by guildId");
        }

        if (!eventId) {
            throw new Error("Event ID is required");
        }

        try {
            const event = await guild.scheduledEvents.fetch(eventId);
            if (!event) {
                throw new Error("Event not found by eventId");
            }

            const eventName = event.name;
            await event.delete();

            return `Successfully deleted event "${eventName}" (ID: ${eventId})`;
        } catch (error) {
            throw new Error(
                `Failed to delete event: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    async getEvents(guildId?: string): Promise<string> {
        this.ensureReady();
        const resolvedGuildId = this.resolveGuildId(guildId);

        const guild = this.client.guilds.cache.get(resolvedGuildId);
        if (!guild) {
            throw new Error("Discord server not found by guildId");
        }

        try {
            const events = await guild.scheduledEvents.fetch();

            if (events.size === 0) {
                return "No scheduled events found in this server";
            }

            const formattedEvents = events.map((event: GuildScheduledEvent) => {
                const startTime =
                    event.scheduledStartAt?.toLocaleString() || "Unknown";
                const endTime =
                    event.scheduledEndAt?.toLocaleString() || "No end time";
                const status = GuildScheduledEventStatus[event.status];
                const entityType =
                    event.entityType === GuildScheduledEventEntityType.Voice
                        ? "Voice"
                        : "External";
                const location =
                    event.entityType === GuildScheduledEventEntityType.Voice
                        ? event.channel?.name || "Unknown Channel"
                        : event.entityMetadata?.location || "External Location";

                return `- **${event.name}** (ID: ${event.id})
  - Description: ${event.description || "No description"}
  - Start: ${startTime}
  - End: ${endTime}
  - Status: ${status}
  - Type: ${entityType}
  - Location: ${location}
  - Participants: ${event.userCount || 0}`;
            });

            return `**Found ${events.size} scheduled events:**\n${formattedEvents.join("\n\n")}`;
        } catch (error) {
            throw new Error(
                `Failed to fetch events: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    // Enhanced Invite Management Tools
    async createInvite(
        channelId?: string,
        maxAge?: number,
        maxUses?: number,
        temporary?: boolean,
    ): Promise<string> {
        this.ensureReady();

        if (!channelId) {
            throw new Error("Channel ID is required");
        }

        const channel = this.client.channels.cache.get(channelId);
        if (!channel) {
            throw new Error("Channel not found by channelId");
        }

        // Check if the channel supports invites
        if (
            channel.type !== ChannelType.GuildText &&
            channel.type !== ChannelType.GuildVoice &&
            channel.type !== ChannelType.GuildStageVoice &&
            channel.type !== ChannelType.GuildAnnouncement
        ) {
            throw new Error("Channel does not support invite creation");
        }

        const guildChannel = channel as
            | TextChannel
            | VoiceChannel
            | StageChannel;

        try {
            const inviteOptions: any = {
                maxAge: maxAge || 0, // 0 = never expires
                maxUses: maxUses || 0, // 0 = unlimited uses
                temporary: temporary || false,
                unique: true,
            };

            const invite = await guildChannel.createInvite(inviteOptions);

            const expiresText = maxAge === 0 ? "Never" : `${maxAge} seconds`;
            const usesText = maxUses === 0 ? "Unlimited" : `${maxUses}`;

            return `Successfully created invite: ${invite.url}
- Code: ${invite.code}
- Channel: ${guildChannel.name}
- Expires: ${expiresText}
- Max Uses: ${usesText}
- Temporary: ${temporary ? "Yes" : "No"}`;
        } catch (error) {
            throw new Error(
                `Failed to create invite: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    async deleteInvite(inviteCode?: string): Promise<string> {
        this.ensureReady();

        if (!inviteCode) {
            throw new Error("Invite code is required");
        }

        try {
            const invite = await this.client.fetchInvite(inviteCode);
            if (!invite) {
                throw new Error("Invite not found by invite code");
            }

            await invite.delete();

            return `Successfully deleted invite ${inviteCode}`;
        } catch (error) {
            throw new Error(
                `Failed to delete invite: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    async getInvites(guildId?: string): Promise<string> {
        this.ensureReady();
        const resolvedGuildId = this.resolveGuildId(guildId);

        const guild = this.client.guilds.cache.get(resolvedGuildId);
        if (!guild) {
            throw new Error("Discord server not found by guildId");
        }

        try {
            const invites = await guild.invites.fetch();

            if (invites.size === 0) {
                return "No invites found in this server";
            }

            const formattedInvites = invites.map((invite: Invite) => {
                const channel = invite.channel;
                const inviter = invite.inviter;
                const expiresAt = invite.expiresAt
                    ? invite.expiresAt.toLocaleString()
                    : "Never";
                const maxUses = invite.maxUses || "Unlimited";
                const uses = invite.uses || 0;

                return `- **${invite.code}** (${invite.url})
  - Channel: ${channel?.name || "Unknown"}
  - Created by: ${inviter?.username || "Unknown"}
  - Uses: ${uses}/${maxUses}
  - Expires: ${expiresAt}
  - Temporary: ${invite.temporary ? "Yes" : "No"}`;
            });

            return `**Found ${invites.size} invites:**\n${formattedInvites.join("\n\n")}`;
        } catch (error) {
            throw new Error(
                `Failed to fetch invites: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    // Enhanced Emoji & Sticker Tools
    async createEmoji(
        guildId?: string,
        name?: string,
        imageUrl?: string,
        roles?: string[],
    ): Promise<string> {
        this.ensureReady();
        const resolvedGuildId = this.resolveGuildId(guildId);

        const guild = this.client.guilds.cache.get(resolvedGuildId);
        if (!guild) {
            throw new Error("Discord server not found by guildId");
        }

        if (!name || !imageUrl) {
            throw new Error("Emoji name and image URL are required");
        }

        // Check bot permissions
        const botMember = guild.members.cache.get(this.client.user!.id);
        if (
            !botMember?.permissions.has(
                PermissionFlagsBits.ManageGuildExpressions,
            )
        ) {
            throw new Error("Bot doesn't have permission to manage emojis");
        }

        try {
            const emojiOptions: any = {
                name,
                attachment: imageUrl,
                reason: "Emoji created via Discord MCP",
            };

            if (roles && roles.length > 0) {
                const roleObjects = roles.map((roleId) => {
                    const role = guild.roles.cache.get(roleId);
                    if (!role) {
                        throw new Error(`Role not found: ${roleId}`);
                    }
                    return role;
                });
                emojiOptions.roles = roleObjects;
            }

            const emoji = await guild.emojis.create(emojiOptions);

            const roleList =
                roles && roles.length > 0
                    ? `\n- Restricted to roles: ${roles.map((id) => guild.roles.cache.get(id)?.name).join(", ")}`
                    : "\n- Available to everyone";

            return `Successfully created emoji ${emoji.name} (ID: ${emoji.id})
- Animated: ${emoji.animated ? "Yes" : "No"}
- Usage: <:${emoji.name}:${emoji.id}>${roleList}`;
        } catch (error) {
            throw new Error(
                `Failed to create emoji: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    async deleteEmoji(guildId?: string, emojiId?: string): Promise<string> {
        this.ensureReady();
        const resolvedGuildId = this.resolveGuildId(guildId);

        const guild = this.client.guilds.cache.get(resolvedGuildId);
        if (!guild) {
            throw new Error("Discord server not found by guildId");
        }

        if (!emojiId) {
            throw new Error("Emoji ID is required");
        }

        // Check bot permissions
        const botMember = guild.members.cache.get(this.client.user!.id);
        if (
            !botMember?.permissions.has(
                PermissionFlagsBits.ManageGuildExpressions,
            )
        ) {
            throw new Error("Bot doesn't have permission to manage emojis");
        }

        try {
            const emoji = guild.emojis.cache.get(emojiId);
            if (!emoji) {
                throw new Error("Emoji not found by emojiId");
            }

            const emojiName = emoji.name;
            await emoji.delete("Emoji deleted via Discord MCP");

            return `Successfully deleted emoji ${emojiName} (ID: ${emojiId})`;
        } catch (error) {
            throw new Error(
                `Failed to delete emoji: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    async getEmojis(guildId?: string): Promise<string> {
        this.ensureReady();
        const resolvedGuildId = this.resolveGuildId(guildId);

        const guild = this.client.guilds.cache.get(resolvedGuildId);
        if (!guild) {
            throw new Error("Discord server not found by guildId");
        }

        try {
            const emojis = guild.emojis.cache;

            if (emojis.size === 0) {
                return "No custom emojis found in this server";
            }

            const formattedEmojis = emojis.map((emoji: GuildEmoji) => {
                const creator = emoji.author?.username || "Unknown";
                const roleRestrictions =
                    emoji.roles.cache.size > 0
                        ? `\n  - Restricted to: ${emoji.roles.cache.map((role) => role.name).join(", ")}`
                        : "\n  - Available to everyone";

                return `- **${emoji.name}** (ID: ${emoji.id})
  - Usage: <:${emoji.name}:${emoji.id}>
  - Animated: ${emoji.animated ? "Yes" : "No"}
  - Created by: ${creator}${roleRestrictions}`;
            });

            return `**Found ${emojis.size} custom emojis:**\n${formattedEmojis.join("\n\n")}`;
        } catch (error) {
            throw new Error(
                `Failed to fetch emojis: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    async createSticker(
        guildId?: string,
        name?: string,
        description?: string,
        tags?: string,
        imageUrl?: string,
    ): Promise<string> {
        this.ensureReady();
        const resolvedGuildId = this.resolveGuildId(guildId);

        const guild = this.client.guilds.cache.get(resolvedGuildId);
        if (!guild) {
            throw new Error("Discord server not found by guildId");
        }

        if (!name || !description || !tags || !imageUrl) {
            throw new Error(
                "Sticker name, description, tags, and image URL are required",
            );
        }

        // Check bot permissions
        const botMember = guild.members.cache.get(this.client.user!.id);
        if (
            !botMember?.permissions.has(
                PermissionFlagsBits.ManageGuildExpressions,
            )
        ) {
            throw new Error("Bot doesn't have permission to manage stickers");
        }

        try {
            const stickerOptions = {
                name,
                description,
                tags,
                file: imageUrl,
                reason: "Sticker created via Discord MCP",
            };

            const sticker = await guild.stickers.create(stickerOptions);

            return `Successfully created sticker "${sticker.name}" (ID: ${sticker.id})
- Description: ${sticker.description}
- Tags: ${sticker.tags}
- Format: ${sticker.format}`;
        } catch (error) {
            throw new Error(
                `Failed to create sticker: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    async deleteSticker(guildId?: string, stickerId?: string): Promise<string> {
        this.ensureReady();
        const resolvedGuildId = this.resolveGuildId(guildId);

        const guild = this.client.guilds.cache.get(resolvedGuildId);
        if (!guild) {
            throw new Error("Discord server not found by guildId");
        }

        if (!stickerId) {
            throw new Error("Sticker ID is required");
        }

        // Check bot permissions
        const botMember = guild.members.cache.get(this.client.user!.id);
        if (
            !botMember?.permissions.has(
                PermissionFlagsBits.ManageGuildExpressions,
            )
        ) {
            throw new Error("Bot doesn't have permission to manage stickers");
        }

        try {
            const sticker = guild.stickers.cache.get(stickerId);
            if (!sticker) {
                throw new Error("Sticker not found by stickerId");
            }

            const stickerName = sticker.name;
            await sticker.delete("Sticker deleted via Discord MCP");

            return `Successfully deleted sticker "${stickerName}" (ID: ${stickerId})`;
        } catch (error) {
            throw new Error(
                `Failed to delete sticker: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    async getStickers(guildId?: string): Promise<string> {
        this.ensureReady();
        const resolvedGuildId = this.resolveGuildId(guildId);

        const guild = this.client.guilds.cache.get(resolvedGuildId);
        if (!guild) {
            throw new Error("Discord server not found by guildId");
        }

        try {
            const stickers = guild.stickers.cache;

            if (stickers.size === 0) {
                return "No custom stickers found in this server";
            }

            const formattedStickers = stickers.map((sticker: Sticker) => {
                const creator = sticker.user?.username || "Unknown";

                return `- **${sticker.name}** (ID: ${sticker.id})
  - Description: ${sticker.description || "No description"}
  - Tags: ${sticker.tags || "No tags"}
  - Format: ${sticker.format}
  - Created by: ${creator}`;
            });

            return `**Found ${stickers.size} custom stickers:**\n${formattedStickers.join("\n\n")}`;
        } catch (error) {
            throw new Error(
                `Failed to fetch stickers: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    // Attachment & File Tools
    async uploadFile(
        channelId?: string,
        filePath?: string,
        fileName?: string,
        content?: string,
    ): Promise<string> {
        this.ensureReady();

        if (!channelId || !filePath) {
            throw new Error("Channel ID and file path are required");
        }

        const channel = this.client.channels.cache.get(
            channelId,
        ) as TextChannel;
        if (!channel || channel.type !== ChannelType.GuildText) {
            throw new Error("Channel not found or not a text channel");
        }

        try {
            // Create attachment from file path or URL
            const attachment = new AttachmentBuilder(filePath, {
                name: fileName || undefined,
            });

            const messageOptions: any = {
                files: [attachment],
            };

            if (content) {
                messageOptions.content = content;
            }

            const message = await channel.send(messageOptions);

            const attachmentInfo = message.attachments.first();
            const fileSize = attachmentInfo
                ? `${(attachmentInfo.size / 1024).toFixed(2)} KB`
                : "Unknown size";

            return `Successfully uploaded file to ${channel.name}
- File: ${fileName || attachmentInfo?.name || "Unknown"}
- Size: ${fileSize}
- Message: ${message.url}`;
        } catch (error) {
            throw new Error(
                `Failed to upload file: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    async getMessageAttachments(
        channelId?: string,
        messageId?: string,
    ): Promise<string> {
        this.ensureReady();

        if (!channelId || !messageId) {
            throw new Error("Channel ID and message ID are required");
        }

        const channel = this.client.channels.cache.get(
            channelId,
        ) as TextChannel;
        if (!channel || channel.type !== ChannelType.GuildText) {
            throw new Error("Channel not found or not a text channel");
        }

        try {
            const message = await channel.messages.fetch(messageId);
            if (!message) {
                throw new Error("Message not found by messageId");
            }

            const attachments = message.attachments;

            if (attachments.size === 0) {
                return "No attachments found in this message";
            }

            const formattedAttachments = attachments.map((attachment) => {
                const fileSize = `${(attachment.size / 1024).toFixed(2)} KB`;

                return `- **${attachment.name}**
  - URL: ${attachment.url}
  - Size: ${fileSize}
  - Content Type: ${attachment.contentType || "Unknown"}
  - Spoiler: ${attachment.spoiler ? "Yes" : "No"}`;
            });

            return `**Found ${attachments.size} attachments:**\n${formattedAttachments.join("\n\n")}`;
        } catch (error) {
            throw new Error(
                `Failed to get message attachments: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    async readImages(
        channelId: string,
        messageId?: string,
        limit: number = 1,
        includeMetadata: boolean = true,
        downloadImages: boolean = false,
    ): Promise<string> {
        try {
            const channel = this.client.channels.cache.get(
                channelId,
            ) as TextChannel;
            if (!channel) {
                throw new Error("Channel not found by channelId");
            }

            let messages: any[] = [];

            if (messageId) {
                // Read specific message
                const message = await channel.messages.fetch(messageId);
                if (!message) {
                    throw new Error("Message not found");
                }
                messages = [message];
            } else {
                // Read recent messages to find images
                const recentMessages = await channel.messages.fetch({
                    limit: limit * 5,
                }); // Get more to find images
                messages = Array.from(recentMessages.values());
            }

            const imageMessages = messages
                .filter((msg) =>
                    msg.attachments.some(
                        (att: any) =>
                            att.contentType &&
                            att.contentType.startsWith("image/"),
                    ),
                )
                .slice(0, limit);

            if (imageMessages.length === 0) {
                return messageId
                    ? "No images found in the specified message"
                    : `No images found in the last ${limit * 5} messages`;
            }

            const results = [];

            for (const message of imageMessages) {
                const imageAttachments = message.attachments.filter(
                    (att: any) =>
                        att.contentType && att.contentType.startsWith("image/"),
                );

                for (const attachment of imageAttachments) {
                    const imageInfo: any = {
                        messageId: message.id,
                        filename: attachment.name,
                        url: attachment.url,
                        contentType: attachment.contentType,
                        author: message.author.username,
                        timestamp: message.createdAt.toISOString(),
                    };

                    if (includeMetadata) {
                        imageInfo.size = `${(attachment.size / 1024).toFixed(2)} KB`;
                        imageInfo.width = attachment.width || "Unknown";
                        imageInfo.height = attachment.height || "Unknown";
                        imageInfo.spoiler = attachment.spoiler;
                    }

                    if (downloadImages) {
                        try {
                            // Add basic image analysis
                            const response = await fetch(attachment.url);
                            if (response.ok) {
                                const buffer = await response.arrayBuffer();
                                imageInfo.actualSize = buffer.byteLength;
                                imageInfo.downloaded = true;
                                imageInfo.analysis =
                                    "Image successfully downloaded and analyzed";
                            }
                        } catch (downloadError) {
                            imageInfo.downloadError = `Failed to download: ${downloadError instanceof Error ? downloadError.message : String(downloadError)}`;
                        }
                    }

                    results.push(imageInfo);
                }
            }

            const formattedResults = results.map((img, index) => {
                let result = `**Image ${index + 1}: ${img.filename}**
- Message ID: ${img.messageId}
- Author: ${img.author}
- URL: ${img.url}
- Type: ${img.contentType}
- Timestamp: ${img.timestamp}`;

                if (includeMetadata) {
                    result += `
- Size: ${img.size}
- Dimensions: ${img.width}x${img.height}
- Spoiler: ${img.spoiler ? "Yes" : "No"}`;
                }

                if (downloadImages) {
                    if (img.downloaded) {
                        result += `
- Downloaded: ✅ (${img.actualSize} bytes)
- Analysis: ${img.analysis}`;
                    } else if (img.downloadError) {
                        result += `
- Download: ❌ ${img.downloadError}`;
                    }
                }

                return result;
            });

            return `**Found ${results.length} image(s):**\n\n${formattedResults.join("\n\n")}`;
        } catch (error) {
            throw new Error(
                `Failed to read images: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    // Enhanced Automod Tools
    async createAutomodRule(
        guildId?: string,
        name?: string,
        eventType?: string,
        triggerType?: string,
        keywordFilter?: string[],
        presets?: string[],
        allowList?: string[],
        mentionLimit?: number,
        enabled?: boolean,
    ): Promise<string> {
        this.ensureReady();
        const resolvedGuildId = this.resolveGuildId(guildId);

        const guild = this.client.guilds.cache.get(resolvedGuildId);
        if (!guild) {
            throw new Error("Discord server not found by guildId");
        }

        if (!name || !eventType || !triggerType) {
            throw new Error(
                "Rule name, event type, and trigger type are required",
            );
        }

        // Check permissions
        if (
            !guild.members.me?.permissions.has(PermissionFlagsBits.ManageGuild)
        ) {
            throw new Error(
                "Bot requires 'Manage Server' permission to create automod rules",
            );
        }

        try {
            let triggerTypeEnum: AutoModerationRuleTriggerType;
            let eventTypeEnum: AutoModerationRuleEventType;

            // Map trigger type
            switch (triggerType.toUpperCase()) {
                case "KEYWORD":
                    triggerTypeEnum = AutoModerationRuleTriggerType.Keyword;
                    break;
                case "SPAM":
                    triggerTypeEnum = AutoModerationRuleTriggerType.Spam;
                    break;
                case "KEYWORD_PRESET":
                    triggerTypeEnum =
                        AutoModerationRuleTriggerType.KeywordPreset;
                    break;
                case "MENTION_SPAM":
                    triggerTypeEnum = AutoModerationRuleTriggerType.MentionSpam;
                    break;
                default:
                    throw new Error(`Invalid trigger type: ${triggerType}`);
            }

            // Map event type
            switch (eventType.toUpperCase()) {
                case "MESSAGE_SEND":
                    eventTypeEnum = AutoModerationRuleEventType.MessageSend;
                    break;
                default:
                    throw new Error(`Invalid event type: ${eventType}`);
            }

            const ruleOptions: any = {
                name: name,
                eventType: eventTypeEnum,
                triggerType: triggerTypeEnum,
                enabled: enabled !== false,
                actions: [
                    {
                        type: AutoModerationActionType.BlockMessage,
                    },
                ],
            };

            // Add trigger metadata based on type
            if (
                triggerTypeEnum === AutoModerationRuleTriggerType.Keyword &&
                keywordFilter
            ) {
                ruleOptions.triggerMetadata = {
                    keywordFilter: keywordFilter,
                    allowList: allowList || [],
                };
            } else if (
                triggerTypeEnum === AutoModerationRuleTriggerType.MentionSpam &&
                mentionLimit
            ) {
                ruleOptions.triggerMetadata = {
                    mentionTotalLimit: mentionLimit,
                };
            } else if (
                triggerTypeEnum ===
                    AutoModerationRuleTriggerType.KeywordPreset &&
                presets
            ) {
                ruleOptions.triggerMetadata = {
                    presets: presets,
                };
            }

            const rule = await guild.autoModerationRules.create(ruleOptions);

            return `Successfully created automod rule "${rule.name}" (ID: ${rule.id})
- Event Type: ${eventType}
- Trigger Type: ${triggerType}
- Enabled: ${rule.enabled}
- Actions: Block Message`;
        } catch (error) {
            throw new Error(
                `Failed to create automod rule: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    async editAutomodRule(
        guildId?: string,
        ruleId?: string,
        name?: string,
        enabled?: boolean,
        keywordFilter?: string[],
        allowList?: string[],
        mentionLimit?: number,
    ): Promise<string> {
        this.ensureReady();
        const resolvedGuildId = this.resolveGuildId(guildId);

        const guild = this.client.guilds.cache.get(resolvedGuildId);
        if (!guild) {
            throw new Error("Discord server not found by guildId");
        }

        if (!ruleId) {
            throw new Error("Rule ID is required");
        }

        // Check permissions
        if (
            !guild.members.me?.permissions.has(PermissionFlagsBits.ManageGuild)
        ) {
            throw new Error(
                "Bot requires 'Manage Server' permission to edit automod rules",
            );
        }

        try {
            const rule = await guild.autoModerationRules.fetch(ruleId);
            if (!rule) {
                throw new Error("Automod rule not found by ruleId");
            }

            const editOptions: any = {};
            const changes: string[] = [];

            if (name && name !== rule.name) {
                editOptions.name = name;
                changes.push(`Name: "${rule.name}" → "${name}"`);
            }

            if (enabled !== undefined && enabled !== rule.enabled) {
                editOptions.enabled = enabled;
                changes.push(`Enabled: ${rule.enabled} → ${enabled}`);
            }

            // Update trigger metadata if provided
            if (keywordFilter || allowList || mentionLimit !== undefined) {
                const triggerMetadata: any = { ...rule.triggerMetadata };

                if (keywordFilter) {
                    triggerMetadata.keywordFilter = keywordFilter;
                    changes.push(
                        `Keywords updated (${keywordFilter.length} keywords)`,
                    );
                }

                if (allowList) {
                    triggerMetadata.allowList = allowList;
                    changes.push(
                        `Allow list updated (${allowList.length} items)`,
                    );
                }

                if (mentionLimit !== undefined) {
                    triggerMetadata.mentionTotalLimit = mentionLimit;
                    changes.push(
                        `Mention limit: ${rule.triggerMetadata?.mentionTotalLimit || "None"} → ${mentionLimit}`,
                    );
                }

                editOptions.triggerMetadata = triggerMetadata;
            }

            if (changes.length === 0) {
                return "No changes specified for the automod rule";
            }

            const updatedRule = await rule.edit(editOptions);

            return `Successfully edited automod rule "${updatedRule.name}" (ID: ${updatedRule.id})
Changes made:
${changes.map((change) => `- ${change}`).join("\n")}`;
        } catch (error) {
            throw new Error(
                `Failed to edit automod rule: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    async deleteAutomodRule(guildId: string, ruleId: string): Promise<string> {
        this.ensureReady();
        this.validateUserTokenOperation("deleteAutomodRule");
        const resolvedGuildId = this.resolveGuildId(guildId);

        const guild = this.client.guilds.cache.get(resolvedGuildId);
        if (!guild) {
            throw new Error("Discord server not found by guildId");
        }

        if (!ruleId) {
            throw new Error("Rule ID is required");
        }

        // Check permissions
        if (
            !guild.members.me?.permissions.has(PermissionFlagsBits.ManageGuild)
        ) {
            throw new Error(
                "Bot requires 'Manage Server' permission to delete automod rules",
            );
        }

        try {
            const rule = await guild.autoModerationRules.fetch(ruleId);
            if (!rule) {
                throw new Error("Automod rule not found by ruleId");
            }

            const ruleName = rule.name;
            await rule.delete();

            return `Successfully deleted automod rule "${ruleName}" (ID: ${ruleId})`;
        } catch (error) {
            throw new Error(
                `Failed to delete automod rule: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    async getAutomodRules(guildId?: string): Promise<string> {
        this.ensureReady();
        const resolvedGuildId = this.resolveGuildId(guildId);

        const guild = this.client.guilds.cache.get(resolvedGuildId);
        if (!guild) {
            throw new Error("Discord server not found by guildId");
        }

        try {
            const rules = await guild.autoModerationRules.fetch();

            if (rules.size === 0) {
                return "No automod rules found in this server";
            }

            const formattedRules = rules.map((rule) => {
                const triggerType =
                    Object.keys(AutoModerationRuleTriggerType)[
                        Object.values(AutoModerationRuleTriggerType).indexOf(
                            rule.triggerType as any,
                        )
                    ] || "Unknown";
                const eventType =
                    Object.keys(AutoModerationRuleEventType)[
                        Object.values(AutoModerationRuleEventType).indexOf(
                            rule.eventType as any,
                        )
                    ] || "Unknown";

                let metadata = "";
                if (rule.triggerMetadata) {
                    if (rule.triggerMetadata.keywordFilter?.length) {
                        metadata += `\n  - Keywords: ${rule.triggerMetadata.keywordFilter.length} items`;
                    }
                    if (rule.triggerMetadata.allowList?.length) {
                        metadata += `\n  - Allow List: ${rule.triggerMetadata.allowList.length} items`;
                    }
                    if (rule.triggerMetadata.mentionTotalLimit) {
                        metadata += `\n  - Mention Limit: ${rule.triggerMetadata.mentionTotalLimit}`;
                    }
                }

                return `**${rule.name}** (ID: ${rule.id})
  - Enabled: ${rule.enabled ? "✅" : "❌"}
  - Event Type: ${eventType}
  - Trigger Type: ${triggerType}
  - Actions: ${rule.actions.length} configured${metadata}`;
            });

            return `**Found ${rules.size} automod rules:**\n\n${formattedRules.join("\n\n")}`;
        } catch (error) {
            throw new Error(
                `Failed to get automod rules: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    // Advanced Interaction Tools
    async sendModal(
        interactionId?: string,
        title?: string,
        customId?: string,
        components?: any[],
    ): Promise<string> {
        // Note: This is a conceptual implementation as modals are typically sent in response to interactions
        // For MCP tools, this would require an active interaction token which is complex to implement
        throw new Error(
            "Send modal functionality requires an active interaction context. This tool is designed for bot applications with slash commands or button interactions.",
        );
    }

    async sendEmbed(
        channelId?: string,
        title?: string,
        description?: string,
        color?: string,
        fields?: any[],
        footer?: string,
        image?: string,
        thumbnail?: string,
    ): Promise<string> {
        this.ensureReady();

        if (!channelId) {
            throw new Error("Channel ID is required");
        }

        const channel = this.client.channels.cache.get(
            channelId,
        ) as TextChannel;
        if (!channel || channel.type !== ChannelType.GuildText) {
            throw new Error("Channel not found or not a text channel");
        }

        try {
            const embed = new EmbedBuilder();

            if (title) embed.setTitle(title);
            if (description) embed.setDescription(description);
            if (color) {
                // Parse hex color
                const colorValue = color.startsWith("#")
                    ? color.slice(1)
                    : color;
                embed.setColor(parseInt(colorValue, 16));
            }
            if (footer) embed.setFooter({ text: footer });
            if (image) embed.setImage(image);
            if (thumbnail) embed.setThumbnail(thumbnail);

            if (fields && fields.length > 0) {
                for (const field of fields) {
                    if (field.name && field.value) {
                        embed.addFields({
                            name: field.name,
                            value: field.value,
                            inline: field.inline || false,
                        });
                    }
                }
            }

            const message = await channel.send({ embeds: [embed] });

            return `Successfully sent embed to ${channel.name}
- Title: ${title || "None"}
- Fields: ${fields?.length || 0}
- Color: ${color || "Default"}
- Message: ${message.url}`;
        } catch (error) {
            throw new Error(
                `Failed to send embed: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    async sendButton(
        channelId?: string,
        content?: string,
        buttons?: any[],
    ): Promise<string> {
        this.ensureReady();

        if (!channelId) {
            throw new Error("Channel ID is required");
        }

        if (!buttons || buttons.length === 0) {
            throw new Error("At least one button is required");
        }

        const channel = this.client.channels.cache.get(
            channelId,
        ) as TextChannel;
        if (!channel || channel.type !== ChannelType.GuildText) {
            throw new Error("Channel not found or not a text channel");
        }

        try {
            const actionRows = [];
            const buttonBuilders = [];

            for (let i = 0; i < buttons.length; i++) {
                const buttonData = buttons[i];

                if (!buttonData.label) {
                    throw new Error(`Button ${i + 1} requires a label`);
                }

                const button = new ButtonBuilder().setLabel(buttonData.label);

                // Set style
                switch (buttonData.style?.toUpperCase()) {
                    case "PRIMARY":
                        button.setStyle(ButtonStyle.Primary);
                        break;
                    case "SECONDARY":
                        button.setStyle(ButtonStyle.Secondary);
                        break;
                    case "SUCCESS":
                        button.setStyle(ButtonStyle.Success);
                        break;
                    case "DANGER":
                        button.setStyle(ButtonStyle.Danger);
                        break;
                    case "LINK":
                        button.setStyle(ButtonStyle.Link);
                        if (buttonData.url) {
                            button.setURL(buttonData.url);
                        } else {
                            throw new Error(
                                `Link button "${buttonData.label}" requires a URL`,
                            );
                        }
                        break;
                    default:
                        button.setStyle(ButtonStyle.Secondary);
                }

                // Set custom ID for non-link buttons
                if (buttonData.style?.toUpperCase() !== "LINK") {
                    button.setCustomId(
                        buttonData.customId || `button_${Date.now()}_${i}`,
                    );
                }

                // Set emoji if provided
                if (buttonData.emoji) {
                    button.setEmoji(buttonData.emoji);
                }

                buttonBuilders.push(button);

                // Create action row every 5 buttons (Discord limit)
                if (buttonBuilders.length === 5 || i === buttons.length - 1) {
                    const actionRow =
                        new ActionRowBuilder<ButtonBuilder>().addComponents(
                            ...buttonBuilders,
                        );
                    actionRows.push(actionRow);
                    buttonBuilders.length = 0; // Clear array
                }
            }

            const messageOptions: any = { components: actionRows };
            if (content) {
                messageOptions.content = content;
            }

            const message = await channel.send(messageOptions);

            return `Successfully sent buttons to ${channel.name}
- Button count: ${buttons.length}
- Content: ${content || "None"}
- Message: ${message.url}`;
        } catch (error) {
            throw new Error(
                `Failed to send buttons: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    async sendSelectMenu(
        channelId?: string,
        content?: string,
        customId?: string,
        placeholder?: string,
        minValues?: number,
        maxValues?: number,
        options?: any[],
    ): Promise<string> {
        this.ensureReady();

        if (!channelId) {
            throw new Error("Channel ID is required");
        }

        if (!options || options.length === 0) {
            throw new Error("At least one option is required");
        }

        if (options.length > 25) {
            throw new Error("Maximum 25 options allowed in a select menu");
        }

        const channel = this.client.channels.cache.get(
            channelId,
        ) as TextChannel;
        if (!channel || channel.type !== ChannelType.GuildText) {
            throw new Error("Channel not found or not a text channel");
        }

        try {
            const selectMenuBuilder = new StringSelectMenuBuilder()
                .setCustomId(customId || `select_${Date.now()}`)
                .setPlaceholder(placeholder || "Select an option")
                .setMinValues(minValues || 1)
                .setMaxValues(maxValues || 1);

            const selectOptions = [];
            for (let i = 0; i < options.length; i++) {
                const optionData = options[i];

                if (!optionData.label || !optionData.value) {
                    throw new Error(
                        `Option ${i + 1} requires both label and value`,
                    );
                }

                const option = new StringSelectMenuOptionBuilder()
                    .setLabel(optionData.label)
                    .setValue(optionData.value);

                if (optionData.description) {
                    option.setDescription(optionData.description);
                }

                if (optionData.emoji) {
                    option.setEmoji(optionData.emoji);
                }

                selectOptions.push(option);
            }

            selectMenuBuilder.addOptions(selectOptions);

            const actionRow =
                new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
                    selectMenuBuilder,
                );

            const messageOptions: any = { components: [actionRow] };
            if (content) {
                messageOptions.content = content;
            }

            const message = await channel.send(messageOptions);

            return `Successfully sent select menu to ${channel.name}
- Options: ${options.length}
- Range: ${minValues || 1}-${maxValues || 1} selections
- Content: ${content || "None"}
- Message: ${message.url}`;
        } catch (error) {
            throw new Error(
                `Failed to send select menu: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    // Enhanced Server Management Tools
    async editServer(
        guildId?: string,
        name?: string,
        description?: string,
        icon?: string,
        banner?: string,
        verificationLevel?: string,
    ): Promise<string> {
        this.ensureReady();
        const resolvedGuildId = this.resolveGuildId(guildId);

        const guild = this.client.guilds.cache.get(resolvedGuildId);
        if (!guild) {
            throw new Error("Discord server not found by guildId");
        }

        // Check permissions
        if (
            !guild.members.me?.permissions.has(PermissionFlagsBits.ManageGuild)
        ) {
            throw new Error(
                "Bot requires 'Manage Server' permission to edit server settings",
            );
        }

        try {
            const editOptions: any = {};
            const changes: string[] = [];

            if (name && name !== guild.name) {
                editOptions.name = name;
                changes.push(`Name: "${guild.name}" → "${name}"`);
            }

            if (
                description !== undefined &&
                description !== guild.description
            ) {
                editOptions.description = description;
                changes.push(
                    `Description: "${guild.description || "None"}" → "${description || "None"}"`,
                );
            }

            if (icon) {
                editOptions.icon = icon;
                changes.push(`Icon updated`);
            }

            if (banner) {
                editOptions.banner = banner;
                changes.push(`Banner updated`);
            }

            if (verificationLevel) {
                let level: GuildVerificationLevel;
                switch (verificationLevel.toUpperCase()) {
                    case "NONE":
                        level = GuildVerificationLevel.None;
                        break;
                    case "LOW":
                        level = GuildVerificationLevel.Low;
                        break;
                    case "MEDIUM":
                        level = GuildVerificationLevel.Medium;
                        break;
                    case "HIGH":
                        level = GuildVerificationLevel.High;
                        break;
                    case "VERY_HIGH":
                        level = GuildVerificationLevel.VeryHigh;
                        break;
                    default:
                        throw new Error(
                            `Invalid verification level: ${verificationLevel}`,
                        );
                }

                if (level !== guild.verificationLevel) {
                    editOptions.verificationLevel = level;
                    changes.push(
                        `Verification level: ${guild.verificationLevel} → ${level}`,
                    );
                }
            }

            if (changes.length === 0) {
                return "No changes specified for the server";
            }

            const updatedGuild = await guild.edit(editOptions);

            return `Successfully edited server "${updatedGuild.name}" (ID: ${updatedGuild.id})
Changes made:
${changes.map((change) => `- ${change}`).join("\n")}`;
        } catch (error) {
            throw new Error(
                `Failed to edit server: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    async getServerWidget(guildId?: string): Promise<string> {
        this.ensureReady();
        const resolvedGuildId = this.resolveGuildId(guildId);

        const guild = this.client.guilds.cache.get(resolvedGuildId);
        if (!guild) {
            throw new Error("Discord server not found by guildId");
        }

        try {
            const widget = await guild.fetchWidget().catch(() => null);

            if (!widget) {
                return `**Server Widget for ${guild.name}**
Widget is disabled or not available. Enable it in Server Settings > Widget to use this feature.`;
            }

            const channels = Array.from(widget.channels.values()).map(
                (channel) => `- **${channel.name}** (${channel.id})`,
            );

            return `**Server Widget for ${guild.name}**
- **Invite URL**: ${widget.instantInvite || "None"}
- **Online Members**: ${widget.presenceCount}
- **Voice Channels**: ${widget.channels.size}

**Channels with activity:**
${channels.length > 0 ? channels.join("\n") : "No active channels"}`;
        } catch (error) {
            throw new Error(
                `Failed to get server widget: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    async getWelcomeScreen(guildId?: string): Promise<string> {
        this.ensureReady();
        const resolvedGuildId = this.resolveGuildId(guildId);

        const guild = this.client.guilds.cache.get(resolvedGuildId);
        if (!guild) {
            throw new Error("Discord server not found by guildId");
        }

        try {
            const welcomeScreen = await guild
                .fetchWelcomeScreen()
                .catch(() => null);

            if (!welcomeScreen) {
                return `**Welcome Screen for ${guild.name}**
Welcome screen is not enabled or not available. Enable it in Server Settings > Overview > Welcome Screen.`;
            }

            const channels = Array.from(
                welcomeScreen.welcomeChannels.values(),
            ).map((channel) => {
                const emoji = channel.emoji
                    ? typeof channel.emoji === "string"
                        ? channel.emoji
                        : channel.emoji.name
                    : "";
                return `- ${emoji ? emoji + " " : ""}**${channel.description}**
  Channel: <#${channel.channelId}> (${channel.channelId})`;
            });

            return `**Welcome Screen for ${guild.name}**
- **Enabled**: Yes
- **Description**: ${welcomeScreen.description || "No description"}
- **Welcome Channels**: ${welcomeScreen.welcomeChannels.size}

**Channels:**
${channels.length > 0 ? channels.join("\n\n") : "No welcome channels configured"}`;
        } catch (error) {
            throw new Error(
                `Failed to get welcome screen: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    async editWelcomeScreen(
        guildId?: string,
        enabled?: boolean,
        description?: string,
        welcomeChannels?: any[],
    ): Promise<string> {
        this.ensureReady();
        const resolvedGuildId = this.resolveGuildId(guildId);

        const guild = this.client.guilds.cache.get(resolvedGuildId);
        if (!guild) {
            throw new Error("Discord server not found by guildId");
        }

        // Check permissions
        if (
            !guild.members.me?.permissions.has(PermissionFlagsBits.ManageGuild)
        ) {
            throw new Error(
                "Bot requires 'Manage Server' permission to edit welcome screen",
            );
        }

        try {
            const editOptions: any = {};
            const changes: string[] = [];

            if (enabled !== undefined) {
                editOptions.enabled = enabled;
                changes.push(`Enabled: ${enabled ? "Yes" : "No"}`);
            }

            if (description !== undefined) {
                editOptions.description = description;
                changes.push(`Description updated`);
            }

            if (welcomeChannels) {
                const formattedChannels = welcomeChannels.map((channelData) => {
                    if (!channelData.channelId || !channelData.description) {
                        throw new Error(
                            "Each welcome channel requires channelId and description",
                        );
                    }

                    const welcomeChannel: any = {
                        channelId: channelData.channelId,
                        description: channelData.description,
                    };

                    if (channelData.emoji) {
                        welcomeChannel.emoji = channelData.emoji;
                    }

                    return welcomeChannel;
                });

                editOptions.welcomeChannels = formattedChannels;
                changes.push(
                    `Welcome channels updated (${formattedChannels.length} channels)`,
                );
            }

            if (changes.length === 0) {
                return "No changes specified for the welcome screen";
            }

            await guild.editWelcomeScreen(editOptions);

            return `Successfully edited welcome screen for "${guild.name}" (ID: ${guild.id})
Changes made:
${changes.map((change) => `- ${change}`).join("\n")}`;
        } catch (error) {
            throw new Error(
                `Failed to edit welcome screen: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    // Analytics & Logging Enhanced Tools
    async getMessageHistory(
        channelId?: string,
        limit?: number,
        before?: string,
        after?: string,
    ): Promise<string> {
        this.ensureReady();

        if (!channelId) {
            throw new Error("Channel ID is required");
        }

        const channel = this.client.channels.cache.get(
            channelId,
        ) as TextChannel;
        if (!channel || channel.type !== ChannelType.GuildText) {
            throw new Error("Channel not found or not a text channel");
        }

        try {
            const fetchOptions: any = {
                limit: limit || 50,
            };

            if (before) fetchOptions.before = before;
            if (after) fetchOptions.after = after;

            const fetchedMsgs: any = await channel.messages.fetch(fetchOptions);

            if (fetchedMsgs.size === 0) {
                return "No messages found in the specified range";
            }

            const messageArray = Array.from(fetchedMsgs.values());
            const formattedMessages = messageArray.map((msg: any) => {
                const timestamp = msg.createdAt.toLocaleString();
                const attachments =
                    msg.attachments.size > 0
                        ? ` [${msg.attachments.size} attachments]`
                        : "";
                return `**${msg.author.username}** (${timestamp})${attachments}
${msg.content || "*[No text content]*"}`;
            });

            return `**Message History for #${channel.name}**
Total messages: ${fetchedMsgs.size}
Range: ${limit || 50} messages${before ? ` before ${before}` : ""}${after ? ` after ${after}` : ""}

${formattedMessages.join("\n\n")}`;
        } catch (error) {
            throw new Error(
                `Failed to get message history: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    async getServerStats(guildId?: string): Promise<string> {
        this.ensureReady();
        const resolvedGuildId = this.resolveGuildId(guildId);

        const guild = this.client.guilds.cache.get(resolvedGuildId);
        if (!guild) {
            throw new Error("Discord server not found by guildId");
        }

        try {
            const channels = guild.channels.cache;
            const roles = guild.roles.cache;
            const emojis = guild.emojis.cache;

            const channelStats = {
                text: channels.filter((c) => c.type === ChannelType.GuildText)
                    .size,
                voice: channels.filter((c) => c.type === ChannelType.GuildVoice)
                    .size,
                category: channels.filter(
                    (c) => c.type === ChannelType.GuildCategory,
                ).size,
                stage: channels.filter(
                    (c) => c.type === ChannelType.GuildStageVoice,
                ).size,
                announcement: channels.filter(
                    (c) => c.type === ChannelType.GuildAnnouncement,
                ).size,
                forum: channels.filter((c) => c.type === ChannelType.GuildForum)
                    .size,
            };

            const verificationLevels = [
                "None",
                "Low",
                "Medium",
                "High",
                "Very High",
            ];
            const createdDate = guild.createdAt.toLocaleDateString();
            const ownerTag =
                guild.members.cache.get(guild.ownerId)?.user.tag || "Unknown";

            return `**Server Statistics for ${guild.name}**

**Basic Info:**
- Server ID: ${guild.id}
- Owner: ${ownerTag}
- Created: ${createdDate}
- Verification Level: ${verificationLevels[guild.verificationLevel]}
- Boost Level: ${guild.premiumTier}
- Boost Count: ${guild.premiumSubscriptionCount || 0}

**Members:**
- Total Members: ${guild.memberCount}
- Max Members: ${guild.maximumMembers || "Unlimited"}

**Channels (${channels.size} total):**
- Text: ${channelStats.text}
- Voice: ${channelStats.voice}
- Categories: ${channelStats.category}
- Stage: ${channelStats.stage}
- Announcement: ${channelStats.announcement}
- Forum: ${channelStats.forum}

**Roles:** ${roles.size - 1} (excluding @everyone)
**Custom Emojis:** ${emojis.size}
**Features:** ${guild.features.length > 0 ? guild.features.join(", ") : "None"}`;
        } catch (error) {
            throw new Error(
                `Failed to get server stats: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    async exportChatLog(
        channelId?: string,
        format?: string,
        limit?: number,
        dateRange?: any,
    ): Promise<string> {
        this.ensureReady();

        if (!channelId) {
            throw new Error("Channel ID is required");
        }

        if (!format || !["JSON", "CSV", "TXT"].includes(format.toUpperCase())) {
            throw new Error("Format must be JSON, CSV, or TXT");
        }

        const channel = this.client.channels.cache.get(
            channelId,
        ) as TextChannel;
        if (!channel || channel.type !== ChannelType.GuildText) {
            throw new Error("Channel not found or not a text channel");
        }

        try {
            const fetchOptions: any = {
                limit: limit || 100,
            };

            const fetchedMessages: any =
                await channel.messages.fetch(fetchOptions);
            let filteredMessages = Array.from(
                fetchedMessages.values(),
            ) as any[];

            // Apply date range filter if provided
            if (dateRange && dateRange.start && dateRange.end) {
                const startDate = new Date(dateRange.start);
                const endDate = new Date(dateRange.end);

                filteredMessages = filteredMessages.filter((message) => {
                    const messageDate = message.createdAt;
                    return messageDate >= startDate && messageDate <= endDate;
                });
            }

            if (filteredMessages.length === 0) {
                return "No messages found in the specified criteria";
            }

            const formatType = format.toUpperCase();
            let exportData: string;

            switch (formatType) {
                case "JSON":
                    const jsonData = filteredMessages.map((message) => ({
                        id: message.id,
                        author: {
                            id: message.author.id,
                            username: message.author.username,
                            tag: message.author.tag,
                        },
                        content: message.content,
                        timestamp: message.createdAt.toISOString(),
                        attachments: message.attachments.map((att: any) => ({
                            name: att.name,
                            url: att.url,
                            size: att.size,
                        })),
                        reactions: message.reactions.cache.map(
                            (reaction: any) => ({
                                emoji: reaction.emoji.name,
                                count: reaction.count,
                            }),
                        ),
                    }));
                    exportData = JSON.stringify(jsonData, null, 2);
                    break;

                case "CSV":
                    const csvHeaders =
                        "ID,Author,Username,Content,Timestamp,Attachments";
                    const csvRows = filteredMessages.map((message) => {
                        const content = message.content.replace(/"/g, '""'); // Escape quotes
                        const attachmentUrls = message.attachments
                            .map((att: any) => att.url)
                            .join(";");
                        return `"${message.id}","${message.author.tag}","${message.author.username}","${content}","${message.createdAt.toISOString()}","${attachmentUrls}"`;
                    });
                    exportData = `${csvHeaders}\n${csvRows.join("\n")}`;
                    break;

                case "TXT":
                    const txtLines = filteredMessages.map((message) => {
                        const timestamp = message.createdAt.toLocaleString();
                        const attachments =
                            message.attachments.size > 0
                                ? ` [${message.attachments.size} attachments]`
                                : "";
                        return `[${timestamp}] ${message.author.tag}: ${message.content}${attachments}`;
                    });
                    exportData = txtLines.join("\n");
                    break;

                default:
                    throw new Error("Invalid format specified");
            }

            // Note: In a real implementation, you would save this to a file and return a download link
            // For MCP tools, we return a preview of the export
            const preview =
                exportData.length > 2000
                    ? exportData.substring(0, 2000) + "..."
                    : exportData;

            return `**Chat Log Export for #${channel.name}**
- Format: ${formatType}
- Messages: ${filteredMessages.length}
- Date Range: ${dateRange ? `${dateRange.start} to ${dateRange.end}` : "All messages"}
- Export Size: ${exportData.length} characters

**Preview:**
\`\`\`
${preview}
\`\`\`

*Note: This is a preview. In a production environment, the full export would be saved as a file.*`;
        } catch (error) {
            throw new Error(
                `Failed to export chat log: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    async destroy(): Promise<void> {
        // Clean up voice connections
        for (const [guildId, connection] of this.voiceConnections) {
            connection.destroy();
        }
        this.voiceConnections.clear();

        // Clean up audio players
        for (const [guildId, player] of this.audioPlayers) {
            player.stop();
        }
        this.audioPlayers.clear();

        await this.client.destroy();
    }
}
