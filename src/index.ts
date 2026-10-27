import "dotenv/config";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { serve } from "@hono/node-server";
import { DiscordService } from "./discord-service.js";
import { DiscordController } from "./core/DiscordController.js";
import { Logger } from "./core/Logger.js";
import { OAuthManager } from "./core/OAuthManager.js";
import { AppErrorCode, toPublicErrorPayload } from "./core/errors.js";
import { writeAuditEvent } from "./gateway/audit-log.js";
import { bindDiscordOperationsService } from "./gateway/discord-operations.js";
import { listLoadedDiscordRuntimePackages } from "./gateway/discordjs-symbol-catalog.js";
import { createHttpApp } from "./http-app.js";
import { IdentityWorkerPool } from "./gateway/identity-worker-pool.js";
import { LocalEncryptedIdentityStore } from "./identity/local-encrypted-identity-store.js";
import {
    recordRequestMetric,
    withSpan,
} from "./observability/telemetry.js";
import {
    adoptStartupIdentity,
    createDiscordHarness,
    DISCORD_NAMESPACE_MANUAL,
} from "./run/discord-namespace.js";
import { loadUpstreamConfigs, McpUpstreams } from "./run/mcp-upstreams.js";
import { LatencyTracker } from "./net/latency.js";
import { loadNetworkConfig, redactUrl, type NetworkConfig } from "./net/network.js";
import {
    listTools,
    parseRunArguments,
    RUN_TOOL_NAME,
    toToolResult,
} from "./run/run-tool.js";

const server = new Server(
    {
        name: "discord-mcp-server",
        version: "0.0.1",
    },
    {
        capabilities: {
            tools: {},
        },
        instructions: `This server exposes exactly one tool, \`${RUN_TOOL_NAME}\`, which runs JavaScript with the server's full authority in a persistent namespace. Run the server sandboxed. Call it with empty code for the manual.\n\n${DISCORD_NAMESPACE_MANUAL}`,
    },
);

let discordService: DiscordService | undefined;
let discordController: DiscordController;
let oauthManager: OAuthManager | null = null;
const identityStore = new LocalEncryptedIdentityStore();
const identityWorkerPool = new IdentityWorkerPool();
const logger = Logger.getInstance().child("server");

// An invalid proxy setting stops the server: falling back to direct
// connections would send traffic around the proxy the operator asked for.
let network: NetworkConfig;
try {
    network = loadNetworkConfig();
} catch (error) {
    logger.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
}
const latency = new LatencyTracker();

const upstreams = new McpUpstreams({
    network,
    latency,
    onError: (name, error) =>
        logger.warn(`Upstream MCP server '${name}' unavailable`, error),
});

const discordHarness = createDiscordHarness({
    getService: () => discordService,
    identityStore,
    upstreams,
    network,
    latency,
    onLoadError: (name, error) =>
        logger.warn(`Kept definition '${name}' failed to load`, error),
});

function getOAuthManager(): OAuthManager {
    if (!oauthManager) {
        throw new Error("OAuth manager is not initialized.");
    }
    return oauthManager;
}

function parseBooleanQuery(value: string | null): boolean | undefined {
    if (value === null) {
        return undefined;
    }

    const normalized = value.toLowerCase();
    if (normalized === "true" || normalized === "1" || normalized === "yes") {
        return true;
    }
    if (normalized === "false" || normalized === "0" || normalized === "no") {
        return false;
    }
    return undefined;
}

async function initializeDiscord() {
    discordController = new DiscordController({
        dispatcher: network.dispatcher,
        latency,
    });
    try {
        await discordController.initialize();
    } catch (error) {
        // The run tool can still log in later via connect()/bind().
        logger.warn(
            `Discord login at startup failed: ${error instanceof Error ? error.message : String(error)}`,
        );
    }
    discordService = discordController.getDiscordService();
    bindDiscordOperationsService(discordService);
}

// Runs one `run` tool call. Calls are serialized: they share one namespace and
// one Discord client.
async function callTool(name: unknown, rawArgs: unknown) {
    const startedAt = Date.now();
    let args: ReturnType<typeof parseRunArguments>;
    try {
        args = parseRunArguments(name, rawArgs);
    } catch (error) {
        const payload = toPublicErrorPayload(error, AppErrorCode.Internal);
        return {
            content: [
                { type: "text" as const, text: `Error [${payload.code}]: ${payload.message}` },
            ],
            isError: true,
        };
    }

    const result = await identityWorkerPool.run(RUN_TOOL_NAME, () =>
        discordHarness.run(args.code, {
            identity: args.identity,
            vars: args.vars,
        }),
    );

    const bound = discordHarness.bound();
    writeAuditEvent({
        identityId: bound?.id || "none",
        mode: bound?.mode || "bot",
        method: RUN_TOOL_NAME,
        operation: RUN_TOOL_NAME,
        riskTier: "high",
        status: result.ok ? "success" : "error",
        durationMs: Date.now() - startedAt,
        ...(result.ok ? {} : { error: result.error }),
    });

    return toToolResult(result);
}

server.setRequestHandler(ListToolsRequestSchema, async () => {
    const startedAt = Date.now();
    let status: "success" | "error" = "success";
    try {
        return await withSpan(
            "mcp.tools.list",
            { "mcp.transport": "stdio" },
            async () => ({
                tools: listTools(),
            }),
        );
    } catch (error) {
        status = "error";
        throw error;
    } finally {
        recordRequestMetric(
            {
                "mcp.transport": "stdio",
                "mcp.method": "tools/list",
                "mcp.status": status,
            },
            Date.now() - startedAt,
        );
    }
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const startedAt = Date.now();
    let status: "success" | "error" = "success";
    try {
        const result = await withSpan(
            "mcp.tools.call",
            {
                "mcp.transport": "stdio",
                "mcp.tool_name":
                    typeof request.params.name === "string"
                        ? request.params.name
                        : "unknown",
            },
            () => callTool(request.params.name, request.params.arguments),
        );
        if (result.isError) {
            status = "error";
        }
        return result;
    } catch (error) {
        status = "error";
        const payload = toPublicErrorPayload(error, AppErrorCode.Internal);
        return {
            content: [
                {
                    type: "text",
                    text: `Error [${payload.code}]: ${payload.message}`,
                },
            ],
            isError: true,
        };
    } finally {
        recordRequestMetric(
            {
                "mcp.transport": "stdio",
                "mcp.method": "tools/call",
                "mcp.status": status,
            },
            Date.now() - startedAt,
        );
    }
});

async function main() {
    try {
        try {
            const upstreamConfigs = loadUpstreamConfigs();
            const names = Object.keys(upstreamConfigs);
            if (names.length > 0) {
                logger.info(`Connecting upstream MCP servers as functions: ${names.join(", ")}`);
                void upstreams.connectAll(upstreamConfigs);
            }
        } catch (error) {
            logger.warn(
                `DISCORD_MCP_UPSTREAMS ignored: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
        if (network.proxyUrl) {
            logger.info(
                `Routing Discord REST, upstream MCP (http) and run-tool fetch through proxy ${redactUrl(network.proxyUrl)}; the Discord gateway WebSocket connects directly.`,
            );
        }
        if (!network.tlsVerification) {
            logger.warn(
                "NODE_TLS_REJECT_UNAUTHORIZED=0 disables certificate verification; upstream MCP servers over https will be refused.",
            );
        }
        await initializeDiscord();
        identityStore.ensureDefaultsFromEnv();
        if (discordService) {
            await adoptStartupIdentity(discordHarness, discordService, identityStore);
        }
        logger.info(
            `run tool namespace ready; kept definitions: ${discordHarness.harness.persistDir}`,
        );
        const runtimePackages = await listLoadedDiscordRuntimePackages();
        logger.info(
            `Runtime packages loaded: ${runtimePackages.map((entry) => `${entry.packageAlias}@${entry.version}`).join(", ")}`,
        );

        const useHttp = process.env.MCP_HTTP_PORT || process.env.PORT;
        const config = discordController.getConfigManager().getConfig();
        const oauthClientId =
            config.oauth.clientId || discordService?.getBotApplicationId();

        oauthManager = new OAuthManager({
            ...config.oauth,
            clientId: oauthClientId,
        });

        if (useHttp) {
            const missingOAuthConfig =
                oauthManager.getMissingFullFlowConfigFields();

            try {
                const startupInvite = await oauthManager.createAuthorizeLink({
                    guildId: config.oauth.defaultGuildId,
                });
                logger.info(
                    `Discord bot install URL (Administrator): ${startupInvite.authorizeUrl}`,
                );
                logger.info(`OAuth callback URI: ${config.oauth.redirectUri}`);
            } catch (error) {
                const message =
                    error instanceof Error ? error.message : String(error);
                logger.warn(`OAuth startup install link unavailable: ${message}`);
            }

            if (missingOAuthConfig.length > 0) {
                logger.warn(
                    `OAuth callback flow is partially configured. Missing: ${missingOAuthConfig.join(", ")}`,
                );
                logger.warn(
                    "Server startup will continue so HTTP routes remain available.",
                );
            }
        } else {
            logger.info(
                "OAuth startup install link skipped: HTTP mode is disabled (set MCP_HTTP_PORT to enable callback flow).",
            );
        }

        if (useHttp) {
            const httpPort = Number.parseInt(useHttp, 10) || 3000;
            const port = httpPort;
            const app = createHttpApp({
                port,
                server,
                callTool,
                getOAuthManager,
                parseBooleanQuery,
                listTools,
            });
            serve({ fetch: app.fetch, port });

            logger.info(`Discord MCP server running on HTTP port ${port}`);
            logger.info(`SSE endpoint: http://localhost:${port}/sse`);
            logger.info(`Health check: http://localhost:${port}/health`);
            logger.info(`OAuth start: http://localhost:${port}/oauth/discord/start`);
            logger.info(
                `OAuth callback: http://localhost:${port}/oauth/discord/callback`,
            );
        } else {
            const transport = new StdioServerTransport();
            await server.connect(transport);
            logger.info("Discord MCP server running on stdio");
        }
    } catch (error) {
        logger.error("Failed to start Discord MCP server", error);
        process.exit(1);
    }
}

// Code run by the `run` tool can leave failing promises or timers behind;
// report them instead of letting one mistake take the server down.
process.on("unhandledRejection", (reason) => {
    logger.error("Unhandled rejection (likely from run tool code)", reason);
});

process.on("uncaughtException", (error) => {
    logger.error("Uncaught exception (likely from run tool code)", error);
});

process.on("SIGINT", async () => {
    logger.info("Shutting down Discord MCP server...");
    await upstreams.closeAll();
    if (discordService) {
        await discordService.destroy();
    }
    process.exit(0);
});

process.on("SIGTERM", async () => {
    logger.info("Shutting down Discord MCP server...");
    await upstreams.closeAll();
    if (discordService) {
        await discordService.destroy();
    }
    process.exit(0);
});

main().catch((error) => {
    logger.error("Fatal error", error);
    process.exit(1);
});
