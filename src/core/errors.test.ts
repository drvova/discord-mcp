import assert from "node:assert/strict";
import test from "node:test";
import { AppError, AppErrorCode, normalizeUnknownError, toPublicErrorPayload } from "./errors.js";

test("normalizeUnknownError passes through AppError", () => {
    const original = new AppError({
        code: AppErrorCode.Policy,
        message: "policy block",
    });
    const normalized = normalizeUnknownError(original);
    assert.equal(normalized, original);
    assert.equal(normalized.code, AppErrorCode.Policy);
});

test("normalizeUnknownError wraps standard Error deterministically", () => {
    const normalized = normalizeUnknownError(new Error("boom"));
    assert.equal(normalized.code, AppErrorCode.Internal);
    assert.equal(normalized.message, "boom");
});

test("normalizeUnknownError infers validation code from Zod-like errors", () => {
    const zodLike = new Error("invalid schema");
    zodLike.name = "ZodError";
    const normalized = normalizeUnknownError(zodLike);
    assert.equal(normalized.code, AppErrorCode.Validation);
    assert.equal(normalized.message, "invalid schema");
});

test("toPublicErrorPayload returns stable serializable payload", () => {
    const payload = toPublicErrorPayload(
        new AppError({
            code: AppErrorCode.Permission,
            message: "not allowed",
        }),
    );
    assert.deepEqual(payload, {
        code: AppErrorCode.Permission,
        message: "not allowed",
    });
});
