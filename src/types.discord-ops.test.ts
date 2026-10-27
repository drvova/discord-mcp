import { expect, test } from "@rstest/core";
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

    expect(parsed.packageAlias).toBe("discordjs");
    expect(parsed.kinds?.length).toBe(6);
    expect(parsed.includeOperationalMatrix).toBe(true);
});

test("DiscordMetaPreflightSchema strict flags parse as booleans", () => {
    const parsed = DiscordMetaPreflightSchema.parse({
        packageAlias: "discordjs",
        symbol: "TextChannel#send",
        kind: "function",
        strictContextCheck: true,
        strictArgCheck: false,
    });

    expect(parsed.strictContextCheck).toBe(true);
    expect(parsed.strictArgCheck).toBe(false);
});

test("DiscordMetaRefreshSchema accepts refresh controls", () => {
    const parsed = DiscordMetaRefreshSchema.parse({
        force: true,
        includeDiff: false,
    });

    expect(parsed.force).toBe(true);
    expect(parsed.includeDiff).toBe(false);
});

test("DiscordExecInvokeSchema validates required fields", () => {
    const parsed = DiscordExecInvokeSchema.parse({
        packageAlias: "discordjs",
        symbol: "TextChannel#send",
        kind: "function",
        dryRun: true,
    });

    expect(parsed.packageAlias).toBe("discordjs");
    expect(parsed.symbol).toBe("TextChannel#send");
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

    expect(parsed.items.length).toBe(1);
    expect(parsed.maxParallelism).toBe(4);
});

test("DiscordExecInvokeSchema rejects unknown kind values", () => {
    expect(() =>
            DiscordExecInvokeSchema.parse({
                packageAlias: "discordjs",
                symbol: "TextChannel#send",
                kind: "method",
            })).toThrow();
});
