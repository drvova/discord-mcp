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

// =============================================================================
// DISCORD RUNTIME OPERATIONS - reached from the run tool as ops.<name>(params)
// =============================================================================

export const InvokeDiscordjsSymbolContextSchema = z.object({
    guildId: z.string().optional().describe("Discord server ID"),
    channelId: z.string().optional().describe("Discord channel ID"),
    threadId: z.string().optional().describe("Discord thread channel ID"),
    messageId: z.string().optional().describe("Discord message ID"),
    userId: z.string().optional().describe("Discord user ID"),
    memberId: z.string().optional().describe("Discord guild member ID"),
    roleId: z.string().optional().describe("Discord role ID"),
    emojiId: z.string().optional().describe("Discord emoji ID"),
    stickerId: z.string().optional().describe("Discord sticker ID"),
    eventId: z.string().optional().describe("Discord scheduled event ID"),
    inviteCode: z.string().optional().describe("Discord invite code"),
    webhookId: z.string().optional().describe("Discord webhook ID"),
});

export const InvokeDiscordjsSymbolSchema = z.object({
    packageAlias: z
        .string()
        .optional()
        .describe(
            "Runtime package alias (for example: discordjs, discordjs_voice).",
        ),
    symbol: z
        .string()
        .min(1)
        .describe(
            "discord.js symbol name (for example: channelMention, Guild#fetch, Client.login)",
        ),
    kind: z
        .enum([
            "class",
            "enum",
            "interface",
            "function",
            "type",
            "const",
            "variable",
            "event",
            "namespace",
            "external",
        ])
        .optional()
        .describe("Optional symbol kind disambiguation"),
    invoke: z
        .boolean()
        .optional()
        .describe("Invoke callable symbols when true (defaults to true)"),
    args: z
        .array(z.unknown())
        .optional()
        .describe("Positional arguments for invocation"),
    target: z
        .enum([
            "auto",
            "client",
            "guild",
            "channel",
            "thread",
            "message",
            "user",
            "member",
            "role",
            "emoji",
            "sticker",
            "event",
            "invite",
            "webhook",
            "guild_manager",
            "channel_manager",
            "user_manager",
            "member_manager",
            "role_manager",
            "emoji_manager",
            "sticker_manager",
            "scheduled_event_manager",
            "message_manager",
            "thread_manager",
            "application_command_manager",
            "application_emoji_manager",
        ])
        .optional()
        .describe("Explicit invocation target resolver"),
    context: InvokeDiscordjsSymbolContextSchema.optional(),
    dryRun: z
        .boolean()
        .optional()
        .describe(
            "Resolve symbol target and policy without executing the invocation",
        ),
    allowWrite: z
        .boolean()
        .optional()
        .describe(
            "Required for write/admin/dangerous dynamic symbol invocations",
        ),
    policyMode: z
        .enum(["strict", "permissive"])
        .optional()
        .describe("Invocation policy mode (strict by default)"),
});

export const DiscordMetaPackagesSchema = z.object({
    package: z
        .string()
        .optional()
        .describe("Optional package alias or package name filter"),
    packages: z
        .array(z.string())
        .optional()
        .describe("Optional package aliases or package names filter"),
});

export const DiscordMetaSymbolsSchema = z.object({
    packageAlias: z
        .string()
        .optional()
        .describe("Optional package alias selector"),
    package: z
        .string()
        .optional()
        .describe("Optional package alias or package name selector"),
    packages: z
        .array(z.string())
        .optional()
        .describe("Optional package aliases or package names selector"),
    kinds: z
        .array(
            z.enum([
                "class",
                "enum",
                "interface",
                "function",
                "type",
                "const",
                "variable",
                "event",
                "namespace",
                "external",
            ]),
        )
        .optional()
        .describe("Symbol kinds to include"),
    query: z
        .string()
        .optional()
        .describe("Case-insensitive symbol name filter"),
    page: z.number().int().min(1).optional().describe("Page number"),
    pageSize: z
        .number()
        .int()
        .min(1)
        .max(200)
        .optional()
        .describe("Page size (1-200)"),
    sort: z
        .enum(["name_asc", "name_desc"])
        .optional()
        .describe("Sort order by symbol name"),
    includeKindCounts: z
        .boolean()
        .optional()
        .describe("Include aggregated per-kind counts"),
    includeAliases: z
        .boolean()
        .optional()
        .describe("Include alias symbols"),
    includeOperationalMatrix: z
        .boolean()
        .optional()
        .describe("Include per-symbol operational matrix (defaults to true)"),
});

export const DiscordMetaPreflightSchema = z.object({
    packageAlias: z
        .string()
        .describe("Runtime package alias (for example: discordjs, discordjs_voice)"),
    symbol: z
        .string()
        .min(1)
        .describe("Symbol to preflight (for example: TextChannel#send)"),
    kind: z
        .enum([
            "class",
            "enum",
            "interface",
            "function",
            "type",
            "const",
            "variable",
            "event",
            "namespace",
            "external",
        ])
        .optional()
        .describe("Optional symbol kind disambiguation"),
    target: InvokeDiscordjsSymbolSchema.shape.target.optional(),
    context: InvokeDiscordjsSymbolContextSchema.optional(),
    args: z
        .array(z.unknown())
        .optional()
        .describe("Optional positional arguments for readiness checks"),
    allowWrite: z
        .boolean()
        .optional()
        .describe("Allow write/admin/dangerous preflight path"),
    policyMode: z
        .enum(["strict", "permissive"])
        .optional()
        .describe("Policy mode (strict by default)"),
    strictContextCheck: z
        .boolean()
        .optional()
        .describe(
            "When true (default), unresolved targets/context requirements fail preflight canExecute.",
        ),
    strictArgCheck: z
        .boolean()
        .optional()
        .describe(
            "When true, preflight enforces providedArgCount >= requiredArgCount when available.",
        ),
});

export const DiscordMetaRefreshSchema = z.object({
    force: z
        .boolean()
        .optional()
        .describe("Force rebuild of runtime package/symbol catalog"),
    includeDiff: z
        .boolean()
        .optional()
        .describe(
            "Include package and symbol diffs against the previous catalog snapshot (defaults to true).",
        ),
});

export const DiscordExecInvokeSchema = z.object({
    packageAlias: z
        .string()
        .describe("Runtime package alias (for example: discordjs, discordjs_voice)"),
    symbol: z
        .string()
        .min(1)
        .describe("Symbol to invoke"),
    kind: z
        .enum([
            "class",
            "enum",
            "interface",
            "function",
            "type",
            "const",
            "variable",
            "event",
            "namespace",
            "external",
        ])
        .optional()
        .describe("Optional symbol kind disambiguation"),
    invoke: z
        .boolean()
        .optional()
        .describe("Execute invocation (defaults to true)"),
    dryRun: z
        .boolean()
        .optional()
        .describe("Dry-run only (defaults to true for safe-by-default behavior)"),
    requirePreflightPass: z
        .boolean()
        .optional()
        .describe(
            "Require preflight canExecute=true before non-dry-run execution (defaults to true when dryRun=false).",
        ),
    preflightToken: z
        .string()
        .optional()
        .describe(
            "Optional preflight token to bind invocation to a preflight input set.",
        ),
    allowWrite: z
        .boolean()
        .optional()
        .describe("Required for write/admin/dangerous execution"),
    policyMode: z
        .enum(["strict", "permissive"])
        .optional()
        .describe("Policy mode (strict by default)"),
    args: z.array(z.unknown()).optional().describe("Invocation positional args"),
    target: InvokeDiscordjsSymbolSchema.shape.target.optional(),
    context: InvokeDiscordjsSymbolContextSchema.optional(),
});

export const DiscordExecBatchSchema = z.object({
    mode: z
        .enum(["best_effort", "all_or_none"])
        .optional()
        .describe("Batch execution mode"),
    dryRun: z
        .boolean()
        .optional()
        .describe("Dry-run all items (defaults to true)"),
    haltOnPolicyBlock: z
        .boolean()
        .optional()
        .describe(
            "When true, run preflight for all items and abort before execution if any item is blocked.",
        ),
    maxParallelism: z
        .number()
        .int()
        .min(1)
        .max(32)
        .optional()
        .describe("Max concurrent item executions (defaults to 4)"),
    items: z
        .array(DiscordExecInvokeSchema)
        .min(1)
        .max(100)
        .describe("Invocation batch items"),
});
