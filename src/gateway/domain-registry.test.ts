import { expect, test } from "@rstest/core";
import {
    DISCORD_EXEC_BATCH_OPERATION,
    DISCORD_EXEC_INVOKE_OPERATION,
    DISCORD_META_PACKAGES_OPERATION,
    DISCORD_META_PREFLIGHT_OPERATION,
    DISCORD_META_REFRESH_OPERATION,
    DISCORD_META_SYMBOLS_OPERATION,
    getDomainMethodForOperation,
    getOperationsForMethod,
    isDiscordExecOperation,
    isDiscordMetaOperation,
    resolveDomainMethod,
    resolveOperation,
    resolveOperationForMethod,
} from "./domain-registry.js";

test("resolveOperation normalizes case and whitespace", () => {
    const resolved = resolveOperation("  DISCORD.META.SYMBOLS ");
    expect(resolved).toBe(DISCORD_META_SYMBOLS_OPERATION);
});

test("resolveOperation rejects unknown operations", () => {
    expect(() => resolveOperation("discord.meta.legacy")).toThrow(/Unsupported operation/);
});

test("resolveDomainMethod validates accepted methods", () => {
    expect(resolveDomainMethod("AUTOMATION.READ")).toBe("automation.read");
    expect(resolveDomainMethod(" automation.write ")).toBe("automation.write");
});

test("resolveOperationForMethod enforces read/write boundaries", () => {
    expect(resolveOperationForMethod("automation.read", DISCORD_META_PACKAGES_OPERATION)).toBe(DISCORD_META_PACKAGES_OPERATION);
    expect(resolveOperationForMethod("automation.write", DISCORD_EXEC_INVOKE_OPERATION)).toBe(DISCORD_EXEC_INVOKE_OPERATION);
    expect(() =>
            resolveOperationForMethod(
                "automation.read",
                DISCORD_EXEC_BATCH_OPERATION,
            )).toThrow(/is not valid for method/);
});

test("getDomainMethodForOperation returns deterministic routing", () => {
    expect(getDomainMethodForOperation(DISCORD_META_PREFLIGHT_OPERATION)).toBe("automation.read");
    expect(getDomainMethodForOperation(DISCORD_META_REFRESH_OPERATION)).toBe("automation.read");
    expect(getDomainMethodForOperation(DISCORD_EXEC_INVOKE_OPERATION)).toBe("automation.write");
});

test("meta and exec operation predicates are accurate", () => {
    expect(isDiscordMetaOperation(DISCORD_META_SYMBOLS_OPERATION)).toBe(true);
    expect(isDiscordMetaOperation(DISCORD_EXEC_INVOKE_OPERATION)).toBe(false);
    expect(isDiscordExecOperation(DISCORD_EXEC_BATCH_OPERATION)).toBe(true);
    expect(isDiscordExecOperation(DISCORD_META_PACKAGES_OPERATION)).toBe(false);
});

test("getOperationsForMethod returns the exact allowed operation set", () => {
    expect(getOperationsForMethod("automation.read")).toEqual([
        DISCORD_META_PACKAGES_OPERATION,
        DISCORD_META_SYMBOLS_OPERATION,
        DISCORD_META_PREFLIGHT_OPERATION,
        DISCORD_META_REFRESH_OPERATION,
    ]);
    expect(getOperationsForMethod("automation.write")).toEqual([
        DISCORD_EXEC_INVOKE_OPERATION,
        DISCORD_EXEC_BATCH_OPERATION,
    ]);
});
