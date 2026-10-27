import { expect, test } from "@rstest/core";
import { AppError, AppErrorCode, normalizeUnknownError, toPublicErrorPayload } from "./errors.js";

test("normalizeUnknownError passes through AppError", () => {
    const original = new AppError({
        code: AppErrorCode.Policy,
        message: "policy block",
    });
    const normalized = normalizeUnknownError(original);
    expect(normalized).toBe(original);
    expect(normalized.code).toBe(AppErrorCode.Policy);
});

test("normalizeUnknownError wraps standard Error deterministically", () => {
    const normalized = normalizeUnknownError(new Error("boom"));
    expect(normalized.code).toBe(AppErrorCode.Internal);
    expect(normalized.message).toBe("boom");
});

test("normalizeUnknownError infers validation code from Zod-like errors", () => {
    const zodLike = new Error("invalid schema");
    zodLike.name = "ZodError";
    const normalized = normalizeUnknownError(zodLike);
    expect(normalized.code).toBe(AppErrorCode.Validation);
    expect(normalized.message).toBe("invalid schema");
});

test("toPublicErrorPayload returns stable serializable payload", () => {
    const payload = toPublicErrorPayload(
        new AppError({
            code: AppErrorCode.Permission,
            message: "not allowed",
        }),
    );
    expect(payload).toEqual({
        code: AppErrorCode.Permission,
        message: "not allowed",
    });
});
