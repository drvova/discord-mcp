import {
    existsSync,
    mkdirSync,
    readFileSync,
    writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import {
    createCipheriv,
    createDecipheriv,
    createHash,
    randomBytes,
} from "node:crypto";

export type IdentityMode = "bot" | "user";

export type StoredIdentity = {
    id: string;
    mode: IdentityMode;
    token: string;
    createdAt: string;
    updatedAt: string;
};

type PersistedEnvelope = {
    version: number;
    identities: StoredIdentity[];
};

function normalizeKey(rawKey: string): Buffer {
    const trimmed = rawKey.trim();
    const maybeBase64 = Buffer.from(trimmed, "base64");
    if (maybeBase64.length === 32 && maybeBase64.toString("base64") === trimmed) {
        return maybeBase64;
    }

    const maybeHex = Buffer.from(trimmed, "hex");
    if (maybeHex.length === 32 && maybeHex.toString("hex") === trimmed) {
        return maybeHex;
    }

    return createHash("sha256").update(trimmed).digest();
}

export class LocalEncryptedIdentityStore {
    private readonly filePath: string;
    private readonly key?: Buffer;
    private readonly identities = new Map<string, StoredIdentity>();
    private loaded = false;

    constructor(options?: { filePath?: string; masterKey?: string }) {
        this.filePath = resolve(
            options?.filePath ||
                process.env.DISCORD_MCP_IDENTITY_STORE_PATH ||
                ".discord-mcp-identities.enc",
        );

        const configuredKey =
            options?.masterKey || process.env.DISCORD_MCP_MASTER_KEY;
        this.key = configuredKey ? normalizeKey(configuredKey) : undefined;
    }

    ensureDefaultsFromEnv(): void {
        if (process.env.DISCORD_TOKEN) {
            this.upsertIdentity("default-bot", "bot", process.env.DISCORD_TOKEN);
        }

        if (process.env.DISCORD_USER_TOKEN) {
            this.upsertIdentity(
                "default-user",
                "user",
                process.env.DISCORD_USER_TOKEN,
            );
        }
    }

    getIdentity(id: string): StoredIdentity | undefined {
        this.loadIfNeeded();
        return this.identities.get(id);
    }

    upsertIdentity(id: string, mode: IdentityMode, token: string): void {
        this.loadIfNeeded();
        const now = new Date().toISOString();
        const existing = this.identities.get(id);

        this.identities.set(id, {
            id,
            mode,
            token,
            createdAt: existing?.createdAt || now,
            updatedAt: now,
        });

        this.persist();
    }

    listIdentityIds(): string[] {
        this.loadIfNeeded();
        return [...this.identities.keys()].sort();
    }

    private loadIfNeeded(): void {
        if (this.loaded) {
            return;
        }

        this.loaded = true;

        if (!this.key || !existsSync(this.filePath)) {
            return;
        }

        const encrypted = readFileSync(this.filePath, "utf8").trim();
        if (!encrypted) {
            return;
        }

        const payload = this.decrypt(encrypted);
        const parsed = JSON.parse(payload) as PersistedEnvelope;
        const identities = parsed.identities || [];
        for (const identity of identities) {
            this.identities.set(identity.id, identity);
        }
    }

    private persist(): void {
        if (!this.key) {
            return;
        }

        const payload: PersistedEnvelope = {
            version: 1,
            identities: [...this.identities.values()],
        };

        const encoded = this.encrypt(JSON.stringify(payload));
        mkdirSync(dirname(this.filePath), { recursive: true });
        writeFileSync(this.filePath, encoded, "utf8");
    }

    private encrypt(plainText: string): string {
        if (!this.key) {
            throw new Error(
                "DISCORD_MCP_MASTER_KEY must be configured to encrypt identity data.",
            );
        }

        const iv = randomBytes(12);
        const cipher = createCipheriv("aes-256-gcm", this.key, iv);
        const encrypted = Buffer.concat([
            cipher.update(plainText, "utf8"),
            cipher.final(),
        ]);
        const tag = cipher.getAuthTag();

        return `${iv.toString("base64")}:${tag.toString("base64")}:${encrypted.toString("base64")}`;
    }

    private decrypt(encoded: string): string {
        if (!this.key) {
            throw new Error(
                "DISCORD_MCP_MASTER_KEY must be configured to decrypt identity data.",
            );
        }

        const [ivB64, tagB64, dataB64] = encoded.split(":");
        if (!ivB64 || !tagB64 || !dataB64) {
            throw new Error("Identity store is corrupted or in an unsupported format.");
        }

        const iv = Buffer.from(ivB64, "base64");
        const tag = Buffer.from(tagB64, "base64");
        const data = Buffer.from(dataB64, "base64");

        const decipher = createDecipheriv("aes-256-gcm", this.key, iv);
        decipher.setAuthTag(tag);
        return Buffer.concat([decipher.update(data), decipher.final()]).toString(
            "utf8",
        );
    }
}
