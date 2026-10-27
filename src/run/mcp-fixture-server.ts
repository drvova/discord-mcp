import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

// A small upstream MCP server for tests: run directly for stdio, or start it
// over streamable HTTP with startHttpFixture().

export function createFixtureServer(): McpServer {
    const server = new McpServer({ name: "fixture", version: "0.0.1" });

    server.tool(
        "add",
        "Adds two numbers.\nSecond line is not part of the summary.",
        { a: z.number(), b: z.number() },
        async ({ a, b }) => ({
            content: [{ type: "text", text: JSON.stringify({ sum: a + b }) }],
        }),
    );

    server.tool(
        "echo-text",
        "Echoes text back.",
        { text: z.string(), shout: z.boolean().optional() },
        async ({ text, shout }) => ({
            content: [{ type: "text", text: shout ? text.toUpperCase() : text }],
        }),
    );

    server.registerTool(
        "count",
        {
            description: "Returns structured content.",
            inputSchema: { mode: z.enum(["fast", "slow"]) },
            outputSchema: { count: z.number(), mode: z.string() },
        },
        async ({ mode }) => ({
            content: [{ type: "text", text: "count is 3" }],
            structuredContent: { count: 3, mode },
        }),
    );

    server.tool("fail", "Always reports an error.", async () => ({
        content: [{ type: "text", text: "nope" }],
        isError: true,
    }));

    return server;
}

export async function startHttpFixture(): Promise<{ url: string; close: () => Promise<void> }> {
    const httpServer: HttpServer = createServer(async (req, res) => {
        const server = createFixtureServer();
        const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: undefined,
        });
        res.on("close", () => {
            void transport.close();
            void server.close();
        });
        let body = "";
        for await (const chunk of req) {
            body += chunk;
        }
        await server.connect(transport);
        await transport.handleRequest(req, res, body ? JSON.parse(body) : undefined);
    });
    await new Promise<void>((resolveListen) =>
        httpServer.listen(0, "127.0.0.1", resolveListen),
    );
    const { port } = httpServer.address() as AddressInfo;
    return {
        url: `http://127.0.0.1:${port}/mcp`,
        close: () =>
            new Promise<void>((resolveClose) => {
                httpServer.closeAllConnections();
                httpServer.close(() => resolveClose());
            }),
    };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    await createFixtureServer().connect(new StdioServerTransport());
}
