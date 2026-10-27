import assert from "node:assert/strict";
import test from "node:test";
import { prepareDiscordOperation } from "./discord-operations.js";

test("operations are validated against their schema and classified", () => {
    const prepared = prepareDiscordOperation({
        mode: "bot",
        identityId: "default-bot",
        operation: "discord.exec.invoke",
        params: { packageAlias: "discordjs", symbol: "TextChannel#send", dryRun: false },
    });
    assert.equal(prepared.method, "automation.write");
    assert.equal(prepared.riskTier, "high");
    assert.equal(prepared.params.symbol, "TextChannel#send");

    const read = prepareDiscordOperation({
        mode: "user",
        identityId: "default-user",
        operation: "discord.meta.packages",
    });
    assert.equal(read.method, "automation.read");
    assert.equal(read.riskTier, "low");
});

test("operation policy still applies", () => {
    assert.throws(
        () =>
            prepareDiscordOperation({
                mode: "user",
                identityId: "default-user",
                operation: "discord.exec.invoke",
                params: { packageAlias: "discordjs", symbol: "TextChannel#send" },
            }),
        /blocked for user mode/,
    );

    const previous = process.env.DISCORD_MCP_BLOCK_HIGH_RISK;
    process.env.DISCORD_MCP_BLOCK_HIGH_RISK = "true";
    try {
        assert.throws(
            () =>
                prepareDiscordOperation({
                    mode: "bot",
                    identityId: "default-bot",
                    operation: "discord.exec.invoke",
                    params: { packageAlias: "discordjs", symbol: "TextChannel#send", dryRun: false },
                }),
            /DISCORD_MCP_BLOCK_HIGH_RISK/,
        );
    } finally {
        if (previous === undefined) {
            delete process.env.DISCORD_MCP_BLOCK_HIGH_RISK;
        } else {
            process.env.DISCORD_MCP_BLOCK_HIGH_RISK = previous;
        }
    }
});

test("unknown operations and invalid params are rejected", () => {
    assert.throws(
        () => prepareDiscordOperation({ mode: "bot", identityId: "x", operation: "discord.manage" }),
        /Unsupported operation/,
    );
    assert.throws(() =>
        prepareDiscordOperation({
            mode: "bot",
            identityId: "x",
            operation: "discord.meta.preflight",
            params: {},
        }),
    );
});
