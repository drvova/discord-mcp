import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
    isDiscordJsInvocationOperation,
    resolveDomainMethod,
    resolveOperationForMethod,
    type DiscordOperation,
    type DomainMethod,
} from "../gateway/domain-registry.js";
import {
    getDiscordJsSymbolsCatalog,
    type DiscordJsSymbol,
} from "../gateway/discordjs-symbol-catalog.js";
import type { IdentityMode } from "../identity/local-encrypted-identity-store.js";

export type ChatMessageRole = "user" | "assistant" | "system";

export type WebUiSessionPublic = {
    sessionId: string;
    subject: string;
    name?: string;
    email?: string;
    defaultMode: IdentityMode;
    rememberMode: boolean;
    createdAt: string;
    expiresAt: string;
};

export type ChatThreadRecord = {
    id: string;
    sessionId: string;
    title: string;
    createdAt: string;
    updatedAt: string;
};

export type ChatMessageRecord = {
    id: string;
    threadId: string;
    role: ChatMessageRole;
    content: string;
    createdAt: string;
    metadata?: Record<string, unknown>;
};

export type PlannedActionRisk = "low" | "medium" | "high";

export type PlannedAction = {
    id: string;
    method: DomainMethod;
    operation: DiscordOperation;
    params: Record<string, unknown>;
    rationale: string;
    riskTier: PlannedActionRisk;
    requiresConfirmation: boolean;
};

export type PlannedActionResult = {
    actionId: string;
    method: DomainMethod;
    operation: DiscordOperation;
    status: "success" | "error";
    output?: string;
    error?: string;
};

export type PlanResult = {
    summary: string;
    actions: PlannedAction[];
};

export type PlanMessageResult = {
    thread: ChatThreadRecord;
    userMessage: ChatMessageRecord;
    assistantMessage: ChatMessageRecord;
    plan: PlanResult;
};

export type ExecutePlanResult = {
    results: PlannedActionResult[];
    assistantMessage: ChatMessageRecord;
};

export type WebUiExecutionRequest = {
    mode: IdentityMode;
    identityId: string;
    method: DomainMethod;
    operation: DiscordOperation;
    params: Record<string, unknown>;
};

export type WebUiExecutionResponse = {
    text: string;
};

export type WebUiExecutionAdapter = (
    request: WebUiExecutionRequest,
) => Promise<WebUiExecutionResponse>;

type OidcProfile = {
    sub: string;
    name?: string;
    email?: string;
};

type StoredSessionRecord = WebUiSessionPublic & {
    provider: "oidc";
};

type StoredOidcStateRecord = {
    state: string;
    codeVerifier?: string;
    returnTo?: string;
    createdAt: string;
    expiresAt: string;
};

type StoredWebUiState = {
    sessions: Record<string, StoredSessionRecord>;
    oidcStates: Record<string, StoredOidcStateRecord>;
    threads: Record<string, ChatThreadRecord>;
    messages: Record<string, ChatMessageRecord[]>;
};

type ResolvedOidcEndpoints = {
    authorizationEndpoint: string;
    tokenEndpoint: string;
    userinfoEndpoint?: string;
};

type RemotePlannerResponse = {
    summary?: unknown;
    actions?: unknown;
};

export type WebUiRuntimeConfig = {
    storePath: string;
    sessionTtlSeconds: number;
    oidcStateTtlSeconds: number;
    oidc: {
        issuer?: string;
        authorizationEndpoint?: string;
        tokenEndpoint?: string;
        userinfoEndpoint?: string;
        clientId?: string;
        clientSecret?: string;
        redirectUri?: string;
        scopes: string[];
        pkceRequired: boolean;
    };
    planner: {
        apiKey?: string;
        baseUrl?: string;
        model: string;
        maxActions: number;
    };
};

function normalizeUrl(value: string): string {
    return value.replace(/\/+$/, "");
}

function toIsoTime(epochMs: number): string {
    return new Date(epochMs).toISOString();
}

function base64UrlEncode(value: Buffer): string {
    return value
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/g, "");
}

function base64UrlDecode(value: string): Buffer {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const padLength = (4 - (normalized.length % 4)) % 4;
    return Buffer.from(normalized + "=".repeat(padLength), "base64");
}

function normalizeRecord(
    value: unknown,
): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return {};
    }
    return value as Record<string, unknown>;
}

function normalizeMessages(
    value: unknown,
): Record<string, ChatMessageRecord[]> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return {};
    }

    const result: Record<string, ChatMessageRecord[]> = {};
    for (const [threadId, messages] of Object.entries(
        value as Record<string, unknown>,
    )) {
        if (!Array.isArray(messages)) {
            continue;
        }
        result[threadId] = messages.filter(
            (message) =>
                message &&
                typeof message === "object" &&
                typeof (message as ChatMessageRecord).id === "string" &&
                typeof (message as ChatMessageRecord).threadId === "string" &&
                typeof (message as ChatMessageRecord).role === "string" &&
                typeof (message as ChatMessageRecord).content === "string" &&
                typeof (message as ChatMessageRecord).createdAt === "string",
        ) as ChatMessageRecord[];
    }

    return result;
}

function createDefaultState(): StoredWebUiState {
    return {
        sessions: {},
        oidcStates: {},
        threads: {},
        messages: {},
    };
}

function clonePublicSession(
    session: StoredSessionRecord,
): WebUiSessionPublic {
    return {
        sessionId: session.sessionId,
        subject: session.subject,
        name: session.name,
        email: session.email,
        defaultMode: session.defaultMode,
        rememberMode: session.rememberMode,
        createdAt: session.createdAt,
        expiresAt: session.expiresAt,
    };
}

function inferRiskTier(
    method: DomainMethod,
    operation: DiscordOperation,
): PlannedActionRisk {
    if (method === "automation.write" || isDiscordJsInvocationOperation(operation)) {
        return "high";
    }
    return "low";
}

function summarizeExecutionResults(results: PlannedActionResult[]): string {
    const success = results.filter((entry) => entry.status === "success").length;
    const failed = results.length - success;
    return `Executed ${results.length} action(s): ${success} succeeded, ${failed} failed.`;
}

export class WebUiRuntime {
    private readonly statePath: string;
    private readonly sessionTtlSeconds: number;
    private readonly oidcStateTtlSeconds: number;
    private readonly oidcConfig: WebUiRuntimeConfig["oidc"];
    private readonly plannerConfig: Required<WebUiRuntimeConfig["planner"]>;
    private readonly executeCall: WebUiExecutionAdapter;

    private loaded = false;
    private state: StoredWebUiState = createDefaultState();
    private resolvedOidcEndpoints: ResolvedOidcEndpoints | null = null;

    constructor(config: WebUiRuntimeConfig, executeCall: WebUiExecutionAdapter) {
        this.statePath = resolve(config.storePath);
        this.sessionTtlSeconds = Math.max(300, config.sessionTtlSeconds);
        this.oidcStateTtlSeconds = Math.max(60, config.oidcStateTtlSeconds);
        this.oidcConfig = {
            ...config.oidc,
            scopes:
                config.oidc.scopes.length > 0
                    ? [...config.oidc.scopes]
                    : ["openid", "profile", "email"],
        };
        this.plannerConfig = {
            apiKey: config.planner.apiKey || "",
            baseUrl: normalizeUrl(
                config.planner.baseUrl || "https://api.openai.com/v1",
            ),
            model: config.planner.model,
            maxActions: Math.max(1, config.planner.maxActions),
        };
        this.executeCall = executeCall;
    }

    getOidcMissingConfigFields(): string[] {
        const missing: string[] = [];

        if (!this.oidcConfig.clientId) {
            missing.push("DISCORD_WEB_OIDC_CLIENT_ID");
        }
        if (!this.oidcConfig.redirectUri) {
            missing.push("DISCORD_WEB_OIDC_REDIRECT_URI");
        }
        if (!this.oidcConfig.authorizationEndpoint && !this.oidcConfig.issuer) {
            missing.push("DISCORD_WEB_OIDC_AUTHORIZATION_ENDPOINT or DISCORD_WEB_OIDC_ISSUER");
        }
        if (!this.oidcConfig.tokenEndpoint && !this.oidcConfig.issuer) {
            missing.push("DISCORD_WEB_OIDC_TOKEN_ENDPOINT or DISCORD_WEB_OIDC_ISSUER");
        }

        return missing;
    }

    isOidcConfigured(): boolean {
        return this.getOidcMissingConfigFields().length === 0;
    }

    async getSession(sessionId: string): Promise<WebUiSessionPublic | null> {
        await this.loadStateIfNeeded();
        const stateChanged = this.pruneExpiredEntries(Date.now());
        const session = this.state.sessions[sessionId];
        if (stateChanged) {
            await this.persistState();
        }
        return session ? clonePublicSession(session) : null;
    }

    async deleteSession(sessionId: string): Promise<void> {
        await this.loadStateIfNeeded();
        if (!this.state.sessions[sessionId]) {
            return;
        }
        delete this.state.sessions[sessionId];

        for (const [threadId, thread] of Object.entries(this.state.threads)) {
            if (thread.sessionId !== sessionId) {
                continue;
            }
            delete this.state.threads[threadId];
            delete this.state.messages[threadId];
        }

        await this.persistState();
    }

    async updateSessionIdentityPreference(
        sessionId: string,
        mode: IdentityMode,
        rememberMode: boolean,
    ): Promise<WebUiSessionPublic> {
        await this.loadStateIfNeeded();
        const session = this.state.sessions[sessionId];
        if (!session) {
            throw new Error("Session not found");
        }

        session.defaultMode = mode;
        session.rememberMode = rememberMode;
        this.state.sessions[sessionId] = session;
        await this.persistState();

        return clonePublicSession(session);
    }

    async startOidcAuthentication(returnTo?: string): Promise<{
        authorizeUrl: string;
        expiresAt: string;
    }> {
        await this.loadStateIfNeeded();

        const missing = this.getOidcMissingConfigFields();
        if (missing.length > 0) {
            throw new Error(
                `OIDC is not configured. Missing: ${missing.join(", ")}`,
            );
        }

        const endpoints = await this.resolveOidcEndpoints();
        const state = base64UrlEncode(randomBytes(32));
        const createdAtEpoch = Date.now();
        const expiresAt = toIsoTime(
            createdAtEpoch + this.oidcStateTtlSeconds * 1000,
        );

        let codeVerifier: string | undefined;
        let codeChallenge: string | undefined;

        if (this.oidcConfig.pkceRequired) {
            codeVerifier = base64UrlEncode(randomBytes(48));
            codeChallenge = base64UrlEncode(
                createHash("sha256").update(codeVerifier).digest(),
            );
        }

        this.state.oidcStates[state] = {
            state,
            codeVerifier,
            returnTo,
            createdAt: toIsoTime(createdAtEpoch),
            expiresAt,
        };
        await this.persistState();

        const params = new URLSearchParams({
            response_type: "code",
            client_id: this.oidcConfig.clientId as string,
            redirect_uri: this.oidcConfig.redirectUri as string,
            scope: this.oidcConfig.scopes.join(" "),
            state,
        });

        if (codeChallenge) {
            params.set("code_challenge", codeChallenge);
            params.set("code_challenge_method", "S256");
        }

        return {
            authorizeUrl: `${endpoints.authorizationEndpoint}?${params.toString()}`,
            expiresAt,
        };
    }

    async completeOidcAuthentication(
        code: string,
        state: string,
    ): Promise<{
        session: WebUiSessionPublic;
        returnTo?: string;
    }> {
        if (!code.trim() || !state.trim()) {
            throw new Error("OIDC callback requires both code and state");
        }

        await this.loadStateIfNeeded();
        const endpoints = await this.resolveOidcEndpoints();
        const oidcState = await this.consumeOidcState(state);

        const tokenPayload = await this.exchangeCodeForToken(
            code,
            oidcState.codeVerifier,
            endpoints.tokenEndpoint,
        );

        const profile = await this.resolveProfile(
            tokenPayload.access_token,
            tokenPayload.id_token,
            endpoints.userinfoEndpoint,
        );

        const now = Date.now();
        const sessionId = randomUUID();
        const session: StoredSessionRecord = {
            sessionId,
            provider: "oidc",
            subject: profile.sub,
            name: profile.name,
            email: profile.email,
            defaultMode: "bot",
            rememberMode: false,
            createdAt: toIsoTime(now),
            expiresAt: toIsoTime(now + this.sessionTtlSeconds * 1000),
        };

        this.state.sessions[sessionId] = session;
        await this.persistState();

        return {
            session: clonePublicSession(session),
            returnTo: oidcState.returnTo,
        };
    }

    async listThreads(sessionId: string): Promise<ChatThreadRecord[]> {
        await this.assertSessionExists(sessionId);
        await this.loadStateIfNeeded();
        return Object.values(this.state.threads)
            .filter((thread) => thread.sessionId === sessionId)
            .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    }

    async createThread(
        sessionId: string,
        title?: string,
    ): Promise<ChatThreadRecord> {
        await this.assertSessionExists(sessionId);
        await this.loadStateIfNeeded();

        const now = toIsoTime(Date.now());
        const thread: ChatThreadRecord = {
            id: randomUUID(),
            sessionId,
            title: this.normalizeThreadTitle(title || "New Chat"),
            createdAt: now,
            updatedAt: now,
        };

        this.state.threads[thread.id] = thread;
        this.state.messages[thread.id] = [];
        await this.persistState();

        return thread;
    }

    async listMessages(
        sessionId: string,
        threadId: string,
    ): Promise<ChatMessageRecord[]> {
        await this.assertThreadOwnership(sessionId, threadId);
        await this.loadStateIfNeeded();
        return [...(this.state.messages[threadId] || [])].sort((left, right) =>
            left.createdAt.localeCompare(right.createdAt),
        );
    }

    async planMessage(input: {
        sessionId: string;
        threadId?: string;
        message: string;
        mode: IdentityMode;
        identityId: string;
        rememberMode: boolean;
    }): Promise<PlanMessageResult> {
        const text = input.message.trim();
        if (!text) {
            throw new Error("Message cannot be empty");
        }

        const session = await this.assertSessionExists(input.sessionId);
        await this.loadStateIfNeeded();

        if (session.rememberMode !== input.rememberMode || session.defaultMode !== input.mode) {
            session.rememberMode = input.rememberMode;
            session.defaultMode = input.mode;
            this.state.sessions[input.sessionId] = session;
        }

        const thread = await this.ensureThread(input.sessionId, input.threadId, text);
        const userMessage = await this.appendMessage(thread.id, "user", text, {
            mode: input.mode,
            identityId: input.identityId,
        });

        const history = this.state.messages[thread.id] || [];
        const plan = await this.generatePlan({
            message: text,
            mode: input.mode,
            identityId: input.identityId,
            history,
        });

        const assistantMessage = await this.appendMessage(
            thread.id,
            "assistant",
            plan.summary,
            {
                kind: "plan",
                actions: plan.actions,
                mode: input.mode,
                identityId: input.identityId,
            },
        );

        return {
            thread,
            userMessage,
            assistantMessage,
            plan,
        };
    }

    async executePlan(input: {
        sessionId: string;
        threadId: string;
        mode: IdentityMode;
        identityId: string;
        actions: PlannedAction[];
        confirmWrites: boolean;
    }): Promise<ExecutePlanResult> {
        await this.assertSessionExists(input.sessionId);
        await this.assertThreadOwnership(input.sessionId, input.threadId);

        if (!Array.isArray(input.actions) || input.actions.length === 0) {
            throw new Error("No planned actions provided for execution");
        }

        const results: PlannedActionResult[] = [];

        for (const action of input.actions) {
            const method = resolveDomainMethod(action.method);
            const operation = resolveOperationForMethod(method, action.operation);
            const params = normalizeRecord(action.params);
            const shouldTreatAsWrite = method === "automation.write";

            const executionParams: Record<string, unknown> = { ...params };
            if (shouldTreatAsWrite) {
                executionParams.dryRun = !input.confirmWrites;
                executionParams.allowWrite = input.confirmWrites;
                executionParams.policyMode =
                    typeof executionParams.policyMode === "string"
                        ? executionParams.policyMode
                        : "strict";
            }

            try {
                const response = await this.executeCall({
                    mode: input.mode,
                    identityId: input.identityId,
                    method,
                    operation,
                    params: executionParams,
                });

                results.push({
                    actionId: action.id,
                    method,
                    operation,
                    status: "success",
                    output: response.text,
                });
            } catch (error) {
                results.push({
                    actionId: action.id,
                    method,
                    operation,
                    status: "error",
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        }

        const assistantMessage = await this.appendMessage(
            input.threadId,
            "assistant",
            summarizeExecutionResults(results),
            {
                kind: "execution",
                confirmWrites: input.confirmWrites,
                mode: input.mode,
                identityId: input.identityId,
                results,
            },
        );

        return {
            results,
            assistantMessage,
        };
    }

    private async ensureThread(
        sessionId: string,
        threadId: string | undefined,
        firstMessage: string,
    ): Promise<ChatThreadRecord> {
        await this.loadStateIfNeeded();

        if (threadId) {
            const existing = this.state.threads[threadId];
            if (existing && existing.sessionId === sessionId) {
                return existing;
            }
            throw new Error("Thread not found");
        }

        const now = toIsoTime(Date.now());
        const thread: ChatThreadRecord = {
            id: randomUUID(),
            sessionId,
            title: this.inferThreadTitle(firstMessage),
            createdAt: now,
            updatedAt: now,
        };

        this.state.threads[thread.id] = thread;
        this.state.messages[thread.id] = [];
        await this.persistState();

        return thread;
    }

    private inferThreadTitle(message: string): string {
        const compact = message
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 64);
        return this.normalizeThreadTitle(compact || "New Chat");
    }

    private normalizeThreadTitle(title: string): string {
        const normalized = title.replace(/\s+/g, " ").trim();
        return normalized.length > 0 ? normalized : "New Chat";
    }

    private async appendMessage(
        threadId: string,
        role: ChatMessageRole,
        content: string,
        metadata?: Record<string, unknown>,
    ): Promise<ChatMessageRecord> {
        await this.loadStateIfNeeded();

        const thread = this.state.threads[threadId];
        if (!thread) {
            throw new Error("Thread not found");
        }

        const message: ChatMessageRecord = {
            id: randomUUID(),
            threadId,
            role,
            content,
            createdAt: toIsoTime(Date.now()),
            metadata,
        };

        if (!this.state.messages[threadId]) {
            this.state.messages[threadId] = [];
        }
        this.state.messages[threadId].push(message);

        thread.updatedAt = message.createdAt;
        this.state.threads[threadId] = thread;
        await this.persistState();

        return message;
    }

    private async assertSessionExists(
        sessionId: string,
    ): Promise<StoredSessionRecord> {
        await this.loadStateIfNeeded();
        const changed = this.pruneExpiredEntries(Date.now());
        const session = this.state.sessions[sessionId];
        if (changed) {
            await this.persistState();
        }
        if (!session) {
            throw new Error("Session is not authenticated");
        }
        return session;
    }

    private async assertThreadOwnership(
        sessionId: string,
        threadId: string,
    ): Promise<ChatThreadRecord> {
        await this.loadStateIfNeeded();
        const thread = this.state.threads[threadId];
        if (!thread || thread.sessionId !== sessionId) {
            throw new Error("Thread not found");
        }
        return thread;
    }

    private async consumeOidcState(state: string): Promise<StoredOidcStateRecord> {
        const now = Date.now();
        const changed = this.pruneExpiredEntries(now);
        const record = this.state.oidcStates[state];

        if (!record) {
            if (changed) {
                await this.persistState();
            }
            throw new Error("Invalid OIDC state");
        }

        if (Date.parse(record.expiresAt) <= now) {
            delete this.state.oidcStates[state];
            await this.persistState();
            throw new Error("OIDC state has expired");
        }

        delete this.state.oidcStates[state];
        await this.persistState();
        return record;
    }

    private async resolveOidcEndpoints(): Promise<ResolvedOidcEndpoints> {
        if (this.resolvedOidcEndpoints) {
            return this.resolvedOidcEndpoints;
        }

        if (
            this.oidcConfig.authorizationEndpoint &&
            this.oidcConfig.tokenEndpoint
        ) {
            this.resolvedOidcEndpoints = {
                authorizationEndpoint: this.oidcConfig.authorizationEndpoint,
                tokenEndpoint: this.oidcConfig.tokenEndpoint,
                userinfoEndpoint: this.oidcConfig.userinfoEndpoint,
            };
            return this.resolvedOidcEndpoints;
        }

        if (!this.oidcConfig.issuer) {
            throw new Error(
                "OIDC issuer is not configured and endpoints were not provided.",
            );
        }

        const issuer = normalizeUrl(this.oidcConfig.issuer);
        const discoveryUrl = `${issuer}/.well-known/openid-configuration`;
        const response = await fetch(discoveryUrl);
        const rawBody = await response.text();

        let payload: Record<string, unknown> = {};
        try {
            payload = rawBody ? (JSON.parse(rawBody) as Record<string, unknown>) : {};
        } catch {
            payload = {};
        }

        if (!response.ok) {
            throw new Error(
                `OIDC discovery failed (${response.status}): ${rawBody.slice(0, 200)}`,
            );
        }

        const authorizationEndpoint =
            typeof payload.authorization_endpoint === "string"
                ? payload.authorization_endpoint
                : this.oidcConfig.authorizationEndpoint;
        const tokenEndpoint =
            typeof payload.token_endpoint === "string"
                ? payload.token_endpoint
                : this.oidcConfig.tokenEndpoint;
        const userinfoEndpoint =
            typeof payload.userinfo_endpoint === "string"
                ? payload.userinfo_endpoint
                : this.oidcConfig.userinfoEndpoint;

        if (!authorizationEndpoint || !tokenEndpoint) {
            throw new Error(
                "OIDC discovery did not return both authorization and token endpoints.",
            );
        }

        this.resolvedOidcEndpoints = {
            authorizationEndpoint,
            tokenEndpoint,
            userinfoEndpoint,
        };

        return this.resolvedOidcEndpoints;
    }

    private async exchangeCodeForToken(
        code: string,
        codeVerifier: string | undefined,
        tokenEndpoint: string,
    ): Promise<{
        access_token: string;
        id_token?: string;
    }> {
        const body = new URLSearchParams({
            grant_type: "authorization_code",
            code,
            redirect_uri: this.oidcConfig.redirectUri as string,
            client_id: this.oidcConfig.clientId as string,
        });

        if (this.oidcConfig.clientSecret) {
            body.set("client_secret", this.oidcConfig.clientSecret);
        }

        if (this.oidcConfig.pkceRequired && codeVerifier) {
            body.set("code_verifier", codeVerifier);
        }

        const response = await fetch(tokenEndpoint, {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body: body.toString(),
        });

        const rawBody = await response.text();
        let payload: Record<string, unknown> = {};
        try {
            payload = rawBody ? (JSON.parse(rawBody) as Record<string, unknown>) : {};
        } catch {
            payload = {};
        }

        if (!response.ok) {
            const errorDetail =
                typeof payload.error_description === "string"
                    ? payload.error_description
                    : rawBody.slice(0, 200);
            throw new Error(
                `OIDC token exchange failed (${response.status}): ${errorDetail || "Unknown error"}`,
            );
        }

        if (typeof payload.access_token !== "string") {
            throw new Error("OIDC token exchange returned invalid access_token");
        }

        return {
            access_token: payload.access_token,
            id_token:
                typeof payload.id_token === "string" ? payload.id_token : undefined,
        };
    }

    private async resolveProfile(
        accessToken: string,
        idToken: string | undefined,
        userinfoEndpoint: string | undefined,
    ): Promise<OidcProfile> {
        if (userinfoEndpoint) {
            const response = await fetch(userinfoEndpoint, {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                },
            });
            const rawBody = await response.text();
            let payload: Record<string, unknown> = {};
            try {
                payload = rawBody
                    ? (JSON.parse(rawBody) as Record<string, unknown>)
                    : {};
            } catch {
                payload = {};
            }

            if (!response.ok) {
                throw new Error(
                    `OIDC userinfo fetch failed (${response.status}): ${rawBody.slice(0, 200)}`,
                );
            }

            if (typeof payload.sub !== "string") {
                throw new Error("OIDC userinfo response is missing subject (sub)");
            }

            return {
                sub: payload.sub,
                name: typeof payload.name === "string" ? payload.name : undefined,
                email: typeof payload.email === "string" ? payload.email : undefined,
            };
        }

        if (!idToken) {
            throw new Error(
                "OIDC configuration requires userinfo endpoint or id_token in token response",
            );
        }

        const tokenParts = idToken.split(".");
        if (tokenParts.length < 2) {
            throw new Error("OIDC id_token format is invalid");
        }

        let payload: Record<string, unknown> = {};
        try {
            payload = JSON.parse(
                base64UrlDecode(tokenParts[1]).toString("utf8"),
            ) as Record<string, unknown>;
        } catch {
            payload = {};
        }

        if (typeof payload.sub !== "string") {
            throw new Error("OIDC id_token payload is missing subject (sub)");
        }

        return {
            sub: payload.sub,
            name: typeof payload.name === "string" ? payload.name : undefined,
            email: typeof payload.email === "string" ? payload.email : undefined,
        };
    }

    private async generatePlan(input: {
        message: string;
        mode: IdentityMode;
        identityId: string;
        history: ChatMessageRecord[];
    }): Promise<PlanResult> {
        try {
            const fromRemote = await this.planWithRemoteModel(input);
            if (fromRemote) {
                return fromRemote;
            }
        } catch {
            // Fall through to deterministic planner when remote planning fails.
        }

        return this.planWithHeuristics(input.message);
    }

    private async planWithRemoteModel(input: {
        message: string;
        mode: IdentityMode;
        identityId: string;
        history: ChatMessageRecord[];
    }): Promise<PlanResult | null> {
        if (!this.plannerConfig.apiKey || !this.plannerConfig.model) {
            return null;
        }

        let symbols: DiscordJsSymbol[] = [];
        try {
            const catalog = await getDiscordJsSymbolsCatalog({
                kinds: ["function"],
                query: input.message,
                page: 1,
                pageSize: 30,
            });
            symbols = catalog.items;
        } catch {
            symbols = [];
        }

        const historyExcerpt = input.history
            .slice(-6)
            .map((message) => `${message.role}: ${message.content}`)
            .join("\n");

        const symbolHints = symbols
            .slice(0, 20)
            .map((symbol) => {
                return `${symbol.operationKey} (${symbol.behaviorClass})`;
            })
            .join("\n");

        const systemPrompt = [
            "You are a planner for a Discord MCP tool router.",
            "Return strict JSON only with shape: {\"summary\": string, \"actions\": Action[] }.",
            "Action shape: {\"method\": string, \"operation\": string, \"params\": object, \"rationale\": string }.",
            "Method must be one of automation.read or automation.write.",
            "Discovery uses operation discordjs.meta.symbols.",
            "Invocation uses discordjs.<kind>.<symbol>.",
            "For write operations include dryRun=true and allowWrite=false in params.",
            "If uncertain, return one safe discovery action.",
            "Never return markdown or code fences.",
        ].join(" ");

        const userPrompt = [
            `Mode: ${input.mode}`,
            `Identity: ${input.identityId}`,
            "Recent history:",
            historyExcerpt || "(none)",
            "Available symbol hints:",
            symbolHints || "(none)",
            "User message:",
            input.message,
        ].join("\n");

        const response = await fetch(
            `${this.plannerConfig.baseUrl}/chat/completions`,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${this.plannerConfig.apiKey}`,
                },
                body: JSON.stringify({
                    model: this.plannerConfig.model,
                    temperature: 0.1,
                    response_format: { type: "json_object" },
                    messages: [
                        {
                            role: "system",
                            content: systemPrompt,
                        },
                        {
                            role: "user",
                            content: userPrompt,
                        },
                    ],
                }),
            },
        );

        const rawBody = await response.text();
        if (!response.ok) {
            return null;
        }

        let payload: Record<string, unknown> = {};
        try {
            payload = rawBody ? (JSON.parse(rawBody) as Record<string, unknown>) : {};
        } catch {
            payload = {};
        }

        const choices = Array.isArray(payload.choices)
            ? (payload.choices as Array<Record<string, unknown>>)
            : [];
        const firstChoice = choices[0];
        const message = normalizeRecord(firstChoice?.message);
        const content = message.content;

        if (typeof content !== "string" || !content.trim()) {
            return null;
        }

        let parsed: RemotePlannerResponse = {};
        try {
            parsed = JSON.parse(content) as RemotePlannerResponse;
        } catch {
            return null;
        }

        const summary =
            typeof parsed.summary === "string" && parsed.summary.trim().length > 0
                ? parsed.summary.trim()
                : "Planned operations generated from your request.";

        const rawActions = Array.isArray(parsed.actions) ? parsed.actions : [];
        const actions = this.sanitizePlannedActions(rawActions);
        if (actions.length === 0) {
            return null;
        }

        return {
            summary,
            actions,
        };
    }

    private planWithHeuristics(message: string): PlanResult {
        const lower = message.toLowerCase();
        const actions: PlannedAction[] = [];

        const quotedSegments = message.match(/"([^"]+)"/g) || [];
        const plainQuoted = quotedSegments
            .map((segment) => segment.slice(1, -1).trim())
            .filter((segment) => segment.length > 0);
        const channelMatch = message.match(/\b\d{17,20}\b/);

        const looksLikeSend =
            lower.includes("send") ||
            lower.includes("post message") ||
            lower.includes("say in") ||
            lower.includes("write in");

        if (looksLikeSend && channelMatch) {
            const outgoingText =
                plainQuoted[0] ||
                message
                    .replace(/\b\d{17,20}\b/, "")
                    .replace(/\bsend\b/gi, "")
                    .trim() ||
                "Automated message";

            actions.push(
                this.createPlannedAction({
                    method: "automation.write",
                    operation: "discordjs.function.TextChannel%23send",
                    params: {
                        args: [outgoingText],
                        target: "channel",
                        context: {
                            channelId: channelMatch[0],
                        },
                        dryRun: true,
                        allowWrite: false,
                        policyMode: "strict",
                    },
                    rationale:
                        "Detected a send-message intent with a concrete channel ID.",
                }),
            );
        }

        if (actions.length === 0) {
            const cleanedQuery = message
                .replace(/[^A-Za-z0-9#_. -]/g, " ")
                .replace(/\s+/g, " ")
                .trim()
                .slice(0, 80);

            actions.push(
                this.createPlannedAction({
                    method: "automation.read",
                    operation: "discordjs.meta.symbols",
                    params: {
                        kinds: ["function"],
                        query: cleanedQuery || "TextChannel#send",
                        page: 1,
                        pageSize: 20,
                        includeKindCounts: true,
                    },
                    rationale:
                        "Start with symbol discovery to map user intent to runtime-supported operations.",
                }),
            );
        }

        const summary =
            actions[0].method === "automation.write"
                ? "Prepared a write action in dry-run mode. Review and confirm to execute live."
                : "Prepared a discovery action to identify the best matching discord.js symbols.";

        return {
            summary,
            actions,
        };
    }

    private sanitizePlannedActions(rawActions: unknown[]): PlannedAction[] {
        const actions: PlannedAction[] = [];

        for (const rawAction of rawActions) {
            if (!rawAction || typeof rawAction !== "object") {
                continue;
            }

            const candidate = rawAction as Record<string, unknown>;
            const methodValue =
                typeof candidate.method === "string"
                    ? candidate.method
                    : "automation.read";
            const operationValue =
                typeof candidate.operation === "string"
                    ? candidate.operation
                    : "discordjs.meta.symbols";

            try {
                const method = resolveDomainMethod(methodValue);
                const operation = resolveOperationForMethod(method, operationValue);
                const baseParams = normalizeRecord(candidate.params);

                const params: Record<string, unknown> = {
                    ...baseParams,
                };

                const riskTier = inferRiskTier(method, operation);
                const requiresConfirmation = riskTier === "high";

                if (requiresConfirmation) {
                    params.dryRun = true;
                    params.allowWrite = false;
                    params.policyMode =
                        typeof params.policyMode === "string"
                            ? params.policyMode
                            : "strict";
                }

                actions.push({
                    id: randomUUID(),
                    method,
                    operation,
                    params,
                    rationale:
                        typeof candidate.rationale === "string" &&
                        candidate.rationale.trim().length > 0
                            ? candidate.rationale.trim()
                            : "Generated automatically from model output.",
                    riskTier,
                    requiresConfirmation,
                });
            } catch {
                continue;
            }

            if (actions.length >= this.plannerConfig.maxActions) {
                break;
            }
        }

        return actions;
    }

    private createPlannedAction(input: {
        method: DomainMethod;
        operation: DiscordOperation;
        params: Record<string, unknown>;
        rationale: string;
    }): PlannedAction {
        const method = resolveDomainMethod(input.method);
        const operation = resolveOperationForMethod(method, input.operation);
        const riskTier = inferRiskTier(method, operation);
        const requiresConfirmation = riskTier === "high";

        const params = {
            ...input.params,
        };

        if (requiresConfirmation) {
            params.dryRun = true;
            params.allowWrite = false;
            params.policyMode =
                typeof params.policyMode === "string" ? params.policyMode : "strict";
        }

        return {
            id: randomUUID(),
            method,
            operation,
            params,
            rationale: input.rationale,
            riskTier,
            requiresConfirmation,
        };
    }

    private pruneExpiredEntries(nowEpochMs: number): boolean {
        let changed = false;

        for (const [sessionId, session] of Object.entries(this.state.sessions)) {
            if (Date.parse(session.expiresAt) <= nowEpochMs) {
                delete this.state.sessions[sessionId];
                changed = true;
            }
        }

        for (const [state, record] of Object.entries(this.state.oidcStates)) {
            if (Date.parse(record.expiresAt) <= nowEpochMs) {
                delete this.state.oidcStates[state];
                changed = true;
            }
        }

        const validSessionIds = new Set(Object.keys(this.state.sessions));
        for (const [threadId, thread] of Object.entries(this.state.threads)) {
            if (!validSessionIds.has(thread.sessionId)) {
                delete this.state.threads[threadId];
                delete this.state.messages[threadId];
                changed = true;
            }
        }

        return changed;
    }

    private async loadStateIfNeeded(): Promise<void> {
        if (this.loaded) {
            return;
        }

        this.loaded = true;

        try {
            const rawBody = await readFile(this.statePath, "utf8");
            const parsed = JSON.parse(rawBody) as Partial<StoredWebUiState>;
            this.state = {
                sessions: normalizeRecord(parsed.sessions) as Record<
                    string,
                    StoredSessionRecord
                >,
                oidcStates: normalizeRecord(parsed.oidcStates) as Record<
                    string,
                    StoredOidcStateRecord
                >,
                threads: normalizeRecord(parsed.threads) as Record<
                    string,
                    ChatThreadRecord
                >,
                messages: normalizeMessages(parsed.messages),
            };
        } catch (error) {
            const nodeError = error as NodeJS.ErrnoException;
            if (nodeError.code === "ENOENT") {
                this.state = createDefaultState();
                return;
            }

            if (nodeError.name === "SyntaxError") {
                const backupPath = `${this.statePath}.corrupt-${Date.now()}`;
                try {
                    await rename(this.statePath, backupPath);
                } catch {
                    // Keep service available even if backup rename fails.
                }
                this.state = createDefaultState();
                return;
            }

            throw error;
        }

        if (this.pruneExpiredEntries(Date.now())) {
            await this.persistState();
        }
    }

    private async persistState(): Promise<void> {
        await mkdir(dirname(this.statePath), { recursive: true });
        const tempPath = `${this.statePath}.tmp-${process.pid}-${Date.now()}`;
        const body = JSON.stringify(this.state, null, 2);
        await writeFile(tempPath, body, "utf8");
        await rename(tempPath, this.statePath);
    }
}
