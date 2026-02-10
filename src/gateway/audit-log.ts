import { appendFileSync } from "node:fs";

export type AuditRiskTier = "low" | "medium" | "high";

export type AuditEvent = {
    identityId: string;
    mode: "bot" | "user";
    method: string;
    operation: string;
    riskTier: AuditRiskTier;
    status: "success" | "error";
    durationMs: number;
    error?: string;
};

function redactError(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }
    return String(error);
}

export function writeAuditEvent(event: AuditEvent): void {
    const line = JSON.stringify({
        ts: new Date().toISOString(),
        type: "discord_mcp_audit",
        ...event,
    });

    console.error(line);

    const auditPath = process.env.DISCORD_MCP_AUDIT_LOG_PATH;
    if (auditPath) {
        try {
            appendFileSync(auditPath, `${line}\n`, "utf8");
        } catch (error) {
            console.error(
                JSON.stringify({
                    ts: new Date().toISOString(),
                    type: "discord_mcp_audit_write_error",
                    error: redactError(error),
                }),
            );
        }
    }
}
