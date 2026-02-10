import { inspect } from "node:util";
import { z } from "zod";
import {
    Client,
    Collection,
    GatewayIntentBits,
    Guild,
    GuildEmoji,
    GuildScheduledEvent,
    Invite,
    Message,
    Partials,
    Role,
    Sticker,
    ThreadChannel,
    User,
} from "discord.js";
import { AuthConfigSchema, SwitchTokenSchema } from "./types.js";
import { DEFAULT_DISCORD_INTENTS } from "./core/ConfigManager.js";
import {
    classifyDiscordJsSymbolBehavior,
    getDiscordJsSymbolsCatalog,
} from "./gateway/discordjs-symbol-catalog.js";

type DiscordJsInvocationKind =
    | "class"
    | "enum"
    | "interface"
    | "function"
    | "type"
    | "const"
    | "variable"
    | "event"
    | "namespace"
    | "external";

type DiscordJsInvocationTarget =
    | "auto"
    | "client"
    | "guild"
    | "channel"
    | "thread"
    | "message"
    | "user"
    | "member"
    | "role"
    | "emoji"
    | "sticker"
    | "event"
    | "invite"
    | "webhook"
    | "guild_manager"
    | "channel_manager"
    | "user_manager"
    | "member_manager"
    | "role_manager"
    | "emoji_manager"
    | "sticker_manager"
    | "scheduled_event_manager"
    | "message_manager"
    | "thread_manager"
    | "application_command_manager"
    | "application_emoji_manager";

type DiscordJsInvocationContextInput = {
    guildId?: string;
    channelId?: string;
    threadId?: string;
    messageId?: string;
    userId?: string;
    memberId?: string;
    roleId?: string;
    emojiId?: string;
    stickerId?: string;
    eventId?: string;
    inviteCode?: string;
    webhookId?: string;
};

type DiscordJsPolicyMode = "strict" | "permissive";
type DiscordJsBehaviorClass =
    | "read"
    | "write"
    | "admin"
    | "dangerous"
    | "unknown";

type DiscordJsInvocationPolicyResult = {
    decision: "allow" | "blocked";
    behaviorClass: DiscordJsBehaviorClass;
    requiresAllowWrite: boolean;
    reason?: string;
};

type ResolvedDiscordJsInvocationContext = {
    client: Client;
    guild?: Guild;
    channel?: unknown;
    thread?: ThreadChannel;
    message?: Message;
    user?: User;
    member?: unknown;
    role?: Role;
    emoji?: GuildEmoji;
    sticker?: Sticker;
    event?: GuildScheduledEvent;
    invite?: Invite;
    webhook?: unknown;
};

const DYNAMIC_WRITE_ALLOWLIST_EXACT = new Set([
    "Collection#set",
    "Collection#delete",
    "Collection#clear",
]);

const DYNAMIC_WRITE_ALLOWLIST_PATTERNS: RegExp[] = [
    /^[A-Za-z_$][A-Za-z0-9_$]*Builder[#.]/,
    /^[A-Za-z_$][A-Za-z0-9_$]*Builder$/,
    /^StringSelectMenuOptionBuilder[#.]/,
    /^ActionRowBuilder[#.]/,
    /^EmbedBuilder[#.]/,
];

export class DiscordService {
    private client: Client;
    private defaultGuildId?: string;
    private isReady = false;
    private currentAuthConfig: z.infer<typeof AuthConfigSchema>;

    constructor(authConfig?: z.infer<typeof AuthConfigSchema>) {
        const resolvedIntents =
            authConfig?.intents && authConfig.intents.length > 0
                ? [...authConfig.intents]
                : [...DEFAULT_DISCORD_INTENTS];

        this.currentAuthConfig = authConfig
            ? AuthConfigSchema.parse({
                  ...authConfig,
                  intents: resolvedIntents,
              })
            : AuthConfigSchema.parse({
                  tokenType: "bot",
                  token: process.env.DISCORD_TOKEN || "",
                  intents: resolvedIntents,
              });

        this.defaultGuildId = process.env.DISCORD_GUILD_ID;
        this.client = this.createClient(this.currentAuthConfig);
    }

    getCurrentAuthConfig(): z.infer<typeof AuthConfigSchema> {
        return { ...this.currentAuthConfig };
    }

    getBotApplicationId(): string | undefined {
        return this.client.application?.id || this.client.user?.id;
    }

    async initialize(): Promise<void> {
        if (this.isReady) {
            return;
        }

        const token = this.currentAuthConfig.token;
        if (!token) {
            const tokenEnvVar =
                this.currentAuthConfig.tokenType === "user"
                    ? "DISCORD_USER_TOKEN"
                    : "DISCORD_TOKEN";
            throw new Error(
                `The environment variable ${tokenEnvVar} is not set.`,
            );
        }

        await new Promise<void>((resolve, reject) => {
            this.client.once("ready", async () => {
                try {
                    await this.client.guilds.fetch();
                    for (const guild of this.client.guilds.cache.values()) {
                        await guild.channels.fetch();
                    }
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

            this.client.login(token).catch((error) => {
                if (
                    error instanceof Error &&
                    error.message.includes("Used disallowed intents")
                ) {
                    reject(
                        new Error(
                            "Used disallowed intents. Remove privileged intents from DISCORD_INTENTS (GuildMembers, MessageContent, GuildPresences), or enable them in Discord Developer Portal -> Bot -> Privileged Gateway Intents.",
                        ),
                    );
                    return;
                }

                reject(error);
            });
        });
    }

    async switchToken(
        switchConfig: z.infer<typeof SwitchTokenSchema>,
    ): Promise<string> {
        const parsed = SwitchTokenSchema.parse(switchConfig);
        const newToken =
            parsed.token ||
            (parsed.tokenType === "user"
                ? process.env.DISCORD_USER_TOKEN
                : process.env.DISCORD_TOKEN);

        if (!newToken) {
            const tokenEnvVar =
                parsed.tokenType === "user"
                    ? "DISCORD_USER_TOKEN"
                    : "DISCORD_TOKEN";
            throw new Error(
                `Token switch failed: ${tokenEnvVar} environment variable is not set`,
            );
        }

        const previousConfig = { ...this.currentAuthConfig };
        const previousReady = this.isReady;

        try {
            if (previousReady) {
                await this.destroy();
            }

            this.currentAuthConfig = {
                tokenType: parsed.tokenType,
                token: newToken,
                intents: [
                    ...(previousConfig.intents || DEFAULT_DISCORD_INTENTS),
                ],
            };
            this.client = this.createClient(this.currentAuthConfig);
            this.isReady = false;

            await this.initialize();

            const userType =
                this.currentAuthConfig.tokenType === "user"
                    ? "user account"
                    : "bot";
            return `Successfully switched to ${userType} token. Logged in as ${this.client.user?.tag}`;
        } catch (error) {
            this.currentAuthConfig = previousConfig;
            this.client = this.createClient(previousConfig);
            this.isReady = false;

            if (previousReady) {
                await this.initialize();
            }

            throw new Error(
                `Token switch failed: ${error instanceof Error ? error.message : "Unknown error"}`,
            );
        }
    }

    async invokeDiscordJsSymbol(input: {
        symbol: string;
        kind?: DiscordJsInvocationKind;
        invoke?: boolean;
        dryRun?: boolean;
        allowWrite?: boolean;
        policyMode?: DiscordJsPolicyMode;
        args?: unknown[];
        target?: DiscordJsInvocationTarget;
        context?: DiscordJsInvocationContextInput;
    }): Promise<string> {
        this.ensureReady();

        const symbol = input.symbol.trim();
        if (!symbol) {
            throw new Error("Symbol cannot be empty.");
        }

        const catalog = await getDiscordJsSymbolsCatalog({
            query: symbol,
            page: 1,
            pageSize: 10000,
        });

        const matches = catalog.items.filter(
            (item) =>
                item.name === symbol &&
                (input.kind ? item.kind === input.kind : true),
        );

        if (matches.length === 0) {
            const suggestions = catalog.items
                .slice(0, 10)
                .map((item) => `${item.name}:${item.kind}`);
            throw new Error(
                `Symbol '${symbol}' was not found in discord.js catalog.${suggestions.length > 0 ? ` Suggestions: ${suggestions.join(", ")}` : ""}`,
            );
        }

        const kind = this.pickSymbolKind(
            matches.map((item) => item.kind as DiscordJsInvocationKind),
            input.kind,
        );
        const symbolMeta = matches.find((item) => item.kind === kind) || matches[0];
        const invoke = input.invoke ?? true;
        const dryRun = input.dryRun ?? false;
        const allowWrite = input.allowWrite ?? false;
        const policyMode = input.policyMode ?? "strict";
        const rawArgs = input.args || [];
        const behaviorClass =
            (symbolMeta.behaviorClass as DiscordJsBehaviorClass | undefined) ||
            classifyDiscordJsSymbolBehavior(symbol, kind);

        const context = await this.resolveInvocationContext(input.context);
        const resolvedArgs = this.resolveArgsWithRefs(rawArgs, context);
        const discordExports = (await import("discord.js")) as Record<
            string,
            unknown
        >;

        const instanceMatch = symbol.match(
            /^([A-Za-z_$][A-Za-z0-9_$]*)#([A-Za-z_$][A-Za-z0-9_$]*)$/,
        );
        const staticMatch = symbol.match(
            /^([A-Za-z_$][A-Za-z0-9_$]*)\.([A-Za-z_$][A-Za-z0-9_$]*)$/,
        );

        let callable: ((...args: unknown[]) => unknown | Promise<unknown>) | null =
            null;
        let value: unknown = undefined;
        let invocationMode: "export" | "instance" | "static" | "metadata" =
            "metadata";
        let targetLabel = "export";
        let resolvedTarget: unknown = undefined;
        let classNameForInvocation: string | undefined;

        if (instanceMatch) {
            const className = instanceMatch[1];
            const methodName = instanceMatch[2];
            classNameForInvocation = className;
            invocationMode = "instance";

            const explicitTarget = input.target
                ? this.getContextValueByTarget(input.target, context)
                : undefined;
            const autoTarget =
                input.target && input.target !== "auto"
                    ? undefined
                    : this.resolveAutoTargetForClass(className, context);
            const targetObject = explicitTarget ?? autoTarget;
            targetLabel =
                input.target && input.target !== "auto"
                    ? input.target
                    : className;
            resolvedTarget = targetObject;

            if (!targetObject || typeof targetObject !== "object") {
                if (!dryRun) {
                    throw new Error(
                        `Unable to resolve target instance for '${className}#${methodName}'. Provide 'target' and context IDs.`,
                    );
                }
            } else {
                const methodValue = (targetObject as Record<string, unknown>)[
                    methodName
                ];
                if (typeof methodValue !== "function") {
                    if (!dryRun) {
                        throw new Error(
                            `Resolved target for '${className}#${methodName}' does not expose a callable '${methodName}' method.`,
                        );
                    }
                } else {
                    callable = methodValue.bind(targetObject);
                    value = methodValue;
                }
            }
        } else if (staticMatch) {
            const className = staticMatch[1];
            const methodName = staticMatch[2];
            classNameForInvocation = className;
            invocationMode = "static";

            const classValue = discordExports[className];
            targetLabel = className;
            resolvedTarget = classValue;

            if (!classValue || typeof classValue !== "function") {
                if (!dryRun) {
                    throw new Error(
                        `Class export '${className}' was not found in discord.js runtime exports.`,
                    );
                }
            } else {
                const staticContainer = classValue as unknown as Record<
                    string,
                    unknown
                >;
                const staticValue = staticContainer[methodName];
                if (typeof staticValue !== "function") {
                    if (!dryRun) {
                        throw new Error(
                            `Static method '${className}.${methodName}' was not found or is not callable.`,
                        );
                    }
                } else {
                    callable = staticValue.bind(classValue);
                    value = staticValue;
                }
            }
        } else {
            invocationMode = "export";
            value = discordExports[symbol];
            resolvedTarget = value;

            if (typeof value === "function") {
                const fn = value as (...args: unknown[]) => unknown;
                const source = Function.prototype.toString.call(fn);
                const isClassConstructor = source.startsWith("class ");
                if (!isClassConstructor) {
                    callable = fn;
                }
            }
        }

        const canInvoke =
            kind === "function" &&
            callable !== null &&
            typeof callable === "function";
        const policyResult = this.evaluateDiscordJsInvocationPolicy({
            symbol,
            behaviorClass,
            allowWrite,
            policyMode,
        });
        const contextRequirements = this.inferInvocationContextRequirements({
            target: input.target,
            invocationMode,
            className: classNameForInvocation,
        });
        const resolvedTargetSummary = this.summarizeResolvedTarget(
            targetLabel,
            resolvedTarget,
        );

        if (dryRun) {
            return JSON.stringify(
                {
                    symbol,
                    kind,
                    docsPath: symbolMeta.docsPath,
                    dryRun: true,
                    invocationMode,
                    callable: canInvoke,
                    behaviorClass,
                    policyMode,
                    policyDecision: policyResult.decision,
                    requiresAllowWrite: policyResult.requiresAllowWrite,
                    blockedReason: policyResult.reason,
                    resolvedTarget: resolvedTargetSummary,
                    contextRequirements,
                    argCount: resolvedArgs.length,
                    wouldInvoke:
                        invoke &&
                        canInvoke &&
                        policyResult.decision === "allow",
                },
                null,
                2,
            );
        }

        if (invoke && !canInvoke) {
            throw new Error(
                `Symbol '${symbol}' (${kind}) is not invokable. Use 'invoke: false' to fetch metadata/value.`,
            );
        }

        if (!invoke || !callable) {
            const payload: Record<string, unknown> = {
                symbol,
                kind,
                docsPath: symbolMeta.docsPath,
                invocationMode,
                callable: canInvoke,
                behaviorClass,
                policyMode,
                policyDecision: policyResult.decision,
                requiresAllowWrite: policyResult.requiresAllowWrite,
                resolvedTarget: resolvedTargetSummary,
                contextRequirements,
            };

            if (policyResult.reason) {
                payload.blockedReason = policyResult.reason;
            }

            if (kind === "event") {
                payload.eventMetadata = this.buildEventMetadata(symbol, discordExports);
            } else {
                payload.value = this.serializeInvocationValue(value);
            }

            return JSON.stringify(payload, null, 2);
        }

        if (policyResult.decision === "blocked") {
            return JSON.stringify(
                {
                    symbol,
                    kind,
                    docsPath: symbolMeta.docsPath,
                    invoked: false,
                    invocationMode,
                    behaviorClass,
                    policyMode,
                    policyDecision: "blocked",
                    requiresAllowWrite: policyResult.requiresAllowWrite,
                    blockedReason: policyResult.reason,
                    resolvedTarget: resolvedTargetSummary,
                    contextRequirements,
                },
                null,
                2,
            );
        }

        let result: unknown;
        try {
            result = await Promise.resolve(callable(...resolvedArgs));
        } catch (error) {
            throw new Error(
                `Invocation failed for '${symbol}': ${error instanceof Error ? error.message : String(error)}`,
            );
        }

        return JSON.stringify(
            {
                symbol,
                kind,
                docsPath: symbolMeta.docsPath,
                invoked: true,
                invocationMode,
                target: targetLabel || input.target || "export",
                behaviorClass,
                policyMode,
                policyDecision: "allow",
                requiresAllowWrite: policyResult.requiresAllowWrite,
                resolvedTarget: resolvedTargetSummary,
                contextRequirements,
                result: this.serializeInvocationValue(result),
            },
            null,
            2,
        );
    }

    async destroy(): Promise<void> {
        this.isReady = false;
        await this.client.destroy();
    }

    private createClient(config: z.infer<typeof AuthConfigSchema>): Client {
        const intents = this.getIntentsForConfig(config.intents);

        return new Client({
            intents,
            partials:
                config.tokenType === "user"
                    ? [
                          Partials.User,
                          Partials.Channel,
                          Partials.GuildMember,
                          Partials.Message,
                      ]
                    : [],
        });
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

        const normalizedIntents =
            intentNames && intentNames.length > 0
                ? intentNames
                : DEFAULT_DISCORD_INTENTS;

        const resolvedIntents = normalizedIntents
            .map((name) => intentMap[name])
            .filter(Boolean) as GatewayIntentBits[];

        return Array.from(new Set(resolvedIntents));
    }

    private ensureReady(): void {
        if (!this.isReady) {
            throw new Error("Discord client is not ready");
        }
    }

    private async fetchChannelForInvocation(channelId: string): Promise<unknown> {
        const cached = this.client.channels.cache.get(channelId);
        if (cached) {
            return cached;
        }

        const fetched = await this.client.channels.fetch(channelId);
        if (!fetched) {
            throw new Error(`Channel '${channelId}' was not found.`);
        }

        return fetched;
    }

    private async resolveInvocationContext(
        input: DiscordJsInvocationContextInput = {},
    ): Promise<ResolvedDiscordJsInvocationContext> {
        const context: ResolvedDiscordJsInvocationContext = {
            client: this.client,
        };

        const guildId = input.guildId || this.defaultGuildId;
        if (guildId) {
            context.guild =
                this.client.guilds.cache.get(guildId) ||
                (await this.client.guilds.fetch(guildId));
        }

        if (input.channelId) {
            context.channel = await this.fetchChannelForInvocation(input.channelId);
        }

        if (input.threadId) {
            const threadCandidate = await this.fetchChannelForInvocation(
                input.threadId,
            );
            if (!(threadCandidate instanceof ThreadChannel)) {
                throw new Error(
                    `Channel '${input.threadId}' is not a ThreadChannel.`,
                );
            }
            context.thread = threadCandidate;
            context.channel = context.channel ?? threadCandidate;
        }

        if (input.userId) {
            context.user = await this.client.users.fetch(input.userId);
        }

        if (input.memberId) {
            const resolvedGuild =
                context.guild ||
                (guildId
                    ? this.client.guilds.cache.get(guildId) ||
                      (await this.client.guilds.fetch(guildId))
                    : undefined);
            if (!resolvedGuild) {
                throw new Error(
                    "memberId resolution requires guildId (or DISCORD_GUILD_ID default).",
                );
            }
            context.guild = resolvedGuild;
            context.member = await resolvedGuild.members.fetch(input.memberId);
        }

        if (input.roleId) {
            if (!context.guild) {
                throw new Error(
                    "roleId resolution requires guildId (or DISCORD_GUILD_ID default).",
                );
            }
            const resolvedRole = await context.guild.roles.fetch(input.roleId);
            if (!resolvedRole) {
                throw new Error(`Role '${input.roleId}' was not found.`);
            }
            context.role = resolvedRole;
        }

        if (input.emojiId) {
            if (!context.guild) {
                throw new Error(
                    "emojiId resolution requires guildId (or DISCORD_GUILD_ID default).",
                );
            }
            context.emoji = await context.guild.emojis.fetch(input.emojiId);
            if (!context.emoji) {
                throw new Error(`Emoji '${input.emojiId}' was not found.`);
            }
        }

        if (input.stickerId) {
            if (!context.guild) {
                throw new Error(
                    "stickerId resolution requires guildId (or DISCORD_GUILD_ID default).",
                );
            }
            context.sticker = await context.guild.stickers.fetch(input.stickerId);
            if (!context.sticker) {
                throw new Error(`Sticker '${input.stickerId}' was not found.`);
            }
        }

        if (input.eventId) {
            if (!context.guild) {
                throw new Error(
                    "eventId resolution requires guildId (or DISCORD_GUILD_ID default).",
                );
            }
            context.event = await context.guild.scheduledEvents.fetch(input.eventId);
            if (!context.event) {
                throw new Error(`Scheduled event '${input.eventId}' was not found.`);
            }
        }

        if (input.inviteCode) {
            context.invite = await this.client.fetchInvite(input.inviteCode);
        }

        if (input.webhookId) {
            context.webhook = await this.client.fetchWebhook(input.webhookId);
        }

        if (input.messageId) {
            const messageContainer = context.thread ?? context.channel;
            if (!messageContainer || typeof messageContainer !== "object") {
                throw new Error("messageId resolution requires channelId or threadId.");
            }

            const maybeMessages = (messageContainer as { messages?: unknown })
                .messages;
            if (
                !maybeMessages ||
                typeof maybeMessages !== "object" ||
                typeof (maybeMessages as { fetch?: unknown }).fetch !== "function"
            ) {
                throw new Error(
                    "Resolved channel/thread does not support message fetching.",
                );
            }

            context.message = await (
                maybeMessages as { fetch: (id: string) => Promise<Message> }
            ).fetch(input.messageId);
        }

        return context;
    }

    private getMessageManagerFromContext(
        context: ResolvedDiscordJsInvocationContext,
    ): unknown {
        const container = context.thread ?? context.channel;
        if (!container || typeof container !== "object") {
            return undefined;
        }

        const manager = (container as { messages?: unknown }).messages;
        if (
            manager &&
            typeof manager === "object" &&
            typeof (manager as { fetch?: unknown }).fetch === "function"
        ) {
            return manager;
        }

        return undefined;
    }

    private getThreadManagerFromContext(
        context: ResolvedDiscordJsInvocationContext,
    ): unknown {
        const container = context.channel;
        if (!container || typeof container !== "object") {
            return undefined;
        }

        const manager = (container as { threads?: unknown }).threads;
        if (
            manager &&
            typeof manager === "object" &&
            typeof (manager as { fetch?: unknown }).fetch === "function"
        ) {
            return manager;
        }

        return undefined;
    }

    private getContextValueByTarget(
        target: DiscordJsInvocationTarget,
        context: ResolvedDiscordJsInvocationContext,
    ): unknown {
        switch (target) {
            case "auto":
                return undefined;
            case "client":
                return context.client;
            case "guild":
                return context.guild;
            case "channel":
                return context.channel;
            case "thread":
                return context.thread;
            case "message":
                return context.message;
            case "user":
                return context.user;
            case "member":
                return context.member;
            case "role":
                return context.role;
            case "emoji":
                return context.emoji;
            case "sticker":
                return context.sticker;
            case "event":
                return context.event;
            case "invite":
                return context.invite;
            case "webhook":
                return context.webhook;
            case "guild_manager":
                return this.client.guilds;
            case "channel_manager":
                return this.client.channels;
            case "user_manager":
                return this.client.users;
            case "member_manager":
                return context.guild?.members;
            case "role_manager":
                return context.guild?.roles;
            case "emoji_manager":
                return context.guild?.emojis;
            case "sticker_manager":
                return context.guild?.stickers;
            case "scheduled_event_manager":
                return context.guild?.scheduledEvents;
            case "message_manager":
                return this.getMessageManagerFromContext(context);
            case "thread_manager":
                return this.getThreadManagerFromContext(context);
            case "application_command_manager":
                return this.client.application?.commands;
            case "application_emoji_manager":
                return this.client.application?.emojis;
            default:
                return undefined;
        }
    }

    private resolveAutoTargetForClass(
        className: string,
        context: ResolvedDiscordJsInvocationContext,
    ): unknown {
        const channelLike = context.thread ?? context.channel;

        switch (className) {
            case "Client":
            case "BaseClient":
                return this.client;
            case "Guild":
            case "BaseGuild":
            case "AnonymousGuild":
                return context.guild;
            case "GuildMember":
                return context.member;
            case "User":
            case "ClientUser":
                return context.user ?? this.client.user;
            case "Role":
                return context.role;
            case "Message":
                return context.message;
            case "ThreadChannel":
                return context.thread;
            case "BaseChannel":
            case "GuildChannel":
            case "TextChannel":
            case "VoiceChannel":
            case "StageChannel":
            case "ForumChannel":
            case "MediaChannel":
            case "NewsChannel":
            case "DMChannel":
            case "CategoryChannel":
                return channelLike;
            case "GuildEmoji":
            case "BaseGuildEmoji":
            case "Emoji":
                return context.emoji;
            case "Sticker":
                return context.sticker;
            case "GuildScheduledEvent":
                return context.event;
            case "Invite":
                return context.invite;
            case "Webhook":
            case "WebhookClient":
                return context.webhook;
            case "GuildManager":
                return this.client.guilds;
            case "ChannelManager":
                return this.client.channels;
            case "UserManager":
                return this.client.users;
            case "GuildMemberManager":
                return context.guild?.members;
            case "RoleManager":
                return context.guild?.roles;
            case "GuildEmojiManager":
            case "BaseGuildEmojiManager":
                return context.guild?.emojis;
            case "GuildStickerManager":
                return context.guild?.stickers;
            case "GuildScheduledEventManager":
                return context.guild?.scheduledEvents;
            case "GuildChannelManager":
                return context.guild?.channels;
            case "MessageManager":
            case "GuildMessageManager":
            case "DMMessageManager":
            case "PartialGroupDMMessageManager":
                return this.getMessageManagerFromContext(context);
            case "ThreadManager":
                return this.getThreadManagerFromContext(context);
            case "ApplicationCommandManager":
                return this.client.application?.commands;
            case "ApplicationEmojiManager":
                return this.client.application?.emojis;
            default:
                return undefined;
        }
    }

    private resolveArgsWithRefs(
        args: unknown[],
        context: ResolvedDiscordJsInvocationContext,
    ): unknown[] {
        return args.map((arg) => {
            if (!arg || typeof arg !== "object" || Array.isArray(arg)) {
                return arg;
            }

            const ref = (arg as { $ref?: unknown }).$ref;
            if (typeof ref !== "string") {
                return arg;
            }

            const normalizedRef = ref.trim().toLowerCase();
            const refMap: Record<string, DiscordJsInvocationTarget> = {
                client: "client",
                guild: "guild",
                channel: "channel",
                thread: "thread",
                message: "message",
                user: "user",
                member: "member",
                role: "role",
                emoji: "emoji",
                sticker: "sticker",
                event: "event",
                invite: "invite",
                webhook: "webhook",
                guild_manager: "guild_manager",
                channel_manager: "channel_manager",
                user_manager: "user_manager",
                member_manager: "member_manager",
                role_manager: "role_manager",
                emoji_manager: "emoji_manager",
                sticker_manager: "sticker_manager",
                scheduled_event_manager: "scheduled_event_manager",
                message_manager: "message_manager",
                thread_manager: "thread_manager",
                application_command_manager: "application_command_manager",
                application_emoji_manager: "application_emoji_manager",
            };

            const target = refMap[normalizedRef];
            if (!target) {
                throw new Error(`Unsupported $ref '${ref}' in invocation args.`);
            }

            const resolved = this.getContextValueByTarget(target, context);
            if (resolved === undefined || resolved === null) {
                throw new Error(
                    `Could not resolve $ref '${ref}'. Provide additional context IDs.`,
                );
            }

            return resolved;
        });
    }

    private serializeInvocationValue(
        value: unknown,
        depth = 0,
        seen: WeakSet<object> = new WeakSet(),
    ): unknown {
        if (value === null || value === undefined) {
            return value;
        }

        const valueType = typeof value;
        if (
            valueType === "string" ||
            valueType === "number" ||
            valueType === "boolean"
        ) {
            return value;
        }
        if (valueType === "bigint") {
            return value.toString();
        }
        if (valueType === "function") {
            const fn = value as (...args: unknown[]) => unknown;
            return {
                type: "function",
                name: fn.name || "anonymous",
            };
        }
        if (value instanceof Date) {
            return value.toISOString();
        }
        if (Buffer.isBuffer(value)) {
            return {
                type: "Buffer",
                length: value.length,
            };
        }
        if (value instanceof Collection) {
            const entries = Array.from(value.entries()).slice(0, 20);
            return {
                type: "Collection",
                size: value.size,
                entries: entries.map(([key, entryValue]) => [
                    this.serializeInvocationValue(key, depth + 1, seen),
                    this.serializeInvocationValue(entryValue, depth + 1, seen),
                ]),
            };
        }
        if (value instanceof Map) {
            const entries = Array.from(value.entries()).slice(0, 20);
            return {
                type: "Map",
                size: value.size,
                entries: entries.map(([key, entryValue]) => [
                    this.serializeInvocationValue(key, depth + 1, seen),
                    this.serializeInvocationValue(entryValue, depth + 1, seen),
                ]),
            };
        }
        if (value instanceof Set) {
            const items = Array.from(value.values()).slice(0, 20);
            return {
                type: "Set",
                size: value.size,
                values: items.map((item) =>
                    this.serializeInvocationValue(item, depth + 1, seen),
                ),
            };
        }
        if (Array.isArray(value)) {
            if (depth >= 2) {
                return {
                    type: "Array",
                    length: value.length,
                };
            }
            const items = value.slice(0, 25).map((item) =>
                this.serializeInvocationValue(item, depth + 1, seen),
            );
            if (value.length > 25) {
                items.push(`... truncated ${value.length - 25} items`);
            }
            return items;
        }

        if (typeof value === "object") {
            const objectValue = value as Record<string, unknown>;
            if (seen.has(objectValue)) {
                return "[Circular]";
            }
            seen.add(objectValue);

            if (typeof (objectValue as { toJSON?: unknown }).toJSON === "function") {
                try {
                    const jsonValue = (
                        objectValue as { toJSON: () => unknown }
                    ).toJSON();
                    return this.serializeInvocationValue(jsonValue, depth + 1, seen);
                } catch {
                    return {
                        type:
                            (objectValue.constructor && objectValue.constructor.name) ||
                            "Object",
                        preview: inspect(objectValue, { depth: 1 }),
                    };
                }
            }

            const constructorName =
                (objectValue.constructor && objectValue.constructor.name) ||
                "Object";
            if (depth >= 2) {
                const summary: Record<string, unknown> = {
                    type: constructorName,
                };
                if (typeof objectValue.id === "string") {
                    summary.id = objectValue.id;
                }
                if (typeof objectValue.name === "string") {
                    summary.name = objectValue.name;
                }
                if (typeof objectValue.tag === "string") {
                    summary.tag = objectValue.tag;
                }
                return summary;
            }

            const entries = Object.entries(objectValue);
            const serialized: Record<string, unknown> = {
                __type__: constructorName,
            };
            for (const [key, entryValue] of entries.slice(0, 25)) {
                serialized[key] = this.serializeInvocationValue(
                    entryValue,
                    depth + 1,
                    seen,
                );
            }
            if (entries.length > 25) {
                serialized.__truncated__ =
                    `${entries.length - 25} additional fields omitted`;
            }
            return serialized;
        }

        return inspect(value, { depth: 1 });
    }

    private buildEventMetadata(
        eventName: string,
        discordExports: Record<string, unknown>,
    ): Record<string, unknown> {
        const enumSources = [
            "Events",
            "ShardEvents",
            "WebSocketShardEvents",
            "GatewayDispatchEvents",
        ];
        const matches: Array<{
            source: string;
            key: string;
            value: string;
        }> = [];

        for (const sourceName of enumSources) {
            const source = discordExports[sourceName];
            if (!source || typeof source !== "object") {
                continue;
            }

            for (const [key, value] of Object.entries(
                source as Record<string, unknown>,
            )) {
                if (value === eventName) {
                    matches.push({
                        source: sourceName,
                        key,
                        value: eventName,
                    });
                }
            }
        }

        return {
            event: eventName,
            matches,
        };
    }

    private isWriteBehavior(behaviorClass: DiscordJsBehaviorClass): boolean {
        return (
            behaviorClass === "write" ||
            behaviorClass === "admin" ||
            behaviorClass === "dangerous"
        );
    }

    private isWriteAllowlisted(symbol: string): boolean {
        if (DYNAMIC_WRITE_ALLOWLIST_EXACT.has(symbol)) {
            return true;
        }
        return DYNAMIC_WRITE_ALLOWLIST_PATTERNS.some((pattern) =>
            pattern.test(symbol),
        );
    }

    private evaluateDiscordJsInvocationPolicy(input: {
        symbol: string;
        behaviorClass: DiscordJsBehaviorClass;
        allowWrite: boolean;
        policyMode: DiscordJsPolicyMode;
    }): DiscordJsInvocationPolicyResult {
        const requiresAllowWrite = this.isWriteBehavior(input.behaviorClass);

        if (!requiresAllowWrite) {
            return {
                decision: "allow",
                behaviorClass: input.behaviorClass,
                requiresAllowWrite: false,
            };
        }

        if (!input.allowWrite) {
            return {
                decision: "blocked",
                behaviorClass: input.behaviorClass,
                requiresAllowWrite: true,
                reason: `Symbol '${input.symbol}' is classified as '${input.behaviorClass}'. Set allowWrite=true to proceed.`,
            };
        }

        if (
            input.behaviorClass === "dangerous" &&
            process.env.DISCORD_MCP_ALLOW_DANGEROUS_SYMBOLS !== "true"
        ) {
            return {
                decision: "blocked",
                behaviorClass: input.behaviorClass,
                requiresAllowWrite: true,
                reason: `Symbol '${input.symbol}' is classified as dangerous and is blocked unless DISCORD_MCP_ALLOW_DANGEROUS_SYMBOLS=true.`,
            };
        }

        if (
            input.policyMode === "strict" &&
            !this.isWriteAllowlisted(input.symbol)
        ) {
            return {
                decision: "blocked",
                behaviorClass: input.behaviorClass,
                requiresAllowWrite: true,
                reason: `Symbol '${input.symbol}' is not in the strict dynamic-write allowlist.`,
            };
        }

        return {
            decision: "allow",
            behaviorClass: input.behaviorClass,
            requiresAllowWrite: true,
        };
    }

    private getTargetContextRequirements(target: DiscordJsInvocationTarget): string[] {
        switch (target) {
            case "guild":
            case "member_manager":
            case "role_manager":
            case "emoji_manager":
            case "sticker_manager":
            case "scheduled_event_manager":
                return ["guildId"];
            case "channel":
            case "thread_manager":
                return ["channelId"];
            case "thread":
                return ["threadId"];
            case "message":
                return ["messageId", "channelId or threadId"];
            case "member":
                return ["memberId", "guildId"];
            case "role":
                return ["roleId", "guildId"];
            case "emoji":
                return ["emojiId", "guildId"];
            case "sticker":
                return ["stickerId", "guildId"];
            case "event":
                return ["eventId", "guildId"];
            case "invite":
                return ["inviteCode"];
            case "webhook":
                return ["webhookId"];
            case "message_manager":
                return ["channelId or threadId"];
            case "application_command_manager":
            case "application_emoji_manager":
            case "client":
            case "guild_manager":
            case "channel_manager":
            case "user_manager":
            case "user":
            case "auto":
            default:
                return [];
        }
    }

    private getClassContextRequirements(className: string): string[] {
        switch (className) {
            case "Guild":
            case "BaseGuild":
            case "AnonymousGuild":
            case "GuildMemberManager":
            case "RoleManager":
            case "GuildEmojiManager":
            case "BaseGuildEmojiManager":
            case "GuildStickerManager":
            case "GuildScheduledEventManager":
            case "GuildChannelManager":
                return ["guildId"];
            case "GuildMember":
                return ["memberId", "guildId"];
            case "Role":
                return ["roleId", "guildId"];
            case "ThreadChannel":
                return ["threadId"];
            case "Message":
                return ["messageId", "channelId or threadId"];
            case "BaseChannel":
            case "GuildChannel":
            case "TextChannel":
            case "VoiceChannel":
            case "StageChannel":
            case "ForumChannel":
            case "MediaChannel":
            case "NewsChannel":
            case "DMChannel":
            case "CategoryChannel":
                return ["channelId or threadId"];
            case "GuildEmoji":
            case "BaseGuildEmoji":
            case "Emoji":
                return ["emojiId", "guildId"];
            case "Sticker":
                return ["stickerId", "guildId"];
            case "GuildScheduledEvent":
                return ["eventId", "guildId"];
            case "Invite":
                return ["inviteCode"];
            case "Webhook":
            case "WebhookClient":
                return ["webhookId"];
            default:
                return [];
        }
    }

    private inferInvocationContextRequirements(input: {
        target?: DiscordJsInvocationTarget;
        invocationMode: "export" | "instance" | "static" | "metadata";
        className?: string;
    }): string[] {
        const required = new Set<string>();

        if (input.target && input.target !== "auto") {
            for (const item of this.getTargetContextRequirements(input.target)) {
                required.add(item);
            }
        }

        if (input.className) {
            for (const item of this.getClassContextRequirements(input.className)) {
                required.add(item);
            }
        }

        if (input.invocationMode === "instance" && required.size === 0) {
            required.add(
                "Provide target context (for example guildId/channelId/threadId/messageId depending on symbol).",
            );
        }

        return Array.from(required);
    }

    private summarizeResolvedTarget(
        label: string,
        target: unknown,
    ): Record<string, unknown> {
        const summary: Record<string, unknown> = {
            label,
            resolved: target !== undefined && target !== null,
        };

        if (target === undefined || target === null) {
            return summary;
        }

        if (typeof target !== "object") {
            summary.type = typeof target;
            return summary;
        }

        const objectTarget = target as Record<string, unknown>;
        summary.type =
            (objectTarget.constructor && objectTarget.constructor.name) || "Object";

        if (typeof objectTarget.id === "string") {
            summary.id = objectTarget.id;
        }
        if (typeof objectTarget.name === "string") {
            summary.name = objectTarget.name;
        }
        if (typeof objectTarget.tag === "string") {
            summary.tag = objectTarget.tag;
        }

        return summary;
    }

    private pickSymbolKind(
        kinds: DiscordJsInvocationKind[],
        requestedKind?: DiscordJsInvocationKind,
    ): DiscordJsInvocationKind {
        if (requestedKind) {
            return requestedKind;
        }

        const kindSet = new Set(kinds);
        const priority: DiscordJsInvocationKind[] = [
            "function",
            "class",
            "const",
            "variable",
            "enum",
            "event",
            "external",
            "interface",
            "type",
            "namespace",
        ];

        for (const kind of priority) {
            if (kindSet.has(kind)) {
                return kind;
            }
        }

        return kinds[0];
    }
}
