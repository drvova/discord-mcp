import { DiscordService } from "../discord-service.js";
import { AutomationManager } from "./AutomationManager.js";
import { ConfigManager } from "./ConfigManager.js";
import { Logger } from "./Logger.js";
import { ErrorHandler } from "./ErrorHandler.js";
import { RateLimiter } from "./RateLimiter.js";

export class DiscordController {
    private discordService: DiscordService;
    private automationManager: AutomationManager;
    private configManager: ConfigManager;
    private logger: Logger;
    private rateLimiter: RateLimiter;

    constructor() {
        this.configManager = ConfigManager.getInstance();
        this.logger = Logger.getInstance();
        this.rateLimiter = RateLimiter.getInstance();

        // These will be initialized in initialize()
        this.discordService = null as any;
        this.automationManager = null as any;
    }

    async initialize(): Promise<void> {
        try {
            this.logger.info("Initializing Discord Controller");

            // Initialize Discord service with optional auth config
            const authConfig = this.configManager.getConfig().auth;
            this.discordService = new DiscordService(authConfig);
            await this.discordService.initialize();

            // Initialize automation manager
            this.automationManager = new AutomationManager(this.discordService);

            this.logger.info("Discord Controller initialized successfully");
        } catch (error) {
            this.logger.logError("Discord Controller initialization", error);
            ErrorHandler.handle(error);
        }
    }

    async executeAction(action: string, params: any): Promise<string> {
        try {
            if (action === "switch_token" || action === "get_auth_status") {
                return await this.callAutomationMethod(action, params);
            }

            if (!this.configManager.isActionAllowed(action)) {
                throw ErrorHandler.createPermissionError(
                    `Action '${action}' is not allowed`,
                );
            }

            this.logger.logOperation(action, params);

            if (this.configManager.getConfig().rateLimitProtection) {
                await this.rateLimiter.waitForRateLimit(action);
            }

            const result = await this.callAutomationMethod(action, params);

            this.logger.info(`Action '${action}' executed successfully`);
            return result;
        } catch (error) {
            this.logger.logError(`Action '${action}' failed`, error);
            throw ErrorHandler.handle(error);
        }
    }

    private async callAutomationMethod(
        action: string,
        params: any,
    ): Promise<string> {
        // Convert action name to method name (snake_case to camelCase)
        const methodName = action.replace(/_([a-z])/g, (g) =>
            g[1].toUpperCase(),
        );

        // Check if method exists
        if (typeof (this.automationManager as any)[methodName] === "function") {
            // Call the method with params
            return await (this.automationManager as any)[methodName](
                ...Object.values(params),
            );
        }

        throw new Error(
            `Method '${methodName}' not found in AutomationManager`,
        );
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

    getAutomationManager(): AutomationManager {
        return this.automationManager;
    }

    getConfigManager(): ConfigManager {
        return this.configManager;
    }

    getLogger(): Logger {
        return this.logger;
    }
}
