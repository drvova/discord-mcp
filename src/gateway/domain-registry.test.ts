import assert from "node:assert/strict";
import test from "node:test";
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
    assert.equal(resolved, DISCORD_META_SYMBOLS_OPERATION);
});

test("resolveOperation rejects unknown operations", () => {
    assert.throws(
        () => resolveOperation("discord.meta.legacy"),
        /Unsupported operation/,
    );
});

test("resolveDomainMethod validates accepted methods", () => {
    assert.equal(resolveDomainMethod("AUTOMATION.READ"), "automation.read");
    assert.equal(resolveDomainMethod(" automation.write "), "automation.write");
});

test("resolveOperationForMethod enforces read/write boundaries", () => {
    assert.equal(
        resolveOperationForMethod("automation.read", DISCORD_META_PACKAGES_OPERATION),
        DISCORD_META_PACKAGES_OPERATION,
    );
    assert.equal(
        resolveOperationForMethod("automation.write", DISCORD_EXEC_INVOKE_OPERATION),
        DISCORD_EXEC_INVOKE_OPERATION,
    );
    assert.throws(
        () =>
            resolveOperationForMethod(
                "automation.read",
                DISCORD_EXEC_BATCH_OPERATION,
            ),
        /is not valid for method/,
    );
});

test("getDomainMethodForOperation returns deterministic routing", () => {
    assert.equal(
        getDomainMethodForOperation(DISCORD_META_PREFLIGHT_OPERATION),
        "automation.read",
    );
    assert.equal(
        getDomainMethodForOperation(DISCORD_META_REFRESH_OPERATION),
        "automation.read",
    );
    assert.equal(
        getDomainMethodForOperation(DISCORD_EXEC_INVOKE_OPERATION),
        "automation.write",
    );
});

test("meta and exec operation predicates are accurate", () => {
    assert.equal(isDiscordMetaOperation(DISCORD_META_SYMBOLS_OPERATION), true);
    assert.equal(isDiscordMetaOperation(DISCORD_EXEC_INVOKE_OPERATION), false);
    assert.equal(isDiscordExecOperation(DISCORD_EXEC_BATCH_OPERATION), true);
    assert.equal(isDiscordExecOperation(DISCORD_META_PACKAGES_OPERATION), false);
});

test("getOperationsForMethod returns the exact allowed operation set", () => {
    assert.deepEqual(getOperationsForMethod("automation.read"), [
        DISCORD_META_PACKAGES_OPERATION,
        DISCORD_META_SYMBOLS_OPERATION,
        DISCORD_META_PREFLIGHT_OPERATION,
        DISCORD_META_REFRESH_OPERATION,
    ]);
    assert.deepEqual(getOperationsForMethod("automation.write"), [
        DISCORD_EXEC_INVOKE_OPERATION,
        DISCORD_EXEC_BATCH_OPERATION,
    ]);
});
