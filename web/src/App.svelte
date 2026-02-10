<script lang="ts">
    import { onMount } from "svelte";
    import { api } from "./lib/api";

    type Mode = "bot" | "user";

    type SessionData = {
        sessionId: string;
        subject: string;
        name?: string;
        email?: string;
        defaultMode: Mode;
        rememberMode: boolean;
        createdAt: string;
        expiresAt: string;
    };

    type Thread = {
        id: string;
        title: string;
        createdAt: string;
        updatedAt: string;
    };

    type ChatMessage = {
        id: string;
        threadId: string;
        role: "user" | "assistant" | "system";
        content: string;
        createdAt: string;
        metadata?: Record<string, unknown>;
    };

    type PlannedAction = {
        id: string;
        method: string;
        operation: string;
        params: Record<string, unknown>;
        rationale: string;
        riskTier: "low" | "medium" | "high";
        requiresConfirmation: boolean;
    };

    type PlanResult = {
        summary: string;
        actions: PlannedAction[];
    };

    let booting = true;
    let isAuthenticated = false;
    let session: SessionData | null = null;
    let oidcConfigured = false;
    let missingOidcFields: string[] = [];

    let threads: Thread[] = [];
    let activeThreadId = "";
    let messages: ChatMessage[] = [];

    let mode: Mode = "bot";
    let rememberMode = false;
    let identityId = "default-bot";

    let composer = "";
    let pendingPlan: PlanResult | null = null;
    let confirmWrites = false;

    let loadingThreads = false;
    let loadingMessages = false;
    let planning = false;
    let executing = false;
    let creatingThread = false;
    let uiError = "";
    let authError = "";

    function modeDefaultIdentity(nextMode: Mode): string {
        return nextMode === "bot" ? "default-bot" : "default-user";
    }

    function formatTimestamp(value: string): string {
        const date = new Date(value);
        return date.toLocaleString();
    }

    async function initialize(): Promise<void> {
        try {
            const params = new URLSearchParams(window.location.search);
            const authErrorParam = params.get("authError");
            if (authErrorParam) {
                authError = authErrorParam;
                params.delete("authError");
                const nextQuery = params.toString();
                const nextUrl =
                    window.location.pathname +
                    (nextQuery.length > 0 ? `?${nextQuery}` : "");
                window.history.replaceState({}, "", nextUrl);
            }

            await loadSession();
            if (isAuthenticated) {
                await loadThreads(true);
            }
        } catch (error) {
            uiError =
                error instanceof Error
                    ? error.message
                    : "Failed to initialize web console";
        } finally {
            booting = false;
        }
    }

    async function loadSession(): Promise<void> {
        uiError = "";
        let payload: {
            authenticated?: boolean;
            session?: SessionData;
            oidcConfigured?: boolean;
            missingOidcFields?: string[];
            error?: string;
        } = {};

        try {
            const response = await api.api.session.$get();
            try {
                payload = (await response.json()) as typeof payload;
            } catch {
                payload = {};
            }

            if (!response.ok && payload.error) {
                uiError = payload.error;
            }
        } catch (error) {
            uiError =
                error instanceof Error
                    ? error.message
                    : "Failed to contact server session endpoint";
        }

        oidcConfigured = Boolean(payload.oidcConfigured);
        missingOidcFields = payload.missingOidcFields || [];

        if (!payload.authenticated || !payload.session) {
            isAuthenticated = false;
            session = null;
            return;
        }

        isAuthenticated = true;
        session = payload.session;
        mode = session.defaultMode;
        rememberMode = session.rememberMode;
        identityId = modeDefaultIdentity(mode);
    }

    async function applySessionIdentityPreference(): Promise<void> {
        if (!isAuthenticated || !session) {
            return;
        }

        const response = await api.api.session.identity.$post({
            json: {
                mode,
                rememberMode,
            },
        });

        if (!response.ok) {
            const payload = (await response.json()) as { error?: string };
            uiError = payload.error || "Failed to update session preference";
            return;
        }

        const payload = (await response.json()) as { session: SessionData };
        session = payload.session;
    }

    async function loadThreads(selectFirst: boolean): Promise<void> {
        if (!isAuthenticated) {
            return;
        }

        loadingThreads = true;
        uiError = "";
        try {
            const response = await api.api.chat.threads.$get();
            const payload = (await response.json()) as {
                threads?: Thread[];
                error?: string;
            };

            if (!response.ok) {
                uiError = payload.error || "Failed to load threads";
                return;
            }

            threads = payload.threads || [];
            if (selectFirst && threads.length > 0) {
                activeThreadId = threads[0].id;
                await loadMessages(activeThreadId);
            }
        } finally {
            loadingThreads = false;
        }
    }

    async function loadMessages(threadId: string): Promise<void> {
        if (!threadId) {
            messages = [];
            return;
        }

        loadingMessages = true;
        uiError = "";
        try {
            const response = await api.api.chat.threads[":threadId"].messages.$get({
                param: { threadId },
            });
            const payload = (await response.json()) as {
                messages?: ChatMessage[];
                error?: string;
            };

            if (!response.ok) {
                uiError = payload.error || "Failed to load messages";
                return;
            }

            messages = payload.messages || [];
        } finally {
            loadingMessages = false;
        }
    }

    async function openThread(threadId: string): Promise<void> {
        activeThreadId = threadId;
        pendingPlan = null;
        await loadMessages(threadId);
    }

    async function createThread(): Promise<void> {
        if (!isAuthenticated) {
            return;
        }

        creatingThread = true;
        uiError = "";
        try {
            const response = await api.api.chat.threads.$post({
                json: {},
            });
            const payload = (await response.json()) as {
                thread?: Thread;
                error?: string;
            };

            if (!response.ok || !payload.thread) {
                uiError = payload.error || "Failed to create thread";
                return;
            }

            threads = [payload.thread, ...threads];
            activeThreadId = payload.thread.id;
            messages = [];
            pendingPlan = null;
        } finally {
            creatingThread = false;
        }
    }

    async function sendPrompt(): Promise<void> {
        if (!isAuthenticated || !session || planning || executing) {
            return;
        }

        const message = composer.trim();
        if (!message) {
            return;
        }

        planning = true;
        uiError = "";
        authError = "";

        try {
            const response = await api.api.chat.plan.$post({
                json: {
                    threadId: activeThreadId || undefined,
                    message,
                    mode,
                    identityId,
                    rememberMode,
                },
            });

            const payload = (await response.json()) as {
                thread?: Thread;
                plan?: PlanResult;
                error?: string;
            };

            if (!response.ok || !payload.thread || !payload.plan) {
                uiError = payload.error || "Failed to plan message";
                return;
            }

            composer = "";
            pendingPlan = payload.plan;
            await loadThreads(false);
            activeThreadId = payload.thread.id;
            await loadMessages(payload.thread.id);

            if (session.defaultMode !== mode || session.rememberMode !== rememberMode) {
                await applySessionIdentityPreference();
            }
        } finally {
            planning = false;
        }
    }

    async function executePlan(confirm: boolean): Promise<void> {
        if (!isAuthenticated || !session || !pendingPlan || executing) {
            return;
        }

        if (!activeThreadId) {
            uiError = "No active thread selected";
            return;
        }

        executing = true;
        uiError = "";

        try {
            const response = await api.api.chat.execute.$post({
                json: {
                    threadId: activeThreadId,
                    mode,
                    identityId,
                    confirmWrites: confirm,
                    actions: pendingPlan.actions,
                },
            });

            const payload = (await response.json()) as { error?: string };
            if (!response.ok) {
                uiError = payload.error || "Failed to execute plan";
                return;
            }

            pendingPlan = null;
            await loadMessages(activeThreadId);
            await loadThreads(false);
        } finally {
            executing = false;
        }
    }

    async function logout(): Promise<void> {
        await api.api.session.logout.$post();
        isAuthenticated = false;
        session = null;
        threads = [];
        messages = [];
        pendingPlan = null;
        activeThreadId = "";
        composer = "";
    }

    function startOidcLogin(): void {
        window.location.href = `/auth/codex/start?returnTo=${encodeURIComponent("/app/")}`;
    }

    function onModeChange(nextMode: Mode): void {
        mode = nextMode;
        if (identityId === "default-bot" || identityId === "default-user") {
            identityId = modeDefaultIdentity(nextMode);
        }
    }

    function onModeSelectChange(event: Event): void {
        const target = event.currentTarget;
        if (!(target instanceof HTMLSelectElement)) {
            return;
        }
        onModeChange(target.value === "user" ? "user" : "bot");
    }

    onMount(() => {
        void initialize();
    });
</script>

{#if booting}
    <main class="boot-screen">
        <div class="boot-card">Loading web console...</div>
    </main>
{:else if !isAuthenticated}
    <main class="auth-screen">
        <section class="auth-card">
            <h1>Discord MCP Web Console</h1>
            <p>
                Sign in with your Codex-style OAuth bridge, then plan and run
                dynamic <code>discordjs.*</code> operations with dry-run safeguards.
            </p>

            {#if authError}
                <div class="error-banner">{authError}</div>
            {/if}

            {#if !oidcConfigured}
                <div class="warning-banner">
                    OIDC is not configured.
                    {#if missingOidcFields.length > 0}
                        <ul>
                            {#each missingOidcFields as field}
                                <li>{field}</li>
                            {/each}
                        </ul>
                    {/if}
                </div>
            {/if}

            <button class="primary" on:click={startOidcLogin} disabled={!oidcConfigured}>
                Sign In (Codex-Style)
            </button>
        </section>
    </main>
{:else}
    <main class="workspace">
        <header class="topbar">
            <div>
                <h1>Discord MCP Web Console</h1>
                <p>
                    Signed in as <strong>{session?.name || session?.email || session?.subject}</strong>
                </p>
            </div>
            <button class="ghost" on:click={logout}>Logout</button>
        </header>

        <section class="controls">
            <label>
                Mode
                <select bind:value={mode} on:change={onModeSelectChange}>
                    <option value="bot">bot</option>
                    <option value="user">user</option>
                </select>
            </label>
            <label>
                Identity ID
                <input bind:value={identityId} />
            </label>
            <label class="remember">
                <input type="checkbox" bind:checked={rememberMode} />
                Remember mode for this session
            </label>
            <button class="ghost" on:click={applySessionIdentityPreference}>
                Save Session Preference
            </button>
        </section>

        {#if uiError}
            <div class="error-banner">{uiError}</div>
        {/if}

        <section class="layout">
            <aside class="threads-panel">
                <div class="panel-header">
                    <h2>Threads</h2>
                    <button class="ghost" on:click={createThread} disabled={creatingThread}>
                        {creatingThread ? "Creating..." : "New"}
                    </button>
                </div>
                {#if loadingThreads}
                    <p class="muted">Loading threads...</p>
                {:else if threads.length === 0}
                    <p class="muted">No threads yet.</p>
                {:else}
                    <ul>
                        {#each threads as thread}
                            <li>
                                <button
                                    class:active={thread.id === activeThreadId}
                                    on:click={() => openThread(thread.id)}
                                >
                                    <span>{thread.title}</span>
                                    <small>{formatTimestamp(thread.updatedAt)}</small>
                                </button>
                            </li>
                        {/each}
                    </ul>
                {/if}
            </aside>

            <section class="chat-panel">
                <div class="panel-header">
                    <h2>Conversation</h2>
                    <span class="muted">{activeThreadId ? activeThreadId : "No active thread"}</span>
                </div>

                <div class="messages">
                    {#if loadingMessages}
                        <p class="muted">Loading messages...</p>
                    {:else if messages.length === 0}
                        <p class="muted">No messages yet. Send a prompt to start.</p>
                    {:else}
                        {#each messages as message}
                            <article class={`message ${message.role}`}>
                                <header>
                                    <strong>{message.role}</strong>
                                    <time>{formatTimestamp(message.createdAt)}</time>
                                </header>
                                <pre>{message.content}</pre>
                            </article>
                        {/each}
                    {/if}
                </div>

                <form
                    class="composer"
                    on:submit|preventDefault={sendPrompt}
                >
                    <textarea
                        bind:value={composer}
                        placeholder="Describe what you want the bot to do..."
                        rows="4"
                    />
                    <button class="primary" type="submit" disabled={planning || executing}>
                        {planning ? "Planning..." : "Plan"}
                    </button>
                </form>
            </section>

            <aside class="plan-panel">
                <div class="panel-header">
                    <h2>Planned Actions</h2>
                </div>

                {#if !pendingPlan}
                    <p class="muted">No pending plan.</p>
                {:else}
                    <p>{pendingPlan.summary}</p>
                    <pre>{JSON.stringify(pendingPlan.actions, null, 2)}</pre>
                    <label class="remember">
                        <input type="checkbox" bind:checked={confirmWrites} />
                        Confirm writes (disable dry-run)
                    </label>
                    <div class="plan-actions">
                        <button
                            class="primary"
                            on:click={() => executePlan(confirmWrites)}
                            disabled={executing}
                        >
                            {executing
                                ? "Executing..."
                                : confirmWrites
                                ? "Execute Live"
                                : "Execute Dry Run"}
                        </button>
                        <button class="ghost" on:click={() => (pendingPlan = null)}>
                            Clear
                        </button>
                    </div>
                {/if}
            </aside>
        </section>
    </main>
{/if}
