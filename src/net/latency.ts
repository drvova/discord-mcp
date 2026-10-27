import { recordNetworkLatency } from "../observability/telemetry.js";

// Round-trip latency of outbound requests, kept per identity (Discord) or per
// server (upstream MCP). Samples are labelled with those names only; a token
// never becomes a key, a label or part of a recorded URL.

export type LatencyKind = "discord_rest" | "mcp";

export type LatencyStats = {
    count: number;
    errors: number;
    lastMs: number;
    avgMs: number;
    p50Ms: number;
    p95Ms: number;
};

const WINDOW = 256;

type Series = { samples: number[]; count: number; errors: number; lastMs: number };

function round(ms: number): number {
    return Math.round(ms * 10) / 10;
}

function percentile(sorted: number[], fraction: number): number {
    const index = Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1);
    return sorted[Math.max(0, index)];
}

export class LatencyTracker {
    private readonly series = new Map<string, Series>();

    record(kind: LatencyKind, label: string, ms: number, ok: boolean): void {
        const key = `${kind}:${label}`;
        const series = this.series.get(key) || { samples: [], count: 0, errors: 0, lastMs: 0 };
        series.samples.push(ms);
        if (series.samples.length > WINDOW) {
            series.samples.shift();
        }
        series.count += 1;
        series.errors += ok ? 0 : 1;
        series.lastMs = ms;
        this.series.set(key, series);
        recordNetworkLatency(
            {
                "network.kind": kind,
                [kind === "mcp" ? "mcp.server" : "discord.identity"]: label,
                "network.outcome": ok ? "ok" : "error",
            },
            ms,
        );
    }

    // Times an async request and records it, whether it succeeds or throws.
    async time<T>(
        kind: LatencyKind,
        label: string,
        work: () => Promise<T>,
        isOk: (result: T) => boolean = () => true,
    ): Promise<T> {
        const startedAt = performance.now();
        try {
            const result = await work();
            this.record(kind, label, performance.now() - startedAt, isOk(result));
            return result;
        } catch (error) {
            this.record(kind, label, performance.now() - startedAt, false);
            throw error;
        }
    }

    stats(kind: LatencyKind, label: string): LatencyStats | undefined {
        const series = this.series.get(`${kind}:${label}`);
        if (!series || series.samples.length === 0) {
            return undefined;
        }
        const sorted = [...series.samples].sort((a, b) => a - b);
        const sum = sorted.reduce((total, value) => total + value, 0);
        return {
            count: series.count,
            errors: series.errors,
            lastMs: round(series.lastMs),
            avgMs: round(sum / sorted.length),
            p50Ms: round(percentile(sorted, 0.5)),
            p95Ms: round(percentile(sorted, 0.95)),
        };
    }

    all(): Record<string, Record<string, LatencyStats>> {
        const result: Record<string, Record<string, LatencyStats>> = {};
        for (const key of this.series.keys()) {
            const [kind, ...rest] = key.split(":");
            const label = rest.join(":");
            const stats = this.stats(kind as LatencyKind, label);
            if (stats) {
                (result[kind] ||= {})[label] = stats;
            }
        }
        return result;
    }
}
