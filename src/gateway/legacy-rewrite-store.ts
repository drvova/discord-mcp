import {
    existsSync,
    mkdirSync,
    readFileSync,
    renameSync,
    writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";

type LegacyRewriteStateFile = {
    version: 1;
    records: LegacyRewriteRecord[];
};

export type LegacyRewriteRecord = {
    key: string;
    mode: "bot" | "user";
    identityId: string;
    legacyOperation: string;
    firstSeenAt: string;
    lastUsedAt: string;
    rewriteCount: number;
    lastSuggestedOperation: string;
};

export type LegacyRewriteRegistration = {
    allowRewrite: boolean;
    record: LegacyRewriteRecord;
};

function normalizeOperation(value: string): string {
    return value.trim().toLowerCase();
}

function resolveStatePath(): string {
    const configured = process.env.DISCORD_MCP_LEGACY_REWRITE_STATE_PATH;
    const candidate =
        typeof configured === "string" && configured.trim().length > 0
            ? configured.trim()
            : "./data/legacy-rewrite-state.json";
    return resolve(process.cwd(), candidate);
}

function createStoreKey(input: {
    mode: "bot" | "user";
    identityId: string;
    legacyOperation: string;
}): string {
    return `${input.mode}:${input.identityId.trim().toLowerCase()}:${normalizeOperation(input.legacyOperation)}`;
}

export class LegacyRewriteStore {
    private readonly statePath: string;
    private readonly records = new Map<string, LegacyRewriteRecord>();
    private initError: Error | null = null;

    constructor(statePath = resolveStatePath()) {
        this.statePath = statePath;
        this.loadState();
    }

    registerUse(input: {
        mode: "bot" | "user";
        identityId: string;
        legacyOperation: string;
        suggestedOperation: string;
    }): LegacyRewriteRegistration {
        this.assertAvailable();

        const now = new Date().toISOString();
        const key = createStoreKey(input);
        const operation = input.legacyOperation.trim();

        const existing = this.records.get(key);
        if (!existing) {
            const created: LegacyRewriteRecord = {
                key,
                mode: input.mode,
                identityId: input.identityId,
                legacyOperation: operation,
                firstSeenAt: now,
                lastUsedAt: now,
                rewriteCount: 1,
                lastSuggestedOperation: input.suggestedOperation,
            };
            this.records.set(key, created);
            this.persistState();
            return {
                allowRewrite: true,
                record: { ...created },
            };
        }

        const updated: LegacyRewriteRecord = {
            ...existing,
            lastUsedAt: now,
            rewriteCount: existing.rewriteCount + 1,
            lastSuggestedOperation: input.suggestedOperation,
        };
        this.records.set(key, updated);
        this.persistState();
        return {
            allowRewrite: false,
            record: { ...updated },
        };
    }

    private loadState(): void {
        try {
            if (!existsSync(this.statePath)) {
                return;
            }

            const raw = readFileSync(this.statePath, "utf8");
            if (raw.trim().length === 0) {
                return;
            }

            const parsed = JSON.parse(raw) as unknown;
            if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
                throw new Error(
                    `Invalid legacy rewrite store format at '${this.statePath}'.`,
                );
            }

            const state = parsed as Partial<LegacyRewriteStateFile>;
            if (state.version !== 1 || !Array.isArray(state.records)) {
                throw new Error(
                    `Unsupported legacy rewrite store schema in '${this.statePath}'.`,
                );
            }

            for (const candidate of state.records) {
                if (!candidate || typeof candidate !== "object") {
                    continue;
                }

                const record = candidate as Partial<LegacyRewriteRecord>;
                if (
                    typeof record.key !== "string" ||
                    (record.mode !== "bot" && record.mode !== "user") ||
                    typeof record.identityId !== "string" ||
                    typeof record.legacyOperation !== "string" ||
                    typeof record.firstSeenAt !== "string" ||
                    typeof record.lastUsedAt !== "string" ||
                    typeof record.rewriteCount !== "number" ||
                    !Number.isFinite(record.rewriteCount) ||
                    record.rewriteCount < 1 ||
                    typeof record.lastSuggestedOperation !== "string"
                ) {
                    continue;
                }

                this.records.set(record.key, {
                    key: record.key,
                    mode: record.mode,
                    identityId: record.identityId,
                    legacyOperation: record.legacyOperation,
                    firstSeenAt: record.firstSeenAt,
                    lastUsedAt: record.lastUsedAt,
                    rewriteCount: Math.floor(record.rewriteCount),
                    lastSuggestedOperation: record.lastSuggestedOperation,
                });
            }
        } catch (error) {
            const message =
                error instanceof Error ? error.message : String(error);
            this.initError = new Error(
                `Legacy rewrite state unavailable: ${message}`,
            );
        }
    }

    private persistState(): void {
        const payload: LegacyRewriteStateFile = {
            version: 1,
            records: Array.from(this.records.values()).sort((a, b) =>
                a.key.localeCompare(b.key),
            ),
        };
        const serialized = `${JSON.stringify(payload, null, 2)}\n`;
        const tmpPath = `${this.statePath}.tmp`;

        mkdirSync(dirname(this.statePath), { recursive: true });
        writeFileSync(tmpPath, serialized, "utf8");
        renameSync(tmpPath, this.statePath);
    }

    private assertAvailable(): void {
        if (!this.initError) {
            return;
        }
        throw this.initError;
    }
}

