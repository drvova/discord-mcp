export interface AuthConfig {
    tokenType: "bot" | "user";
    token: string;
    intents?: string[];
}

export interface OAuthConfig {
    clientId?: string;
    clientSecret?: string;
    redirectUri?: string;
    stateTtlSeconds: number;
    storePath: string;
    defaultGuildId?: string;
}

export interface AutomationConfig {
    auth?: AuthConfig;
    oauth: OAuthConfig;
}

export const DEFAULT_DISCORD_INTENTS: string[] = [
    "Guilds",
    "GuildMessages",
    "DirectMessages",
    "GuildVoiceStates",
    "GuildModeration",
    "GuildMessageReactions",
    "DirectMessageReactions",
];

export class ConfigManager {
    private static instance: ConfigManager;
    private config: AutomationConfig;

    private constructor() {
        this.config = this.loadConfig();
    }

    static getInstance(): ConfigManager {
        if (!ConfigManager.instance) {
            ConfigManager.instance = new ConfigManager();
        }
        return ConfigManager.instance;
    }

    private loadConfig(): AutomationConfig {
        const configuredIntents = process.env.DISCORD_INTENTS?.split(",")
            .map((i) => i.trim())
            .filter((i) => i.length > 0);
        const configuredStateTtlSeconds = parseInt(
            process.env.DISCORD_OAUTH_STATE_TTL_SECONDS || "600",
            10,
        );

        const authConfig: AuthConfig = {
            tokenType:
                (process.env.DISCORD_TOKEN_TYPE as "bot" | "user") || "bot",
            token:
                process.env.DISCORD_TOKEN ||
                process.env.DISCORD_USER_TOKEN ||
                "",
            intents:
                configuredIntents && configuredIntents.length > 0
                    ? configuredIntents
                    : [...DEFAULT_DISCORD_INTENTS],
        };

        const oauthConfig: OAuthConfig = {
            clientId: process.env.DISCORD_CLIENT_ID,
            clientSecret: process.env.DISCORD_CLIENT_SECRET,
            redirectUri: process.env.DISCORD_OAUTH_REDIRECT_URI,
            stateTtlSeconds: Number.isFinite(configuredStateTtlSeconds)
                ? Math.max(60, configuredStateTtlSeconds)
                : 600,
            storePath:
                process.env.DISCORD_OAUTH_STORE_PATH ||
                "./data/oauth-sessions.json",
            defaultGuildId: process.env.DISCORD_OAUTH_DEFAULT_GUILD_ID,
        };

        return {
            auth: authConfig,
            oauth: oauthConfig,
        };
    }

    getConfig(): AutomationConfig {
        return { ...this.config };
    }
}
