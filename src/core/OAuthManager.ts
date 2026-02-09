import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export interface OAuthManagerConfig {
    clientId?: string;
    clientSecret?: string;
    redirectUri?: string;
    stateTtlSeconds: number;
    storePath: string;
    defaultGuildId?: string;
}

interface OAuthStateRecord {
    createdAt: string;
    expiresAt: string;
    usedAt?: string;
    guildId?: string;
    disableGuildSelect: boolean;
}

interface StoredOAuthSession {
    sessionId: string;
    createdAt: string;
    expiresAt: string;
    stateHash: string;
    tokenType: string;
    scope: string;
    accessToken: string;
    refreshToken?: string;
    guildsSnapshot: OAuthGuildSummary[];
}

interface OAuthStore {
    states: Record<string, OAuthStateRecord>;
    sessions: StoredOAuthSession[];
}

interface DiscordTokenResponse {
    access_token: string;
    token_type: string;
    expires_in: number;
    refresh_token?: string;
    scope: string;
}

export interface OAuthGuildSummary {
    id: string;
    name: string;
    owner: boolean;
    permissions: string;
}

export interface OAuthAuthorizationResult {
    authorizeUrl: string;
    expiresAt: string;
    scopes: string[];
    permissions: string;
}

export interface OAuthCallbackResult {
    sessionId: string;
    createdAt: string;
    expiresAt: string;
    scope: string;
    guildCount: number;
    guilds: OAuthGuildSummary[];
}

interface CreateAuthorizeOptions {
    guildId?: string;
    disableGuildSelect?: boolean;
}

const DISCORD_AUTHORIZE_URL = "https://discord.com/api/oauth2/authorize";
const DISCORD_TOKEN_URL = "https://discord.com/api/oauth2/token";
const DISCORD_GUILDS_URL = "https://discord.com/api/users/@me/guilds";
const OAUTH_SCOPES = ["bot", "applications.commands", "guilds"];
const ADMINISTRATOR_PERMISSION_BIT = "8";

export class OAuthManager {
    private clientId?: string;
    private readonly clientSecret?: string;
    private readonly redirectUri?: string;
    private readonly stateTtlSeconds: number;
    private readonly storePath: string;
    private readonly defaultGuildId?: string;

    constructor(config: OAuthManagerConfig) {
        this.clientId = config.clientId;
        this.clientSecret = config.clientSecret;
        this.redirectUri = config.redirectUri;
        this.stateTtlSeconds = config.stateTtlSeconds;
        this.storePath = resolve(config.storePath);
        this.defaultGuildId = config.defaultGuildId;
    }

    setClientId(clientId: string): void {
        if (clientId.trim().length > 0) {
            this.clientId = clientId.trim();
        }
    }

    getMissingFullFlowConfigFields(): string[] {
        const missing: string[] = [];

        if (!this.clientId) {
            missing.push("DISCORD_CLIENT_ID (or Discord bot app ID)");
        }
        if (!this.clientSecret) {
            missing.push("DISCORD_CLIENT_SECRET");
        }
        if (!this.redirectUri) {
            missing.push("DISCORD_OAUTH_REDIRECT_URI");
        }

        return missing;
    }

    async createAuthorizeLink(
        options: CreateAuthorizeOptions = {},
    ): Promise<OAuthAuthorizationResult> {
        const clientId = this.requireClientId();
        const redirectUri = this.requireRedirectUri();
        const state = randomBytes(32).toString("hex");
        const now = Date.now();
        const expiresAt = new Date(
            now + this.stateTtlSeconds * 1000,
        ).toISOString();
        const guildId = options.guildId || this.defaultGuildId;
        const disableGuildSelect = options.disableGuildSelect ?? false;

        const store = await this.readStore();
        this.pruneExpiredStateEntries(store, now);
        store.states[this.hashState(state)] = {
            createdAt: new Date(now).toISOString(),
            expiresAt,
            guildId,
            disableGuildSelect,
        };
        await this.writeStore(store);

        const params = new URLSearchParams({
            client_id: clientId,
            response_type: "code",
            redirect_uri: redirectUri,
            scope: OAUTH_SCOPES.join(" "),
            permissions: ADMINISTRATOR_PERMISSION_BIT,
            state,
        });

        if (guildId) {
            params.set("guild_id", guildId);
        }
        if (disableGuildSelect) {
            params.set("disable_guild_select", "true");
        }

        return {
            authorizeUrl: `${DISCORD_AUTHORIZE_URL}?${params.toString()}`,
            expiresAt,
            scopes: [...OAUTH_SCOPES],
            permissions: ADMINISTRATOR_PERMISSION_BIT,
        };
    }

    async completeCallback(code: string, state: string): Promise<OAuthCallbackResult> {
        if (!code || !state) {
            throw new Error("OAuth callback requires both code and state");
        }

        const stateHash = await this.consumeState(state);
        const token = await this.exchangeCodeForToken(code);
        const guilds = await this.fetchUserGuilds(
            token.token_type,
            token.access_token,
        );

        const now = Date.now();
        const createdAt = new Date(now).toISOString();
        const expiresAt = new Date(now + token.expires_in * 1000).toISOString();
        const sessionId = randomUUID();

        const store = await this.readStore();
        this.pruneExpiredStateEntries(store, now);
        store.sessions.push({
            sessionId,
            createdAt,
            expiresAt,
            stateHash,
            tokenType: token.token_type,
            scope: token.scope,
            accessToken: token.access_token,
            refreshToken: token.refresh_token,
            guildsSnapshot: guilds,
        });
        if (store.sessions.length > 1000) {
            store.sessions = store.sessions.slice(-1000);
        }
        await this.writeStore(store);

        return {
            sessionId,
            createdAt,
            expiresAt,
            scope: token.scope,
            guildCount: guilds.length,
            guilds,
        };
    }

    private requireClientId(): string {
        if (!this.clientId || this.clientId.trim().length === 0) {
            throw new Error(
                "OAuth is not configured: missing DISCORD_CLIENT_ID (or bot app ID)",
            );
        }
        return this.clientId;
    }

    private requireRedirectUri(): string {
        if (!this.redirectUri || this.redirectUri.trim().length === 0) {
            throw new Error(
                "OAuth is not configured: missing DISCORD_OAUTH_REDIRECT_URI",
            );
        }
        return this.redirectUri;
    }

    private requireClientSecret(): string {
        if (!this.clientSecret || this.clientSecret.trim().length === 0) {
            throw new Error(
                "OAuth callback exchange is not configured: missing DISCORD_CLIENT_SECRET",
            );
        }
        return this.clientSecret;
    }

    private hashState(state: string): string {
        return createHash("sha256").update(state).digest("hex");
    }

    private async consumeState(state: string): Promise<string> {
        const now = Date.now();
        const stateHash = this.hashState(state);
        const store = await this.readStore();
        this.pruneExpiredStateEntries(store, now);

        const record = store.states[stateHash];
        if (!record) {
            throw new Error("Invalid OAuth state");
        }
        if (record.usedAt) {
            throw new Error("OAuth state has already been used");
        }
        if (Date.parse(record.expiresAt) <= now) {
            delete store.states[stateHash];
            await this.writeStore(store);
            throw new Error("OAuth state has expired");
        }

        record.usedAt = new Date(now).toISOString();
        store.states[stateHash] = record;
        await this.writeStore(store);
        return stateHash;
    }

    private async exchangeCodeForToken(code: string): Promise<DiscordTokenResponse> {
        const clientId = this.requireClientId();
        const clientSecret = this.requireClientSecret();
        const redirectUri = this.requireRedirectUri();

        const body = new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            grant_type: "authorization_code",
            code,
            redirect_uri: redirectUri,
        });

        const response = await fetch(DISCORD_TOKEN_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body: body.toString(),
        });

        const rawBody = await response.text();
        let payload: any = {};
        try {
            payload = rawBody ? JSON.parse(rawBody) : {};
        } catch {
            payload = {};
        }

        if (!response.ok) {
            const errorDetail =
                typeof payload.error_description === "string"
                    ? payload.error_description
                    : rawBody.slice(0, 200);
            throw new Error(
                `Discord OAuth token exchange failed (${response.status}): ${errorDetail || "Unknown error"}`,
            );
        }

        if (
            typeof payload.access_token !== "string" ||
            typeof payload.token_type !== "string" ||
            typeof payload.expires_in !== "number" ||
            typeof payload.scope !== "string"
        ) {
            throw new Error(
                "Discord OAuth token exchange returned an invalid payload",
            );
        }

        return payload as DiscordTokenResponse;
    }

    private async fetchUserGuilds(
        tokenType: string,
        accessToken: string,
    ): Promise<OAuthGuildSummary[]> {
        const response = await fetch(DISCORD_GUILDS_URL, {
            headers: {
                Authorization: `${tokenType} ${accessToken}`,
            },
        });

        const rawBody = await response.text();
        let payload: any = [];
        try {
            payload = rawBody ? JSON.parse(rawBody) : [];
        } catch {
            payload = [];
        }

        if (!response.ok) {
            const errorDetail =
                typeof payload.message === "string"
                    ? payload.message
                    : rawBody.slice(0, 200);
            throw new Error(
                `Discord guild fetch failed (${response.status}): ${errorDetail || "Unknown error"}`,
            );
        }

        if (!Array.isArray(payload)) {
            throw new Error("Discord guild fetch returned an invalid payload");
        }

        return payload
            .filter(
                (guild) =>
                    guild &&
                    typeof guild.id === "string" &&
                    typeof guild.name === "string",
            )
            .map((guild) => ({
                id: guild.id as string,
                name: guild.name as string,
                owner: Boolean(guild.owner),
                permissions:
                    typeof guild.permissions === "string"
                        ? guild.permissions
                        : String(guild.permissions ?? ""),
            }));
    }

    private pruneExpiredStateEntries(store: OAuthStore, now: number): void {
        for (const [stateHash, state] of Object.entries(store.states)) {
            if (
                Date.parse(state.expiresAt) <= now ||
                typeof state.usedAt === "string"
            ) {
                delete store.states[stateHash];
            }
        }
    }

    private async readStore(): Promise<OAuthStore> {
        try {
            const raw = await readFile(this.storePath, "utf8");
            const parsed = JSON.parse(raw);
            const store = this.normalizeStore(parsed);
            this.pruneExpiredStateEntries(store, Date.now());
            return store;
        } catch (error) {
            const nodeError = error as NodeJS.ErrnoException;
            if (nodeError.code === "ENOENT") {
                return { states: {}, sessions: [] };
            }

            if (nodeError.name === "SyntaxError") {
                const backupPath = `${this.storePath}.corrupt-${Date.now()}`;
                try {
                    await rename(this.storePath, backupPath);
                } catch {
                    // Keep startup resilient even if backup rename fails.
                }
                return { states: {}, sessions: [] };
            }

            throw error;
        }
    }

    private normalizeStore(parsed: any): OAuthStore {
        const states = parsed && typeof parsed === "object" ? parsed.states : {};
        const sessions =
            parsed && typeof parsed === "object" ? parsed.sessions : [];

        return {
            states:
                states && typeof states === "object" && !Array.isArray(states)
                    ? (states as Record<string, OAuthStateRecord>)
                    : {},
            sessions: Array.isArray(sessions)
                ? (sessions as StoredOAuthSession[])
                : [],
        };
    }

    private async writeStore(store: OAuthStore): Promise<void> {
        await mkdir(dirname(this.storePath), { recursive: true });

        const tempPath = `${this.storePath}.tmp-${process.pid}-${Date.now()}`;
        const body = JSON.stringify(store, null, 2);

        await writeFile(tempPath, body, "utf8");
        await rename(tempPath, this.storePath);
    }
}
