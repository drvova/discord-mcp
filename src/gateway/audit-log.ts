import { appendFileSync } from "node:fs";
import { Logger } from "../core/Logger.js";
import { recordAuditEventMetric } from "../observability/telemetry.js";

export type AuditRiskTier = "low" | "medium" | "high";

export type AuditEvent = {
    identityId: string;
    mode: "bot" | "user";
    method: string;
    operation: string;
    riskTier: AuditRiskTier;
    status: "success" | "error";
    durationMs: number;
    compatTranslated?: boolean;
    preflightCanExecute?: boolean;
    blockingReasonCount?: number;
    batchMode?: "best_effort" | "all_or_none";
    error?: string;
};

const logger = Logger.getInstance().child("audit");

function redactError(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }
    return String(error);
}

export function writeAuditEvent(event: AuditEvent): void {
    const payload = {
        ts: new Date().toISOString(),
        type: "discord_mcp_audit",
        ...event,
    };
    const line = JSON.stringify(payload);

    if (event.status === "error") {
        logger.error("discord_mcp_audit", payload);
    } else if (event.riskTier === "high") {
        logger.warn("discord_mcp_audit", payload);
    } else {
        logger.info("discord_mcp_audit", payload);
    }

    recordAuditEventMetric({
        "discord.audit_status": event.status,
        "discord.risk_tier": event.riskTier,
        "discord.mode": event.mode,
        "discord.method": event.method,
        ...(event.compatTranslated !== undefined
            ? {
                  "discord.compat_translated": String(event.compatTranslated),
              }
            : {}),
        ...(event.preflightCanExecute !== undefined
            ? {
                  "discord.preflight_can_execute": String(
                      event.preflightCanExecute,
                  ),
              }
            : {}),
        ...(event.blockingReasonCount !== undefined
            ? {
                  "discord.blocking_reason_count": event.blockingReasonCount,
              }
            : {}),
        ...(event.batchMode
            ? {
                  "discord.batch_mode": event.batchMode,
              }
            : {}),
    });

    const auditPath = process.env.DISCORD_MCP_AUDIT_LOG_PATH;
    if (auditPath) {
        try {
            appendFileSync(auditPath, `${line}\n`, "utf8");
        } catch (error) {
            logger.error("discord_mcp_audit_write_error", {
                ts: new Date().toISOString(),
                type: "discord_mcp_audit_write_error",
                auditPath,
                error: redactError(error),
            });
        }
    }
}
