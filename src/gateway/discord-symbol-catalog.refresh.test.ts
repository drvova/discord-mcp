import { expect, test } from "@rstest/core";
import {
    calculateDiscordCatalogDiff,
    type DiscordCatalogDiffInput,
    type DiscordJsSymbol,
} from "./discord-symbol-catalog.js";

function makeSymbol(
    packageAlias: string,
    name: string,
    kind: DiscordJsSymbol["kind"],
): DiscordJsSymbol {
    return {
        name,
        kind,
        source: "discord.js",
        packageName: packageAlias === "discordjs" ? "discord.js" : packageAlias,
        packageAlias,
        moduleVersion: "1.0.0",
        origin: "runtime",
        behaviorClass: kind === "function" ? "write" : "read",
        invokable: kind === "function",
        operationKey: kind === "function" ? "discord.exec.invoke" : "discord.meta.symbols",
    };
}

test("calculateDiscordCatalogDiff reports package and symbol changes deterministically", () => {
    const previous: DiscordCatalogDiffInput = {
        packages: [
            {
                packageName: "discord.js",
                packageAlias: "discordjs",
                version: "14.0.0",
            },
            {
                packageName: "@discordjs/voice",
                packageAlias: "discordjs_voice",
                version: "0.18.0",
            },
        ],
        symbols: [
            makeSymbol("discordjs", "Client", "class"),
            makeSymbol("discordjs", "TextChannel#send", "function"),
        ],
    };

    const next: DiscordCatalogDiffInput = {
        packages: [
            {
                packageName: "discord.js",
                packageAlias: "discordjs",
                version: "14.21.0",
            },
            {
                packageName: "@discordjs/opus",
                packageAlias: "discordjs_opus",
                version: "0.10.0",
            },
        ],
        symbols: [
            makeSymbol("discordjs", "Client", "class"),
            makeSymbol("discordjs", "GatewayIntentBits", "enum"),
        ],
    };

    const diff = calculateDiscordCatalogDiff(previous, next);

    expect(diff.changedPackages).toEqual([
        {
            packageAlias: "discordjs",
            packageName: "discord.js",
            previousVersion: "14.0.0",
            nextVersion: "14.21.0",
            changeType: "updated",
        },
        {
            packageAlias: "discordjs_opus",
            packageName: "@discordjs/opus",
            nextVersion: "0.10.0",
            changeType: "added",
        },
        {
            packageAlias: "discordjs_voice",
            packageName: "@discordjs/voice",
            previousVersion: "0.18.0",
            changeType: "removed",
        },
    ]);

    expect(diff.addedSymbols.length).toBe(1);
    expect(diff.addedSymbols[0]?.name).toBe("GatewayIntentBits");
    expect(diff.removedSymbols.length).toBe(1);
    expect(diff.removedSymbols[0]?.name).toBe("TextChannel#send");
    expect(diff.kindCountsDelta.enum).toBe(1);
    expect(diff.kindCountsDelta.function).toBe(-1);
    expect(diff.kindCountsDelta.class).toBe(0);
});
