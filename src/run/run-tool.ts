import type { RunResult } from "./harness.js";

// The server's entire tool surface: one tool that runs code. Capabilities are
// reached from inside the code (client.<method>, ops.<name>, helpers the model
// keeps), never as separate tools.

export const RUN_TOOL_NAME = "run";

export const RUN_TOOL = {
    name: RUN_TOOL_NAME,
    description: [
        "Run JavaScript in this Discord server's single persistent namespace and return what it prints plus the value of its last expression (top-level await works).",
        "SECURITY: the code executes with the server's full authority (Discord tokens, network, filesystem, process). That is what this tool is; there is no restricted mode. Run the server sandboxed (container/VM).",
        "Definitions persist across calls; top-level functions, classes and constant definitions are also saved and reloaded after restarts, so build your own helpers and reuse them.",
        "Call with empty code for the manual. Then `describe(client)` to see the live discord.js API.",
    ].join(" "),
    inputSchema: {
        type: "object",
        properties: {
            code: {
                type: "string",
                description:
                    "JavaScript to run. Empty string returns the manual.",
            },
            identity: {
                type: "string",
                description:
                    "Optional identity id to bind as `client` before the code runs (for example default-bot).",
            },
            vars: {
                type: "object",
                description:
                    "Optional named strings, available to the code as `vars.<name>`. Use for long text or payloads instead of escaping them inside code.",
                additionalProperties: { type: "string" },
            },
        },
        required: ["code"],
        additionalProperties: false,
    },
} as const;

export function listTools() {
    return [RUN_TOOL];
}

export type RunArguments = {
    code: string;
    identity?: string;
    vars?: Record<string, string>;
};

export function parseRunArguments(name: unknown, rawArgs: unknown): RunArguments {
    if (name !== RUN_TOOL_NAME) {
        throw new Error(
            `Unknown tool: ${String(name)}. The only tool is '${RUN_TOOL_NAME}'.`,
        );
    }
    const args =
        rawArgs && typeof rawArgs === "object" && !Array.isArray(rawArgs)
            ? (rawArgs as Record<string, unknown>)
            : {};
    const code = args.code ?? "";
    if (typeof code !== "string") {
        throw new Error("'code' must be a string.");
    }
    if (args.identity !== undefined && typeof args.identity !== "string") {
        throw new Error("'identity' must be a string.");
    }
    let vars: Record<string, string> | undefined;
    if (args.vars !== undefined) {
        if (!args.vars || typeof args.vars !== "object" || Array.isArray(args.vars)) {
            throw new Error("'vars' must be an object of named strings.");
        }
        vars = {};
        for (const [key, value] of Object.entries(args.vars)) {
            if (typeof value !== "string") {
                throw new Error(`vars.${key} must be a string.`);
            }
            vars[key] = value;
        }
    }
    return {
        code,
        identity: (args.identity as string | undefined)?.trim() || undefined,
        vars,
    };
}

export function toToolResult(result: RunResult) {
    return {
        content: [{ type: "text" as const, text: result.text }],
        ...(result.ok ? {} : { isError: true }),
    };
}
