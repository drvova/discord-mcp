import { DiscordService } from "../discord-service.js";
import { ConfigManager } from "./ConfigManager.js";
import { Logger } from "./Logger.js";
import { ErrorHandler } from "./ErrorHandler.js";
import { AppErrorCode } from "./errors.js";

export class DiscordController {
    private discordService: DiscordService | null = null;
    private readonly configManager: ConfigManager;
    private readonly logger: Logger;

    constructor() {
        this.configManager = ConfigManager.getInstance();
        this.logger = Logger.getInstance();
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
            ErrorHandler.handle(error, AppErrorCode.Internal);
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
            ErrorHandler.handle(error, AppErrorCode.Internal);
        }
    }

    getDiscordService(): DiscordService {
        if (!this.discordService) {
            ErrorHandler.handle(
                new Error("Discord service was requested before initialization."),
                AppErrorCode.Internal,
            );
        }
        return this.discordService;
    }

    getConfigManager(): ConfigManager {
        return this.configManager;
    }
}
