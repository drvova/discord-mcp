import type { Logger as PinoLogger } from "pino";
import { getRuntimeLogger } from "../observability/logger.js";

export enum LogLevel {
    ERROR = 0,
    WARN = 1,
    INFO = 2,
    DEBUG = 3,
}

export class Logger {
    private static instance: Logger;
    private readonly delegate: PinoLogger;

    private constructor(delegate: PinoLogger) {
        this.delegate = delegate;
    }

    static getInstance(): Logger {
        if (!Logger.instance) {
            Logger.instance = new Logger(getRuntimeLogger());
        }
        return Logger.instance;
    }

    child(context: string): Logger {
        const trimmed = context.trim();
        if (!trimmed) {
            return this;
        }
        return new Logger(
            this.delegate.child({
                module: trimmed,
            }),
        );
    }

    error(message: string, errorOrMeta?: unknown): void {
        this.write("error", message, errorOrMeta);
    }

    warn(message: string, meta?: unknown): void {
        this.write("warn", message, meta);
    }

    info(message: string, meta?: unknown): void {
        this.write("info", message, meta);
    }

    debug(message: string, meta?: unknown): void {
        this.write("debug", message, meta);
    }

    logError(operation: string, error: unknown): void {
        this.error(`Operation failed: ${operation}`, error);
    }

    private write(
        level: "error" | "warn" | "info" | "debug",
        message: string,
        data?: unknown,
    ): void {
        if (data === undefined) {
            this.delegate[level](message);
            return;
        }

        if (data instanceof Error) {
            this.delegate[level]({ err: data }, message);
            return;
        }

        if (typeof data === "object" && data !== null) {
            this.delegate[level](data as Record<string, unknown>, message);
            return;
        }

        this.delegate[level]({ value: data }, message);
    }
}
