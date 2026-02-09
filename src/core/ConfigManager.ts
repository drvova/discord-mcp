export interface AuthConfig {
    tokenType: "bot" | "user";
    token: string;
    intents?: string[];
}

export interface AutomationConfig {
    defaultGuildId?: string;
    enableLogging: boolean;
    maxRetries: number;
    retryDelay: number;
    timeout: number;
    rateLimitProtection: boolean;
    allowedActions: string[];
    deniedActions: string[];
    auth?: AuthConfig;
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

        return {
            defaultGuildId: process.env.DISCORD_GUILD_ID,
            enableLogging: process.env.ENABLE_LOGGING === "true",
            maxRetries: parseInt(process.env.MAX_RETRIES || "3"),
            retryDelay: parseInt(process.env.RETRY_DELAY || "1000"),
            timeout: parseInt(process.env.TIMEOUT || "30000"),
            rateLimitProtection: process.env.RATE_LIMIT_PROTECTION !== "false",
            allowedActions: this.parseActionList(process.env.ALLOWED_ACTIONS),
            deniedActions: this.parseActionList(process.env.DENIED_ACTIONS),
            auth: authConfig,
        };
    }

    private parseActionList(actionList?: string): string[] {
        if (!actionList) return [];
        return actionList.split(",").map((action) => action.trim());
    }

    getConfig(): AutomationConfig {
        return { ...this.config };
    }

    isActionAllowed(action: string): boolean {
        // If allowedActions is specified, only those actions are allowed
        if (this.config.allowedActions.length > 0) {
            return this.config.allowedActions.includes(action);
        }

        // If deniedActions is specified, those actions are not allowed
        if (this.config.deniedActions.length > 0) {
            return !this.config.deniedActions.includes(action);
        }

        // If neither is specified, all actions are allowed
        return true;
    }

    updateConfig(newConfig: Partial<AutomationConfig>): void {
        this.config = { ...this.config, ...newConfig };
    }
}
