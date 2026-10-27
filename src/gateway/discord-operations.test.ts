import { expect, test } from "@rstest/core";
import { prepareDiscordOperation } from "./discord-operations.js";

test("operations are validated against their schema and classified", () => {
    const prepared = prepareDiscordOperation({
        mode: "bot",
        identityId: "default-bot",
        operation: "discord.exec.invoke",
        params: { packageAlias: "discordjs", symbol: "TextChannel#send", dryRun: false },
    });
    expect(prepared.method).toBe("automation.write");
    expect(prepared.riskTier).toBe("high");
    expect(prepared.params.symbol).toBe("TextChannel#send");

    const read = prepareDiscordOperation({
        mode: "user",
        identityId: "default-user",
        operation: "discord.meta.packages",
    });
    expect(read.method).toBe("automation.read");
    expect(read.riskTier).toBe("low");
});

test("operation policy still applies", () => {
    expect(() =>
            prepareDiscordOperation({
                mode: "user",
                identityId: "default-user",
                operation: "discord.exec.invoke",
                params: { packageAlias: "discordjs", symbol: "TextChannel#send" },
            })).toThrow(/blocked for user mode/);

    const previous = process.env.DISCORD_MCP_BLOCK_HIGH_RISK;
    process.env.DISCORD_MCP_BLOCK_HIGH_RISK = "true";
    try {
        expect(() =>
                prepareDiscordOperation({
                    mode: "bot",
                    identityId: "default-bot",
                    operation: "discord.exec.invoke",
                    params: { packageAlias: "discordjs", symbol: "TextChannel#send", dryRun: false },
                })).toThrow(/DISCORD_MCP_BLOCK_HIGH_RISK/);
    } finally {
        if (previous === undefined) {
            delete process.env.DISCORD_MCP_BLOCK_HIGH_RISK;
        } else {
            process.env.DISCORD_MCP_BLOCK_HIGH_RISK = previous;
        }
    }
});

test("unknown operations and invalid params are rejected", () => {
    expect(() => prepareDiscordOperation({ mode: "bot", identityId: "x", operation: "discord.manage" })).toThrow(/Unsupported operation/);
    expect(() =>
        prepareDiscordOperation({
            mode: "bot",
            identityId: "x",
            operation: "discord.meta.preflight",
            params: {},
        })).toThrow();
});
