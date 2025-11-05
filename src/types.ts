import { z } from "zod";

// =============================================================================
// AUTHENTICATION SCHEMAS - Bot and User token support
// =============================================================================

export const AuthConfigSchema = z.object({
    tokenType: z
        .enum(["bot", "user"])
        .describe("Type of authentication token: 'bot' or 'user'"),
    token: z
        .string()
        .describe("Discord authentication token (bot token or user token)"),
    intents: z
        .array(z.string())
        .optional()
        .describe("Discord gateway intents for the client"),
});

export const SwitchTokenSchema = z.object({
    tokenType: z
        .enum(["bot", "user"])
        .describe("Type of token to switch to: 'bot' or 'user'"),
    token: z
        .string()
        .optional()
        .describe("New token value (optional if using environment variable)"),
});

export const GetAuthStatusSchema = z.object({
    includeDetails: z
        .boolean()
        .optional()
        .describe("Include detailed authentication information"),
});

// =============================================================================
// CORE SCHEMAS - Server and basic information
// =============================================================================

export const ServerInfoSchema = z.object({
    guildId: z.string().optional().describe("Discord server ID"),
});

export const GetServerStatsSchema = z.object({
    guildId: z.string().describe("Discord server ID"),
});

export const GetServerWidgetSchema = z.object({
    guildId: z.string().describe("Discord server ID"),
});

// =============================================================================
// MESSAGE MANAGEMENT SCHEMAS
// =============================================================================

export const SendMessageSchema = z.object({
    channelId: z.string().describe("Discord channel ID"),
    message: z.string().describe("Message content"),
});

export const EditMessageSchema = z.object({
    channelId: z.string().describe("Discord channel ID"),
    messageId: z.string().describe("Specific message ID"),
    newMessage: z.string().describe("New message content"),
});

export const DeleteMessageSchema = z.object({
    channelId: z.string().describe("Discord channel ID"),
    messageId: z.string().describe("Specific message ID"),
});

export const ReadMessagesSchema = z.object({
    channelId: z.string().describe("Discord channel ID"),
    count: z.string().optional().describe("Number of messages to retrieve"),
});

export const AddReactionSchema = z.object({
    channelId: z.string().describe("Discord channel ID"),
    messageId: z.string().describe("Discord message ID"),
    emoji: z.string().describe("Emoji (Unicode or string)"),
});

export const RemoveReactionSchema = z.object({
    channelId: z.string().describe("Discord channel ID"),
    messageId: z.string().describe("Discord message ID"),
    emoji: z.string().describe("Emoji (Unicode or string)"),
});

// Enhanced Message Management
export const PinMessageSchema = z.object({
    channelId: z.string().describe("Discord channel ID"),
    messageId: z.string().describe("Message ID to pin"),
});

export const UnpinMessageSchema = z.object({
    channelId: z.string().describe("Discord channel ID"),
    messageId: z.string().describe("Message ID to unpin"),
});

export const GetPinnedMessagesSchema = z.object({
    channelId: z.string().describe("Discord channel ID"),
});

export const BulkDeleteMessagesSchema = z.object({
    channelId: z.string().describe("Discord channel ID"),
    messageIds: z.array(z.string()).describe("Array of message IDs to delete"),
    filterOld: z
        .boolean()
        .optional()
        .describe("Filter out messages older than 14 days"),
});

export const CrosspostMessageSchema = z.object({
    channelId: z.string().describe("Announcement channel ID"),
    messageId: z.string().describe("Message ID to crosspost"),
});

// =============================================================================
// PRIVATE MESSAGE SCHEMAS
// =============================================================================

export const GetUserIdByNameSchema = z.object({
    username: z
        .string()
        .describe("Discord username (optionally username#discriminator)"),
    guildId: z.string().optional().describe("Discord server ID"),
});

export const SendPrivateMessageSchema = z.object({
    userId: z.string().describe("Discord user ID"),
    message: z.string().describe("Message content"),
});

export const EditPrivateMessageSchema = z.object({
    userId: z.string().describe("Discord user ID"),
    messageId: z.string().describe("Specific message ID"),
    newMessage: z.string().describe("New message content"),
});

export const DeletePrivateMessageSchema = z.object({
    userId: z.string().describe("Discord user ID"),
    messageId: z.string().describe("Specific message ID"),
});

export const ReadPrivateMessagesSchema = z.object({
    userId: z.string().describe("Discord user ID"),
    count: z.string().optional().describe("Number of messages to retrieve"),
});

// =============================================================================
// VOICE & AUDIO SCHEMAS
// =============================================================================

export const JoinVoiceChannelSchema = z.object({
    guildId: z.string().describe("Discord server ID"),
    channelId: z.string().describe("Voice channel ID"),
});

export const LeaveVoiceChannelSchema = z.object({
    guildId: z.string().describe("Discord server ID"),
    channelId: z.string().describe("Voice channel ID"),
});

export const PlayAudioSchema = z.object({
    guildId: z.string().describe("Discord server ID"),
    audioUrl: z.string().describe("URL or path to audio file"),
});

export const StopAudioSchema = z.object({
    guildId: z.string().describe("Discord server ID"),
});

export const SetVolumeSchema = z.object({
    guildId: z.string().describe("Discord server ID"),
    volume: z.number().min(0).max(200).describe("Volume level (0-200)"),
});

export const GetVoiceConnectionsSchema = z.object({});

// Enhanced Event & Scheduling Schemas
export const CreateEventSchema = z.object({
    guildId: z.string().describe("Discord server ID"),
    name: z.string().describe("Event name"),
    description: z.string().optional().describe("Event description"),
    startTime: z.string().describe("Event start time (ISO 8601)"),
    endTime: z.string().optional().describe("Event end time (ISO 8601)"),
    location: z.string().optional().describe("Event location"),
    channelId: z
        .string()
        .optional()
        .describe("Voice channel ID for voice events"),
});

export const EditEventSchema = z.object({
    guildId: z.string().describe("Discord server ID"),
    eventId: z.string().describe("Event ID"),
    name: z.string().optional().describe("New event name"),
    description: z.string().optional().describe("New event description"),
    startTime: z.string().optional().describe("New start time (ISO 8601)"),
    endTime: z.string().optional().describe("New end time (ISO 8601)"),
    location: z.string().optional().describe("New event location"),
});

export const DeleteEventSchema = z.object({
    guildId: z.string().describe("Discord server ID"),
    eventId: z.string().describe("Event ID"),
});

export const GetEventsSchema = z.object({
    guildId: z.string().describe("Discord server ID"),
});

// Enhanced Invite Management Schemas
export const CreateInviteSchema = z.object({
    channelId: z.string().describe("Channel ID"),
    maxAge: z
        .number()
        .optional()
        .describe("Invite expiration in seconds (0 = never)"),
    maxUses: z.number().optional().describe("Maximum uses (0 = unlimited)"),
    temporary: z.boolean().optional().describe("Grant temporary membership"),
});

export const DeleteInviteSchema = z.object({
    inviteCode: z.string().describe("Invite code"),
});

export const GetInvitesSchema = z.object({
    guildId: z.string().describe("Discord server ID"),
});

// Enhanced Emoji & Sticker Schemas
export const CreateEmojiSchema = z.object({
    guildId: z.string().describe("Discord server ID"),
    name: z.string().describe("Emoji name"),
    imageUrl: z.string().describe("Image URL or base64 data"),
    roles: z
        .array(z.string())
        .optional()
        .describe("Role IDs that can use this emoji"),
});

export const DeleteEmojiSchema = z.object({
    guildId: z.string().describe("Discord server ID"),
    emojiId: z.string().describe("Emoji ID"),
});

export const GetEmojisSchema = z.object({
    guildId: z.string().describe("Discord server ID"),
});

export const CreateStickerSchema = z.object({
    guildId: z.string().describe("Discord server ID"),
    name: z.string().describe("Sticker name"),
    description: z.string().describe("Sticker description"),
    tags: z.string().describe("Sticker tags"),
    imageUrl: z.string().describe("Image URL or file path"),
});

export const DeleteStickerSchema = z.object({
    guildId: z.string().describe("Discord server ID"),
    stickerId: z.string().describe("Sticker ID"),
});

export const GetStickersSchema = z.object({
    guildId: z.string().describe("Discord server ID"),
});

// Enhanced Attachment & File Schemas
export const UploadFileSchema = z.object({
    channelId: z.string().describe("Channel ID"),
    filePath: z.string().describe("Path to file or file URL"),
    fileName: z.string().optional().describe("Custom filename"),
    content: z
        .string()
        .optional()
        .describe("Message content to send with file"),
});

export const GetMessageAttachmentsSchema = z.object({
    channelId: z.string().describe("Channel ID"),
    messageId: z.string().describe("Message ID"),
});

export const ReadImagesSchema = z.object({
    channelId: z.string().describe("Channel ID"),
    messageId: z
        .string()
        .optional()
        .describe(
            "Specific message ID (optional - if not provided, reads latest image)",
        ),
    limit: z
        .number()
        .min(1)
        .max(10)
        .default(1)
        .describe("Number of recent messages to search for images"),
    includeMetadata: z
        .boolean()
        .default(true)
        .describe("Include image metadata (dimensions, file size, etc.)"),
    downloadImages: z
        .boolean()
        .default(false)
        .describe(
            "Download and analyze image content (slower but more detailed)",
        ),
});

// Advanced Interaction Schemas
export const SendModalSchema = z.object({
    interactionId: z.string().describe("Interaction ID"),
    title: z.string().describe("Modal title"),
    customId: z.string().describe("Custom ID for the modal"),
    components: z
        .array(
            z.object({
                type: z.number().describe("Component type"),
                label: z.string().describe("Component label"),
                style: z.number().optional().describe("Component style"),
                placeholder: z.string().optional().describe("Placeholder text"),
                required: z
                    .boolean()
                    .optional()
                    .describe("Whether field is required"),
            }),
        )
        .describe("Modal components"),
});

export const SendEmbedSchema = z.object({
    channelId: z.string().describe("Channel ID"),
    title: z.string().optional().describe("Embed title"),
    description: z.string().optional().describe("Embed description"),
    color: z.string().optional().describe("Embed color (hex)"),
    fields: z
        .array(
            z.object({
                name: z.string().describe("Field name"),
                value: z.string().describe("Field value"),
                inline: z
                    .boolean()
                    .optional()
                    .describe("Whether field is inline"),
            }),
        )
        .optional()
        .describe("Embed fields"),
    footer: z.string().optional().describe("Footer text"),
    image: z.string().optional().describe("Image URL"),
    thumbnail: z.string().optional().describe("Thumbnail URL"),
});

export const SendButtonSchema = z.object({
    channelId: z.string().describe("Channel ID"),
    content: z.string().optional().describe("Message content"),
    buttons: z
        .array(
            z.object({
                label: z.string().describe("Button label"),
                style: z
                    .enum(["PRIMARY", "SECONDARY", "SUCCESS", "DANGER", "LINK"])
                    .describe("Button style"),
                customId: z
                    .string()
                    .optional()
                    .describe("Custom ID for the button"),
                url: z.string().optional().describe("URL for link buttons"),
                emoji: z.string().optional().describe("Button emoji"),
            }),
        )
        .describe("Button components"),
});

export const SendSelectMenuSchema = z.object({
    channelId: z.string().describe("Channel ID"),
    content: z.string().optional().describe("Message content"),
    customId: z.string().describe("Custom ID for the select menu"),
    placeholder: z.string().optional().describe("Placeholder text"),
    minValues: z.number().optional().describe("Minimum values to select"),
    maxValues: z.number().optional().describe("Maximum values to select"),
    options: z
        .array(
            z.object({
                label: z.string().describe("Option label"),
                value: z.string().describe("Option value"),
                description: z
                    .string()
                    .optional()
                    .describe("Option description"),
                emoji: z.string().optional().describe("Option emoji"),
            }),
        )
        .describe("Select menu options"),
});

// Server Management Enhanced Schemas
export const EditServerSchema = z.object({
    guildId: z.string().describe("Discord server ID"),
    name: z.string().optional().describe("New server name"),
    description: z.string().optional().describe("New server description"),
    icon: z.string().optional().describe("New server icon URL"),
    banner: z.string().optional().describe("New server banner URL"),
    verificationLevel: z
        .enum(["NONE", "LOW", "MEDIUM", "HIGH", "VERY_HIGH"])
        .optional()
        .describe("Verification level"),
});

export const GetWelcomeScreenSchema = z.object({
    guildId: z.string().describe("Discord server ID"),
});

export const EditWelcomeScreenSchema = z.object({
    guildId: z.string().describe("Discord server ID"),
    enabled: z
        .boolean()
        .optional()
        .describe("Whether welcome screen is enabled"),
    description: z.string().optional().describe("Welcome screen description"),
    welcomeChannels: z
        .array(
            z.object({
                channelId: z.string().describe("Channel ID"),
                description: z.string().describe("Channel description"),
                emoji: z.string().optional().describe("Channel emoji"),
            }),
        )
        .optional()
        .describe("Welcome screen channels"),
});

// =============================================================================
// ANALYTICS & LOGGING SCHEMAS
// =============================================================================

export const GetMessageHistorySchema = z.object({
    channelId: z.string().describe("Channel ID"),
    limit: z.number().optional().describe("Number of messages to fetch"),
    before: z.string().optional().describe("Message ID to fetch before"),
    after: z.string().optional().describe("Message ID to fetch after"),
});

export const ExportChatLogSchema = z.object({
    channelId: z.string().describe("Channel ID"),
    format: z.enum(["JSON", "CSV", "TXT"]).describe("Export format"),
    limit: z.number().optional().describe("Number of messages to export"),
    dateRange: z
        .object({
            start: z.string().describe("Start date (ISO 8601)"),
            end: z.string().describe("End date (ISO 8601)"),
        })
        .optional()
        .describe("Date range filter"),
});

// Role Management Schemas
export const CreateRoleSchema = z.object({
    guildId: z.string().optional().describe("Discord server ID"),
    name: z.string().describe("Name of the role"),
    color: z.string().optional().describe("Role color (hex format)"),
    permissions: z
        .array(z.string())
        .optional()
        .describe("Array of permission names"),
});

export const DeleteRoleSchema = z.object({
    guildId: z.string().optional().describe("Discord server ID"),
    roleId: z.string().describe("Role ID"),
});

export const EditRoleSchema = z.object({
    guildId: z.string().optional().describe("Discord server ID"),
    roleId: z.string().describe("Role ID"),
    name: z.string().optional().describe("New name for the role"),
    color: z.string().optional().describe("New color (hex format)"),
    permissions: z
        .array(z.string())
        .optional()
        .describe("New permissions array"),
});

export const AddRoleToMemberSchema = z.object({
    guildId: z.string().optional().describe("Discord server ID"),
    userId: z.string().describe("Discord user ID"),
    roleId: z.string().describe("Role ID"),
});

export const RemoveRoleFromMemberSchema = z.object({
    guildId: z.string().optional().describe("Discord server ID"),
    userId: z.string().describe("Discord user ID"),
    roleId: z.string().describe("Role ID"),
});

export const GetRolesSchema = z.object({
    guildId: z.string().optional().describe("Discord server ID"),
});

export const SetRolePositionsSchema = z.object({
    guildId: z.string().optional().describe("Discord server ID"),
    rolePositions: z
        .array(
            z.object({
                roleId: z.string().describe("Role ID"),
                position: z.number().describe("New position"),
            }),
        )
        .describe("Array of role position updates"),
});

export const SetChannelPositionSchema = z.object({
    guildId: z.string().optional().describe("Discord server ID"),
    channelId: z.string().describe("Channel ID"),
    position: z.number().describe("New position"),
});

export const SetChannelPositionsSchema = z.object({
    guildId: z.string().optional().describe("Discord server ID"),
    channelPositions: z
        .array(
            z.object({
                channelId: z.string().describe("Channel ID"),
                position: z.number().describe("New position"),
            }),
        )
        .describe("Array of channel position updates"),
});

export const MoveChannelToCategorySchema = z.object({
    guildId: z.string().optional().describe("Discord server ID"),
    channelId: z.string().describe("Channel ID"),
    categoryId: z
        .string()
        .nullable()
        .describe("Category ID (null to remove from category)"),
});

export const SetCategoryPositionSchema = z.object({
    guildId: z.string().optional().describe("Discord server ID"),
    categoryId: z.string().describe("Category ID"),
    position: z.number().describe("New position"),
});

export const OrganizeChannelsSchema = z.object({
    guildId: z.string().optional().describe("Discord server ID"),
    organization: z
        .object({
            categories: z
                .array(
                    z.object({
                        categoryId: z.string().describe("Category ID"),
                        position: z.number().describe("New position"),
                    }),
                )
                .optional()
                .describe("Array of category position updates"),
            channels: z
                .array(
                    z.object({
                        channelId: z.string().describe("Channel ID"),
                        position: z
                            .number()
                            .optional()
                            .describe("New position (optional)"),
                        categoryId: z
                            .string()
                            .nullable()
                            .optional()
                            .describe(
                                "Category ID (null to remove from category, optional)",
                            ),
                    }),
                )
                .optional()
                .describe("Array of channel updates"),
        })
        .describe("Organization configuration"),
});

export const GetChannelStructureSchema = z.object({
    guildId: z.string().optional().describe("Discord server ID"),
});

// =============================================================================
// CHANNEL MANAGEMENT SCHEMAS
// =============================================================================

export const CreateTextChannelSchema = z.object({
    guildId: z.string().optional().describe("Discord server ID"),
    name: z.string().describe("Channel name"),
    categoryId: z.string().optional().describe("Category ID (optional)"),
});

export const CreateVoiceChannelSchema = z.object({
    guildId: z.string().optional().describe("Discord server ID"),
    name: z.string().describe("Voice channel name"),
    categoryId: z.string().optional().describe("Category ID (optional)"),
    userLimit: z
        .number()
        .min(0)
        .max(99)
        .optional()
        .describe("User limit (0-99, 0 = unlimited)"),
    bitrate: z
        .number()
        .min(8000)
        .max(384000)
        .optional()
        .describe(
            "Bitrate in bps (8000-384000, depends on server boost level)",
        ),
});

export const CreateForumChannelSchema = z.object({
    guildId: z.string().optional().describe("Discord server ID"),
    name: z.string().describe("Forum channel name"),
    categoryId: z.string().optional().describe("Category ID (optional)"),
    topic: z.string().optional().describe("Channel topic/description"),
    slowmode: z
        .number()
        .min(0)
        .max(21600)
        .optional()
        .describe("Slowmode in seconds (0-21600)"),
    defaultReactionEmoji: z
        .string()
        .optional()
        .describe("Default reaction emoji for posts"),
    isPrivate: z
        .boolean()
        .optional()
        .describe("Make channel private (deny @everyone access)"),
    allowedRoles: z
        .array(z.string())
        .optional()
        .describe("Role IDs to grant access to private channel"),
});

export const CreateAnnouncementChannelSchema = z.object({
    guildId: z.string().optional().describe("Discord server ID"),
    name: z.string().describe("Announcement channel name"),
    categoryId: z.string().optional().describe("Category ID (optional)"),
    topic: z.string().optional().describe("Channel topic/description"),
    slowmode: z
        .number()
        .min(0)
        .max(21600)
        .optional()
        .describe("Slowmode in seconds (0-21600)"),
    isPrivate: z
        .boolean()
        .optional()
        .describe("Make channel private (deny @everyone access)"),
    allowedRoles: z
        .array(z.string())
        .optional()
        .describe("Role IDs to grant access to private channel"),
});

export const CreateStageChannelSchema = z.object({
    guildId: z.string().optional().describe("Discord server ID"),
    name: z.string().describe("Stage channel name"),
    categoryId: z.string().optional().describe("Category ID (optional)"),
    topic: z.string().optional().describe("Channel topic/description"),
    bitrate: z
        .number()
        .min(8000)
        .max(384000)
        .optional()
        .describe(
            "Bitrate in bps (8000-384000, depends on server boost level)",
        ),
    isPrivate: z
        .boolean()
        .optional()
        .describe("Make channel private (deny @everyone access)"),
    allowedRoles: z
        .array(z.string())
        .optional()
        .describe("Role IDs to grant access to private channel"),
});

export const EditChannelAdvancedSchema = z.object({
    guildId: z.string().optional().describe("Discord server ID"),
    channelId: z.string().describe("Channel ID to edit"),
    name: z.string().optional().describe("New channel name"),
    topic: z.string().optional().describe("New channel topic/description"),
    slowmode: z
        .number()
        .min(0)
        .max(21600)
        .optional()
        .describe("Slowmode in seconds (0-21600)"),
    userLimit: z
        .number()
        .min(0)
        .max(99)
        .optional()
        .describe("User limit for voice channels (0-99, 0 = unlimited)"),
    bitrate: z
        .number()
        .min(8000)
        .max(384000)
        .optional()
        .describe("Bitrate for voice channels (8000-384000)"),
    isPrivate: z
        .boolean()
        .optional()
        .describe("Make channel private (deny @everyone access)"),
    allowedRoles: z
        .array(z.string())
        .optional()
        .describe("Role IDs to grant access to private channel"),
    categoryId: z
        .string()
        .nullable()
        .optional()
        .describe("Category ID (null to remove from category)"),
});

export const SetChannelPrivateSchema = z.object({
    guildId: z.string().optional().describe("Discord server ID"),
    channelId: z.string().describe("Channel ID"),
    isPrivate: z
        .boolean()
        .describe(
            "Make channel private (deny @everyone) or public (allow @everyone)",
        ),
    allowedRoles: z
        .array(z.string())
        .optional()
        .describe("Role IDs to grant access to private channel"),
    allowedMembers: z
        .array(z.string())
        .optional()
        .describe("Member IDs to grant access to private channel"),
    syncToCategory: z
        .boolean()
        .optional()
        .describe("Sync permissions with category after change"),
});

export const SetCategoryPrivateSchema = z.object({
    guildId: z.string().optional().describe("Discord server ID"),
    categoryId: z.string().describe("Category ID"),
    isPrivate: z
        .boolean()
        .describe(
            "Make category private (deny @everyone) or public (allow @everyone)",
        ),
    allowedRoles: z
        .array(z.string())
        .optional()
        .describe("Role IDs to grant access to private category"),
    allowedMembers: z
        .array(z.string())
        .optional()
        .describe("Member IDs to grant access to private category"),
    applyToChannels: z
        .boolean()
        .optional()
        .describe("Apply privacy settings to all channels in category"),
});

export const BulkSetPrivacySchema = z.object({
    guildId: z.string().optional().describe("Discord server ID"),
    targets: z
        .array(
            z.object({
                id: z.string().describe("Channel or category ID"),
                type: z
                    .enum(["channel", "category"])
                    .describe("Type of target"),
                isPrivate: z.boolean().describe("Make private or public"),
                allowedRoles: z
                    .array(z.string())
                    .optional()
                    .describe("Role IDs to grant access"),
                allowedMembers: z
                    .array(z.string())
                    .optional()
                    .describe("Member IDs to grant access"),
            }),
        )
        .describe("Array of channels/categories to update"),
});

export const ComprehensiveChannelManagementSchema = z.object({
    guildId: z.string().optional().describe("Discord server ID"),
    operations: z
        .array(
            z.object({
                action: z
                    .enum([
                        "create_text_channel",
                        "create_voice_channel",
                        "create_forum_channel",
                        "create_announcement_channel",
                        "create_stage_channel",
                        "create_category",
                        "edit_channel_advanced",
                        "delete_channel",
                        "delete_category",
                        "set_channel_position",
                        "set_category_position",
                        "move_channel_to_category",
                        "set_channel_private",
                        "set_category_private",
                    ])
                    .describe("Action to perform"),

                // Creation parameters
                name: z
                    .string()
                    .optional()
                    .describe("Name for new channels/categories"),
                categoryId: z
                    .string()
                    .nullable()
                    .optional()
                    .describe("Category ID for channel placement"),

                // Target identifiers
                channelId: z
                    .string()
                    .optional()
                    .describe("Target channel ID for operations"),
                targetCategoryId: z
                    .string()
                    .optional()
                    .describe("Target category ID for operations"),

                // Channel settings
                topic: z
                    .string()
                    .optional()
                    .describe("Channel topic/description"),
                slowmode: z
                    .number()
                    .min(0)
                    .max(21600)
                    .optional()
                    .describe("Slowmode in seconds (0-21600)"),
                userLimit: z
                    .number()
                    .min(0)
                    .max(99)
                    .optional()
                    .describe(
                        "User limit for voice channels (0-99, 0 = unlimited)",
                    ),
                bitrate: z
                    .number()
                    .min(8000)
                    .max(384000)
                    .optional()
                    .describe("Bitrate for voice channels (8000-384000)"),
                defaultReactionEmoji: z
                    .string()
                    .optional()
                    .describe("Default reaction emoji for forum posts"),

                // Positioning
                position: z
                    .number()
                    .optional()
                    .describe("New position for channel/category"),

                // Privacy settings
                isPrivate: z
                    .boolean()
                    .optional()
                    .describe("Make channel/category private"),
                allowedRoles: z
                    .array(z.string())
                    .optional()
                    .describe("Role IDs to grant access"),
                allowedMembers: z
                    .array(z.string())
                    .optional()
                    .describe("Member IDs to grant access"),
                syncToCategory: z
                    .boolean()
                    .optional()
                    .describe("Sync permissions with category"),
                applyToChannels: z
                    .boolean()
                    .optional()
                    .describe("Apply category privacy to all channels"),
            }),
        )
        .describe("Array of operations to perform in sequence"),
});

export const DeleteChannelSchema = z.object({
    guildId: z.string().optional().describe("Discord server ID"),
    channelId: z.string().describe("Discord channel ID"),
});

export const FindChannelSchema = z.object({
    guildId: z.string().optional().describe("Discord server ID"),
    channelName: z.string().describe("Discord channel name"),
});

export const ListChannelsSchema = z.object({
    guildId: z.string().optional().describe("Discord server ID"),
});

export const CreateCategorySchema = z.object({
    guildId: z.string().optional().describe("Discord server ID"),
    name: z.string().describe("Discord category name"),
});

export const DeleteCategorySchema = z.object({
    guildId: z.string().optional().describe("Discord server ID"),
    categoryId: z.string().describe("Discord category ID"),
});

export const FindCategorySchema = z.object({
    guildId: z.string().optional().describe("Discord server ID"),
    categoryName: z.string().describe("Discord category name"),
});

export const ListChannelsInCategorySchema = z.object({
    guildId: z.string().optional().describe("Discord server ID"),
    categoryId: z.string().describe("Discord category ID"),
});

export const CreateWebhookSchema = z.object({
    channelId: z.string().describe("Discord channel ID"),
    name: z.string().describe("Webhook name"),
});

export const DeleteWebhookSchema = z.object({
    webhookId: z.string().describe("Discord webhook ID"),
});

export const ListWebhooksSchema = z.object({
    channelId: z.string().describe("Discord channel ID"),
});

export const SendWebhookMessageSchema = z.object({
    webhookUrl: z.string().describe("Discord webhook link"),
    message: z.string().describe("Message content"),
});

// =============================================================================
// MEMBER MANAGEMENT SCHEMAS
// =============================================================================

// Enhanced Member Management Schemas
export const GetMembersSchema = z.object({
    guildId: z.string().optional().describe("Discord server ID"),
    limit: z
        .number()
        .optional()
        .describe("Number of members to fetch (default 100)"),
    after: z.string().optional().describe("User ID to fetch members after"),
});

export const SearchMembersSchema = z.object({
    guildId: z.string().optional().describe("Discord server ID"),
    query: z.string().describe("Search query (username or nickname)"),
    limit: z.number().optional().describe("Max results to return"),
});

export const EditMemberSchema = z.object({
    guildId: z.string().optional().describe("Discord server ID"),
    userId: z.string().describe("Discord user ID"),
    nickname: z.string().optional().describe("New nickname"),
    roles: z.array(z.string()).optional().describe("Array of role IDs to set"),
});

export const GetMemberInfoSchema = z.object({
    guildId: z.string().optional().describe("Discord server ID"),
    userId: z.string().describe("Discord user ID"),
});

// Enhanced Automod Schemas
export const CreateAutomodRuleSchema = z.object({
    guildId: z.string().describe("Discord server ID"),
    name: z.string().describe("Rule name"),
    eventType: z.enum(["MESSAGE_SEND"]).describe("Event type to trigger on"),
    triggerType: z
        .enum(["KEYWORD", "SPAM", "KEYWORD_PRESET", "MENTION_SPAM"])
        .describe("Trigger type"),
    keywordFilter: z
        .array(z.string())
        .optional()
        .describe("Keywords to filter"),
    presets: z.array(z.string()).optional().describe("Preset keyword lists"),
    allowList: z.array(z.string()).optional().describe("Allowed words"),
    mentionLimit: z.number().optional().describe("Max mentions allowed"),
    enabled: z.boolean().optional().describe("Whether rule is enabled"),
});

export const EditAutomodRuleSchema = z.object({
    guildId: z.string().describe("Discord server ID"),
    ruleId: z.string().describe("Automod rule ID"),
    name: z.string().optional().describe("New rule name"),
    enabled: z.boolean().optional().describe("Whether rule is enabled"),
    keywordFilter: z
        .array(z.string())
        .optional()
        .describe("Keywords to filter"),
    allowList: z.array(z.string()).optional().describe("Allowed words"),
    mentionLimit: z.number().optional().describe("Max mentions allowed"),
});

export const DeleteAutomodRuleSchema = z.object({
    guildId: z.string().describe("Discord server ID"),
    ruleId: z.string().describe("Automod rule ID"),
});

export const GetAutomodRulesSchema = z.object({
    guildId: z.string().describe("Discord server ID"),
});

// Enhanced Permission Management Schemas
export const SetChannelPermissionsSchema = z.object({
    channelId: z.string().describe("Channel ID"),
    targetId: z.string().describe("Role or member ID"),
    targetType: z.enum(["role", "member"]).describe("Target type"),
    allow: z.array(z.string()).optional().describe("Permissions to allow"),
    deny: z.array(z.string()).optional().describe("Permissions to deny"),
});

export const GetChannelPermissionsSchema = z.object({
    channelId: z.string().describe("Channel ID"),
});

export const SyncChannelPermissionsSchema = z.object({
    channelId: z.string().describe("Channel ID"),
});

// Enhanced Thread Management Schemas
export const CreateThreadSchema = z.object({
    channelId: z.string().describe("Channel ID"),
    name: z.string().describe("Thread name"),
    autoArchiveDuration: z
        .number()
        .optional()
        .describe("Auto archive duration in minutes"),
    messageId: z
        .string()
        .optional()
        .describe("Message ID to create thread from"),
});

export const ArchiveThreadSchema = z.object({
    threadId: z.string().describe("Thread ID"),
    reason: z.string().optional().describe("Reason for archiving"),
});

export const UnarchiveThreadSchema = z.object({
    threadId: z.string().describe("Thread ID"),
    reason: z.string().optional().describe("Reason for unarchiving"),
});

export const LockThreadSchema = z.object({
    threadId: z.string().describe("Thread ID"),
    reason: z.string().optional().describe("Reason for locking"),
});

export const UnlockThreadSchema = z.object({
    threadId: z.string().describe("Thread ID"),
    reason: z.string().optional().describe("Reason for unlocking"),
});

export const JoinThreadSchema = z.object({
    threadId: z.string().describe("Thread ID"),
});

export const LeaveThreadSchema = z.object({
    threadId: z.string().describe("Thread ID"),
});

export const GetActiveThreadsSchema = z.object({
    guildId: z.string().optional().describe("Discord server ID"),
});

// Enhanced Moderation Schemas
export const BanMemberSchema = z.object({
    guildId: z.string().optional().describe("Discord server ID"),
    userId: z.string().describe("Discord user ID"),
    reason: z.string().optional().describe("Reason for ban"),
    deleteMessageDays: z
        .number()
        .optional()
        .describe("Days of messages to delete (0-7)"),
});

export const UnbanMemberSchema = z.object({
    guildId: z.string().optional().describe("Discord server ID"),
    userId: z.string().describe("Discord user ID"),
    reason: z.string().optional().describe("Reason for unban"),
});

export const KickMemberSchema = z.object({
    guildId: z.string().optional().describe("Discord server ID"),
    userId: z.string().describe("Discord user ID"),
    reason: z.string().optional().describe("Reason for kick"),
});

export const TimeoutMemberSchema = z.object({
    guildId: z.string().optional().describe("Discord server ID"),
    userId: z.string().describe("Discord user ID"),
    duration: z.number().describe("Timeout duration in minutes"),
    reason: z.string().optional().describe("Reason for timeout"),
});

export const RemoveTimeoutSchema = z.object({
    guildId: z.string().optional().describe("Discord server ID"),
    userId: z.string().describe("Discord user ID"),
    reason: z.string().optional().describe("Reason for removing timeout"),
});

export const GetAuditLogsSchema = z.object({
    guildId: z.string().optional().describe("Discord server ID"),
    limit: z
        .number()
        .optional()
        .describe("Number of audit log entries to fetch"),
    actionType: z.string().optional().describe("Filter by action type"),
});

export const GetBansSchema = z.object({
    guildId: z.string().optional().describe("Discord server ID"),
});
