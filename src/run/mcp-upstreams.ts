import { existsSync, readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import {
    getDefaultEnvironment,
    StdioClientTransport,
} from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { LatencyStats, LatencyTracker } from "../net/latency.js";
import {
    assertEncryptedUpstream,
    createFetch,
    redactUrl,
    type NetworkConfig,
} from "../net/network.js";

// MCP-as-code: other MCP servers' tools become plain async functions in the
// run tool's namespace (`mcp.<server>.<tool>(args)`) instead of being
// re-advertised as tools. The model composes them in code, keeps helpers that
// wrap them, and only the values it chooses to print reach its context.

export type UpstreamConfig = {
    type?: "stdio" | "http" | "sse" | "streamable-http";
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    cwd?: string;
    url?: string;
    headers?: Record<string, string>;
};

export type UpstreamStatus = {
    name: string;
    transport: "stdio" | "http" | "sse";
    connected: boolean;
    tools: string[];
    url?: string;
    latency?: LatencyStats;
    error?: string;
};

export type UpstreamToolInfo = {
    signature: string;
    doc?: string;
    server: string;
    tool: string;
    inputSchema?: unknown;
};

type JsonSchema = {
    type?: string | string[];
    enum?: unknown[];
    const?: unknown;
    items?: JsonSchema;
    properties?: Record<string, JsonSchema>;
    required?: string[];
    anyOf?: JsonSchema[];
    oneOf?: JsonSchema[];
    description?: string;
};

type UpstreamEntry = {
    config: UpstreamConfig;
    status: UpstreamStatus;
    client?: Client;
};

type ToolCallResult = {
    content?: Array<{ type: string; text?: string } & Record<string, unknown>>;
    structuredContent?: unknown;
    isError?: boolean;
};

const CONNECT_TIMEOUT_MS = 20_000;

// `${VAR}` in config strings is read from the server's environment, so
// secrets stay out of the config itself.
function expandEnv(value: string): string {
    return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, name: string) =>
        process.env[name] ?? "",
    );
}

function expandRecord(
    record: Record<string, string> | undefined,
): Record<string, string> | undefined {
    if (!record) {
        return undefined;
    }
    return Object.fromEntries(
        Object.entries(record).map(([key, value]) => [key, expandEnv(String(value))]),
    );
}

export function toIdentifier(name: string): string {
    const cleaned = name.replace(/[^A-Za-z0-9_$]/g, "_");
    return /^[0-9]/.test(cleaned) ? `_${cleaned}` : cleaned || "_";
}

function schemaType(schema: JsonSchema | undefined): string {
    if (!schema) {
        return "any";
    }
    if (schema.const !== undefined) {
        return JSON.stringify(schema.const);
    }
    if (schema.enum) {
        return schema.enum.map((entry) => JSON.stringify(entry)).join(" | ");
    }
    const variants = schema.anyOf || schema.oneOf;
    if (variants) {
        return variants.map(schemaType).join(" | ");
    }
    const type = Array.isArray(schema.type) ? schema.type : [schema.type];
    return type
        .map((entry) => {
            switch (entry) {
                case "integer":
                    return "number";
                case "array":
                    return `${schemaType(schema.items)}[]`;
                case undefined:
                    return "any";
                default:
                    return entry;
            }
        })
        .join(" | ");
}

export function signatureFromSchema(name: string, schema: unknown): string {
    const objectSchema = (schema || {}) as JsonSchema;
    const properties = Object.entries(objectSchema.properties || {});
    if (properties.length === 0) {
        return `${name}()`;
    }
    const required = new Set(objectSchema.required || []);
    const fields = properties.map(
        ([key, value]) =>
            `${toIdentifier(key) === key ? key : JSON.stringify(key)}${required.has(key) ? "" : "?"}: ${schemaType(value)}`,
    );
    return `${name}({ ${fields.join(", ")} })`;
}

// Structured content when the tool provides it, otherwise its text (parsed as
// JSON when it is JSON). Tool-level errors become thrown exceptions.
export function unwrapToolResult(label: string, result: ToolCallResult): unknown {
    const content = result.content || [];
    const texts = content
        .filter((item) => item.type === "text" && typeof item.text === "string")
        .map((item) => item.text as string);

    if (result.isError) {
        throw new Error(`${label} failed: ${texts.join("\n") || "tool reported an error"}`);
    }
    if (result.structuredContent !== undefined) {
        return result.structuredContent;
    }
    if (texts.length !== content.length) {
        return content;
    }
    const text = texts.join("\n");
    const trimmed = text.trim();
    if (/^[[{]/.test(trimmed)) {
        try {
            return JSON.parse(trimmed) as unknown;
        } catch {
            return text;
        }
    }
    return text;
}

// Reads DISCORD_MCP_UPSTREAMS: inline JSON or a path to a JSON file, in the
// common `{ "mcpServers": { name: config } }` shape or a bare name->config map.
export function loadUpstreamConfigs(
    raw: string | undefined = process.env.DISCORD_MCP_UPSTREAMS,
): Record<string, UpstreamConfig> {
    if (!raw || !raw.trim()) {
        return {};
    }
    const trimmed = raw.trim();
    let text = trimmed;
    if (!trimmed.startsWith("{")) {
        if (!existsSync(trimmed)) {
            throw new Error(`DISCORD_MCP_UPSTREAMS file not found: ${trimmed}`);
        }
        text = readFileSync(trimmed, "utf8");
    }
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const servers = (
        parsed.mcpServers && typeof parsed.mcpServers === "object"
            ? parsed.mcpServers
            : parsed
    ) as Record<string, UpstreamConfig>;
    return servers;
}

export class McpUpstreams {
    // The `mcp` object seeded into the namespace: server -> tool -> function.
    readonly namespace: Record<string, Record<string, Function>> = {};
    private readonly entries = new Map<string, UpstreamEntry>();
    private readonly info = new WeakMap<Function, UpstreamToolInfo>();
    private pending: Promise<unknown> = Promise.resolve();

    constructor(
        private readonly options: {
            onError?: (name: string, error: unknown) => void;
            clientName?: string;
            network?: NetworkConfig;
            latency?: LatencyTracker;
        } = {},
    ) {}

    // Starts connecting to every configured server without blocking; ready()
    // resolves once all attempts have finished (failures are recorded).
    connectAll(configs: Record<string, UpstreamConfig>): Promise<unknown> {
        this.pending = Promise.allSettled(
            Object.entries(configs).map(([name, config]) =>
                this.connect(name, config).catch(() => undefined),
            ),
        );
        return this.pending;
    }

    ready(): Promise<unknown> {
        return this.pending;
    }

    list(): UpstreamStatus[] {
        return Array.from(this.entries.values()).map((entry) => {
            const latency = this.options.latency?.stats("mcp", entry.status.name);
            return {
                ...entry.status,
                tools: [...entry.status.tools],
                ...(latency ? { latency } : {}),
            };
        });
    }

    functionInfo(fn: Function): UpstreamToolInfo | undefined {
        return this.info.get(fn);
    }

    async connect(name: string, config: UpstreamConfig): Promise<UpstreamStatus> {
        const key = toIdentifier(name);
        if (this.entries.has(key)) {
            await this.disconnect(key);
        }
        const transportKind: UpstreamStatus["transport"] =
            config.command || config.type === "stdio"
                ? "stdio"
                : config.type === "sse"
                  ? "sse"
                  : "http";
        const entry: UpstreamEntry = {
            config,
            status: { name: key, transport: transportKind, connected: false, tools: [] },
        };
        this.entries.set(key, entry);

        try {
            entry.client = await this.openClient(config, entry.status);
            await this.loadTools(key, entry);
            entry.status.connected = true;
            delete entry.status.error;
        } catch (error) {
            entry.status.error = error instanceof Error ? error.message : String(error);
            this.options.onError?.(key, error);
            throw new Error(`Could not connect MCP server '${key}': ${entry.status.error}`, {
                cause: error,
            });
        }
        return { ...entry.status, tools: [...entry.status.tools] };
    }

    async refresh(name: string): Promise<UpstreamStatus> {
        const entry = this.entries.get(name);
        if (!entry?.client) {
            throw new Error(`MCP server '${name}' is not connected.`);
        }
        await this.loadTools(name, entry);
        return { ...entry.status, tools: [...entry.status.tools] };
    }

    async disconnect(name: string): Promise<boolean> {
        const entry = this.entries.get(name);
        if (!entry) {
            return false;
        }
        this.entries.delete(name);
        delete this.namespace[name];
        await entry.client?.close().catch(() => undefined);
        return true;
    }

    async closeAll(): Promise<void> {
        await Promise.allSettled(
            Array.from(this.entries.keys()).map((name) => this.disconnect(name)),
        );
    }

    private async openClient(
        config: UpstreamConfig,
        status: UpstreamStatus,
    ): Promise<Client> {
        const attempt = async (
            transport: Parameters<Client["connect"]>[0],
        ): Promise<Client> => {
            const client = new Client({
                name: this.options.clientName || "discord-mcp-run",
                version: "0.0.1",
            });
            await client.connect(transport, { timeout: CONNECT_TIMEOUT_MS });
            return client;
        };

        if (status.transport === "stdio") {
            if (!config.command) {
                throw new Error("A stdio MCP server needs 'command'.");
            }
            return attempt(
                new StdioClientTransport({
                    command: expandEnv(config.command),
                    args: (config.args || []).map(expandEnv),
                    env: { ...getDefaultEnvironment(), ...expandRecord(config.env) },
                    cwd: config.cwd,
                }),
            );
        }

        if (!config.url) {
            throw new Error("An HTTP MCP server needs 'url' (or 'command' for stdio).");
        }
        const url = new URL(expandEnv(config.url));
        const network = this.options.network || { tlsVerification: true };
        assertEncryptedUpstream(url, network);
        status.url = redactUrl(url);
        const requestInit = { headers: expandRecord(config.headers) };
        const fetch = createFetch(network);

        if (status.transport === "sse") {
            return attempt(new SSEClientTransport(url, { requestInit, fetch }));
        }
        try {
            return await attempt(
                new StreamableHTTPClientTransport(url, { requestInit, fetch }),
            );
        } catch (error) {
            if (config.type === "http" || config.type === "streamable-http") {
                throw error;
            }
            // Older servers only speak the HTTP+SSE transport.
            const client = await attempt(
                new SSEClientTransport(url, { requestInit, fetch }),
            );
            status.transport = "sse";
            return client;
        }
    }

    private async loadTools(name: string, entry: UpstreamEntry): Promise<void> {
        const client = entry.client as Client;
        const tools: Array<{ name: string; description?: string; inputSchema?: unknown }> = [];
        let cursor: string | undefined;
        do {
            const page = await client.listTools(cursor ? { cursor } : undefined);
            tools.push(...page.tools);
            cursor = page.nextCursor;
        } while (cursor);

        const functions: Record<string, Function> = {};
        for (const tool of tools) {
            let identifier = toIdentifier(tool.name);
            while (identifier in functions) {
                identifier = `${identifier}_`;
            }
            const label = `mcp.${name}.${identifier}`;
            const call = async (args: Record<string, unknown> = {}) => {
                const callTool = () =>
                    client.callTool({
                        name: tool.name,
                        arguments: args,
                    }) as Promise<ToolCallResult>;
                const latency = this.options.latency;
                const result = latency
                    ? await latency.time("mcp", name, callTool, (r) => !r.isError)
                    : await callTool();
                return unwrapToolResult(label, result);
            };
            this.info.set(call, {
                signature: signatureFromSchema(identifier, tool.inputSchema),
                doc: tool.description?.split("\n").find((line) => line.trim())?.trim(),
                server: name,
                tool: tool.name,
                inputSchema: tool.inputSchema,
            });
            functions[identifier] = call;
        }

        this.namespace[name] = functions;
        entry.status.tools = Object.keys(functions);
    }
}
