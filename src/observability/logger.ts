import { context as otelContext, trace } from "@opentelemetry/api";
import pino, { type Logger as PinoLogger } from "pino";

const DEFAULT_SERVICE_NAME = "discord-mcp";
const DEFAULT_LOG_LEVEL = "info";
const SECRET_REDACT_PATHS = [
    "token",
    "*.token",
    "authorization",
    "*.authorization",
    "headers.authorization",
    "DISCORD_TOKEN",
    "DISCORD_CLIENT_SECRET",
];

type LogStyle = "pretty" | "json";
type LogStyleDecision = {
    style: LogStyle;
    source: "env" | "auto";
};

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
    if (value === undefined) {
        return fallback;
    }

    const normalized = value.trim().toLowerCase();
    if (normalized === "1" || normalized === "true" || normalized === "yes") {
        return true;
    }
    if (normalized === "0" || normalized === "false" || normalized === "no") {
        return false;
    }
    return fallback;
}

function isDevelopmentRun(): boolean {
    const lifecycle = process.env.npm_lifecycle_event?.toLowerCase() || "";
    return process.env.NODE_ENV === "development" || lifecycle.startsWith("dev");
}

function resolveLogStyleDecision(): LogStyleDecision {
    const raw = process.env.LOG_STYLE?.trim().toLowerCase();
    if (raw === "pretty" || raw === "json") {
        return {
            style: raw,
            source: "env",
        };
    }

    const style = process.stderr.isTTY || isDevelopmentRun() ? "pretty" : "json";
    return {
        style,
        source: "auto",
    };
}

function buildPrettyTransport() {
    return pino.transport({
        target: "pino-pretty",
        options: {
            colorize: parseBoolean(process.env.LOG_COLOR, process.stderr.isTTY),
            singleLine: true,
            levelFirst: true,
            translateTime: false,
            ignore: "pid,hostname,time",
            messageFormat:
                "{if module}{module} {end}{msg}{if trace_id} trace={trace_id} span={span_id}{end}",
        },
    });
}

function buildTraceContextBindings(): Record<string, string> {
    const span = trace.getSpan(otelContext.active());
    if (!span) {
        return {};
    }

    const spanContext = span.spanContext();
    if (!spanContext.traceId || !spanContext.spanId) {
        return {};
    }

    return {
        trace_id: spanContext.traceId,
        span_id: spanContext.spanId,
    };
}

function normalizeLogLevel(value: string | undefined): string {
    const normalized = value?.trim().toLowerCase();
    if (
        normalized === "fatal" ||
        normalized === "error" ||
        normalized === "warn" ||
        normalized === "info" ||
        normalized === "debug" ||
        normalized === "trace"
    ) {
        return normalized;
    }
    return DEFAULT_LOG_LEVEL;
}

const serviceName = process.env.OTEL_SERVICE_NAME || DEFAULT_SERVICE_NAME;
const logStyleDecision = resolveLogStyleDecision();
const logStyle = logStyleDecision.style;
const baseLogger = pino(
    {
        level: normalizeLogLevel(process.env.LOG_LEVEL),
        enabled: parseBoolean(process.env.ENABLE_LOGGING, true),
        timestamp: false,
        base: {
            service: serviceName,
        },
        redact: {
            paths: SECRET_REDACT_PATHS,
            censor: "[REDACTED]",
        },
        mixin: buildTraceContextBindings,
    },
    logStyle === "pretty" ? buildPrettyTransport() : undefined,
);

if (baseLogger.isLevelEnabled("debug")) {
    baseLogger.debug(
        {
            logStyle: logStyleDecision.style,
            source: logStyleDecision.source,
            isTTY: process.stderr.isTTY,
            lifecycleEvent: process.env.npm_lifecycle_event,
            nodeEnv: process.env.NODE_ENV,
        },
        "logger_style_selected",
    );
}

export function getRuntimeLogger(): PinoLogger {
    return baseLogger;
}

export function getModuleLogger(moduleName: string): PinoLogger {
    return baseLogger.child({
        module: moduleName,
    });
}
