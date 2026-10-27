import { Agent, request } from "undici";
import type { IdentityMode } from "../identity/local-encrypted-identity-store.js";
import type { IdentityRecord, IdentitySource } from "../identity/identity-source.js";
import { placeholderToken, type AgentIdentity } from "./agent-server.js";

// Talks to a running discord-mcp agent over its Unix socket (the
// DISCORD_MCP_AGENT_SOCK of SSH_AUTH_SOCK fame).

const AGENT_ORIGIN = "http://discord-mcp-agent";

export class AgentClient {
    readonly dispatcher: Agent;
    // Discord REST base for discord.js: requests go to the agent, which adds
    // the real Authorization header and forwards them to Discord.
    readonly restApi = `${AGENT_ORIGIN}/rest`;

    constructor(readonly socketPath: string) {
        this.dispatcher = new Agent({ connect: { socketPath } });
    }

    async identities(): Promise<Array<{ id: string; mode: IdentityMode }>> {
        return (await this.call("GET", "/identities")) as Array<{ id: string; mode: IdentityMode }>;
    }

    async addIdentity(identity: AgentIdentity): Promise<void> {
        await this.call("POST", "/identities", identity);
    }

    async removeIdentity(id: string): Promise<boolean> {
        const result = (await this.call("DELETE", `/identities/${encodeURIComponent(id)}`, undefined, [404])) as {
            removed: boolean;
        };
        return result.removed;
    }

    async close(): Promise<void> {
        await this.dispatcher.close();
    }

    private async call(method: "GET" | "POST" | "DELETE", path: string, body?: unknown, okStatuses: number[] = []) {
        let response;
        try {
            response = await request(`${AGENT_ORIGIN}${path}`, {
                method,
                dispatcher: this.dispatcher,
                headers: body ? { "content-type": "application/json" } : undefined,
                body: body ? JSON.stringify(body) : undefined,
            });
        } catch (error) {
            throw new Error(`Could not reach the discord-mcp agent at ${this.socketPath}.`, { cause: error });
        }
        const payload = (await response.body.json()) as unknown;
        if (response.statusCode >= 300 && !okStatuses.includes(response.statusCode)) {
            throw new Error(`Agent request ${method} ${path} failed (${response.statusCode}).`);
        }
        return payload;
    }
}

// Identities as the server sees them in agent mode: names and modes, with a
// placeholder where the token would be.
export class AgentIdentityStore implements IdentitySource {
    readonly managedByAgent = true;
    private records = new Map<string, IdentityRecord>();

    constructor(private readonly client: AgentClient) {}

    async refresh(): Promise<void> {
        const identities = await this.client.identities();
        this.records = new Map(
            identities.map(({ id, mode }) => [id, { id, mode, token: placeholderToken(id) }]),
        );
    }

    getIdentity(id: string): IdentityRecord | undefined {
        return this.records.get(id);
    }

    listIdentityIds(): string[] {
        return Array.from(this.records.keys()).sort();
    }

    upsertIdentity(): void {
        throw new Error(
            "Identities are held by the discord-mcp agent. Add one with `discord-mcp identity add <id>`; the token never passes through this server.",
        );
    }
}
