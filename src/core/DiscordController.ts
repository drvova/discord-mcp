import { DiscordService } from "../discord-service.js";
import { ConfigManager } from "./ConfigManager.js";
import { Logger } from "./Logger.js";
import { ErrorHandler } from "./ErrorHandler.js";

export class DiscordController {
    private discordService: DiscordService;
    private configManager: ConfigManager;
    private logger: Logger;

    constructor() {
        this.configManager = ConfigManager.getInstance();
        this.logger = Logger.getInstance();

        // These will be initialized in initialize()
        this.discordService = null as any;
    }

    async initialize(): Promise<void> {
        try {
            this.logger.info("Initializing Discord Controller");

            // Initialize Discord service with optional auth config
            const authConfig = this.configManager.getConfig().auth;
            this.discordService = new DiscordService(authConfig);
            await this.discordService.initialize();

            this.logger.info("Discord Controller initialized successfully");
        } catch (error) {
            this.logger.logError("Discord Controller initialization", error);
            ErrorHandler.handle(error);
        }
    }

    async destroy(): Promise<void> {
        try {
            this.logger.info("Destroying Discord Controller");

            if (this.discordService) {
                await this.discordService.destroy();
            }

            this.logger.info("Discord Controller destroyed successfully");
        } catch (error) {
            this.logger.logError("Discord Controller destruction", error);
            ErrorHandler.handle(error);
        }
    }

    getDiscordService(): DiscordService {
        return this.discordService;
    }

    getConfigManager(): ConfigManager {
        return this.configManager;
    }

    getLogger(): Logger {
        return this.logger;
    }
}
