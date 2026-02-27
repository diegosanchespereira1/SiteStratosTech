import { createAdminClient } from "./supabase.ts";

export interface OperationLogInput {
  tenantId: string;
  source: string;
  level?: "debug" | "info" | "warn" | "error";
  event: string;
  message?: string;
  details?: Record<string, unknown>;
}

export async function writeOperationLog(input: OperationLogInput): Promise<void> {
  try {
    const supabase = createAdminClient();
    await supabase.from("tenant_operation_logs").insert({
      tenant_id: input.tenantId,
      source: input.source,
      level: input.level ?? "info",
      event: input.event,
      message: input.message ?? null,
      details: input.details ?? {},
    });
  } catch {
    // Best effort logging; do not break business flow.
  }
}
