import { Logger } from "./Logger.js";
import { AppError, AppErrorCode, normalizeUnknownError } from "./errors.js";

export class DiscordAPIError extends AppError {
    constructor(
        message: string,
        public readonly statusCode?: number,
        public readonly method?: string,
        public readonly path?: string,
    ) {
        super({
            code: AppErrorCode.DiscordApi,
            message,
            context: {
                statusCode,
                method,
                path,
            },
        });
        this.name = "DiscordAPIError";
    }
}

export class ValidationError extends AppError {
    constructor(message: string, context?: Readonly<Record<string, unknown>>) {
        super({
            code: AppErrorCode.Validation,
            message,
            context,
        });
        this.name = "ValidationError";
    }
}

export class PermissionError extends AppError {
    constructor(message: string, context?: Readonly<Record<string, unknown>>) {
        super({
            code: AppErrorCode.Permission,
            message,
            context,
        });
        this.name = "PermissionError";
    }
}

export class RateLimitError extends AppError {
    constructor(
        message: string,
        public readonly retryAfter: number,
        public readonly global: boolean,
    ) {
        super({
            code: AppErrorCode.RateLimit,
            message,
            context: {
                retryAfter,
                global,
            },
        });
        this.name = "RateLimitError";
    }
}

const logger = Logger.getInstance().child("error-handler");

export class ErrorHandler {
    static normalize(
        error: unknown,
        fallbackCode: AppErrorCode = AppErrorCode.Internal,
    ): AppError {
        return normalizeUnknownError(error, fallbackCode);
    }

    static handle(
        error: unknown,
        fallbackCode: AppErrorCode = AppErrorCode.Internal,
    ): never {
        const normalized = ErrorHandler.normalize(error, fallbackCode);
        logger.error("Discord MCP Error", {
            code: normalized.code,
            message: normalized.message,
            context: normalized.context,
            cause: normalized.cause,
        });
        throw normalized;
    }
}

