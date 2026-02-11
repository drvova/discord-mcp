import {
    SpanStatusCode,
    metrics,
    trace,
    type Attributes,
    type Span,
} from "@opentelemetry/api";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { PrometheusExporter } from "@opentelemetry/exporter-prometheus";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { getModuleLogger } from "./logger.js";

const logger = getModuleLogger("telemetry");
const serviceName = process.env.OTEL_SERVICE_NAME || "discord-mcp";
const serviceVersion = process.env.npm_package_version || "0.0.0";
const deploymentEnvironment = process.env.NODE_ENV || "development";

let sdk: NodeSDK | null = null;
let initialized = false;

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

function parseHeaders(
    source: string | undefined,
): Record<string, string> | undefined {
    if (!source || source.trim().length === 0) {
        return undefined;
    }

    const entries = source
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
        .map((entry) => {
            const separator = entry.indexOf("=");
            if (separator < 1) {
                return null;
            }
            const key = entry.slice(0, separator).trim();
            const value = entry.slice(separator + 1).trim();
            if (!key || !value) {
                return null;
            }
            return [key, value] as const;
        })
        .filter((item): item is readonly [string, string] => item !== null);

    if (entries.length === 0) {
        return undefined;
    }

    return Object.fromEntries(entries);
}

function parsePort(value: string | undefined, fallback: number): number {
    if (!value) {
        return fallback;
    }

    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return fallback;
    }
    return parsed;
}

export async function initializeTelemetry(): Promise<void> {
    if (initialized) {
        return;
    }

    initialized = true;
    const otelEnabled = parseBoolean(process.env.OTEL_ENABLED, true);
    if (!otelEnabled) {
        logger.info("OpenTelemetry disabled by OTEL_ENABLED=false");
        return;
    }

    const traceEndpoint =
        process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ||
        "http://localhost:4318/v1/traces";
    const prometheusPort = parsePort(process.env.OTEL_PROMETHEUS_PORT, 9464);
    const prometheusEndpoint = process.env.OTEL_PROMETHEUS_ENDPOINT || "/metrics";

    const traceExporter = new OTLPTraceExporter({
        url: traceEndpoint,
        headers: parseHeaders(process.env.OTEL_EXPORTER_OTLP_HEADERS),
    });

    const metricReader = new PrometheusExporter({
        port: prometheusPort,
        endpoint: prometheusEndpoint,
    });

    sdk = new NodeSDK({
        resource: resourceFromAttributes({
            "service.name": serviceName,
            "service.version": serviceVersion,
            "deployment.environment": deploymentEnvironment,
        }),
        traceExporter,
        metricReader,
        instrumentations: [getNodeAutoInstrumentations()],
    });

    await sdk.start();
    logger.info(
        {
            serviceName,
            traceEndpoint,
            prometheusPort,
            prometheusEndpoint,
        },
        "OpenTelemetry initialized",
    );

    const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
        if (!sdk) {
            return;
        }
        try {
            await sdk.shutdown();
            logger.info({ signal }, "OpenTelemetry shutdown complete");
        } catch (error) {
            logger.warn({ signal, error }, "OpenTelemetry shutdown encountered exporter errors");
        }
    };

    process.once("SIGINT", () => {
        void shutdown("SIGINT");
    });
    process.once("SIGTERM", () => {
        void shutdown("SIGTERM");
    });
}

type RuntimeInstruments = {
    requestCounter: ReturnType<ReturnType<typeof metrics.getMeter>["createCounter"]>;
    requestDuration: ReturnType<
        ReturnType<typeof metrics.getMeter>["createHistogram"]
    >;
    discordOperationCounter: ReturnType<
        ReturnType<typeof metrics.getMeter>["createCounter"]
    >;
    discordOperationDuration: ReturnType<
        ReturnType<typeof metrics.getMeter>["createHistogram"]
    >;
    auditEventCounter: ReturnType<ReturnType<typeof metrics.getMeter>["createCounter"]>;
};

let instruments: RuntimeInstruments | null = null;

function getRuntimeInstruments(): RuntimeInstruments {
    if (instruments) {
        return instruments;
    }

    const meter = metrics.getMeter(serviceName);
    instruments = {
        requestCounter: meter.createCounter("discord_mcp_requests_total", {
            description: "Count of incoming MCP/HTTP requests.",
        }),
        requestDuration: meter.createHistogram("discord_mcp_request_duration_ms", {
            unit: "ms",
            description: "Duration of incoming requests in milliseconds.",
        }),
        discordOperationCounter: meter.createCounter(
            "discord_mcp_discord_ops_total",
            {
                description: "Count of Discord operations executed by the MCP router.",
            },
        ),
        discordOperationDuration: meter.createHistogram(
            "discord_mcp_discord_op_duration_ms",
            {
                unit: "ms",
                description:
                    "Duration of Discord operations executed by the MCP router.",
            },
        ),
        auditEventCounter: meter.createCounter("discord_mcp_audit_events_total", {
            description: "Count of audit events emitted by the gateway.",
        }),
    };
    return instruments;
}

export function recordRequestMetric(
    attributes: Attributes,
    durationMs: number,
): void {
    const { requestCounter, requestDuration } = getRuntimeInstruments();
    requestCounter.add(1, attributes);
    requestDuration.record(durationMs, attributes);
}

export function recordDiscordOperationMetric(
    attributes: Attributes,
    durationMs: number,
): void {
    const { discordOperationCounter, discordOperationDuration } =
        getRuntimeInstruments();
    discordOperationCounter.add(1, attributes);
    discordOperationDuration.record(durationMs, attributes);
}

export function recordAuditEventMetric(attributes: Attributes): void {
    const { auditEventCounter } = getRuntimeInstruments();
    auditEventCounter.add(1, attributes);
}

export async function withSpan<T>(
    name: string,
    attributes: Attributes,
    work: (span: Span) => Promise<T>,
): Promise<T> {
    return trace.getTracer(serviceName).startActiveSpan(
        name,
        { attributes },
        async (span): Promise<T> => {
            try {
                const result = await work(span);
                span.setStatus({ code: SpanStatusCode.OK });
                return result;
            } catch (error) {
                span.recordException(
                    error instanceof Error ? error : new Error(String(error)),
                );
                span.setStatus({
                    code: SpanStatusCode.ERROR,
                    message: error instanceof Error ? error.message : String(error),
                });
                throw error;
            } finally {
                span.end();
            }
        },
    );
}
