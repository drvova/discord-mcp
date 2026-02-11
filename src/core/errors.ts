export const enum AppErrorCode {
    Validation = "VALIDATION_ERROR",
    Permission = "PERMISSION_ERROR",
    Policy = "POLICY_ERROR",
    NotFound = "NOT_FOUND_ERROR",
    RateLimit = "RATE_LIMIT_ERROR",
    DiscordApi = "DISCORD_API_ERROR",
    Internal = "INTERNAL_ERROR",
}

export type AppErrorContext = Readonly<Record<string, unknown>>;

type AppErrorInput = {
    code: AppErrorCode;
    message: string;
    cause?: unknown;
    context?: AppErrorContext;
};

export class AppError extends Error {
    readonly code: AppErrorCode;
    readonly cause?: unknown;
    readonly context?: AppErrorContext;

    constructor(input: AppErrorInput) {
        super(input.message);
        this.name = "AppError";
        this.code = input.code;
        this.cause = input.cause;
        this.context = input.context;
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function inferCode(error: unknown, fallbackCode: AppErrorCode): AppErrorCode {
    if (!isRecord(error)) {
        return fallbackCode;
    }

    const code = error.code;
    if (typeof code === "string") {
        const upper = code.trim().toUpperCase();
        switch (upper) {
            case AppErrorCode.Validation:
                return AppErrorCode.Validation;
            case AppErrorCode.Permission:
                return AppErrorCode.Permission;
            case AppErrorCode.Policy:
                return AppErrorCode.Policy;
            case AppErrorCode.NotFound:
                return AppErrorCode.NotFound;
            case AppErrorCode.RateLimit:
                return AppErrorCode.RateLimit;
            case AppErrorCode.DiscordApi:
                return AppErrorCode.DiscordApi;
            case AppErrorCode.Internal:
                return AppErrorCode.Internal;
            default:
                break;
        }
    }

    const name = error.name;
    if (typeof name === "string") {
        if (name === "ZodError" || name === "ValidationError") {
            return AppErrorCode.Validation;
        }
        if (name === "DiscordAPIError") {
            return AppErrorCode.DiscordApi;
        }
        if (name === "RateLimitError") {
            return AppErrorCode.RateLimit;
        }
        if (name === "PermissionError") {
            return AppErrorCode.Permission;
        }
    }

    return fallbackCode;
}

export function normalizeUnknownError(
    error: unknown,
    fallbackCode: AppErrorCode = AppErrorCode.Internal,
): AppError {
    if (error instanceof AppError) {
        return error;
    }

    if (error instanceof Error) {
        return new AppError({
            code: inferCode(error, fallbackCode),
            message: error.message,
            cause: error,
        });
    }

    return new AppError({
        code: inferCode(error, fallbackCode),
        message: String(error),
        cause: error,
    });
}

export function toPublicErrorPayload(
    error: unknown,
    fallbackCode: AppErrorCode = AppErrorCode.Internal,
): { code: AppErrorCode; message: string } {
    const normalized = normalizeUnknownError(error, fallbackCode);
    return {
        code: normalized.code,
        message: normalized.message,
    };
}

