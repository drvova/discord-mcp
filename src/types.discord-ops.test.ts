import assert from "node:assert/strict";
import test from "node:test";
import {
    DiscordExecBatchSchema,
    DiscordExecInvokeSchema,
    DiscordMetaPreflightSchema,
    DiscordMetaRefreshSchema,
    DiscordMetaSymbolsSchema,
} from "./types.js";

test("DiscordMetaSymbolsSchema accepts fundamental kind filters", () => {
    const parsed = DiscordMetaSymbolsSchema.parse({
        packageAlias: "discordjs",
        kinds: ["class", "function", "enum", "interface", "type", "variable"],
        page: 1,
        pageSize: 10,
        includeOperationalMatrix: true,
    });

    assert.equal(parsed.packageAlias, "discordjs");
    assert.equal(parsed.kinds?.length, 6);
    assert.equal(parsed.includeOperationalMatrix, true);
});

test("DiscordMetaPreflightSchema strict flags parse as booleans", () => {
    const parsed = DiscordMetaPreflightSchema.parse({
        packageAlias: "discordjs",
        symbol: "TextChannel#send",
        kind: "function",
        strictContextCheck: true,
        strictArgCheck: false,
    });

    assert.equal(parsed.strictContextCheck, true);
    assert.equal(parsed.strictArgCheck, false);
});

test("DiscordMetaRefreshSchema accepts refresh controls", () => {
    const parsed = DiscordMetaRefreshSchema.parse({
        force: true,
        includeDiff: false,
    });

    assert.equal(parsed.force, true);
    assert.equal(parsed.includeDiff, false);
});

test("DiscordExecInvokeSchema validates required fields", () => {
    const parsed = DiscordExecInvokeSchema.parse({
        packageAlias: "discordjs",
        symbol: "TextChannel#send",
        kind: "function",
        dryRun: true,
    });

    assert.equal(parsed.packageAlias, "discordjs");
    assert.equal(parsed.symbol, "TextChannel#send");
});

test("DiscordExecBatchSchema enforces item array constraints", () => {
    const parsed = DiscordExecBatchSchema.parse({
        mode: "best_effort",
        dryRun: true,
        maxParallelism: 4,
        items: [
            {
                packageAlias: "discordjs",
                symbol: "TextChannel#send",
                kind: "function",
                dryRun: true,
            },
        ],
    });

    assert.equal(parsed.items.length, 1);
    assert.equal(parsed.maxParallelism, 4);
});

test("DiscordExecInvokeSchema rejects unknown kind values", () => {
    assert.throws(
        () =>
            DiscordExecInvokeSchema.parse({
                packageAlias: "discordjs",
                symbol: "TextChannel#send",
                kind: "method",
            }),
    );
});
