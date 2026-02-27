import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { handleCors, jsonResponse } from "../_shared/http.ts";
import { createAdminClient, getAuthenticatedUserId, getUserTenantId } from "../_shared/supabase.ts";

const REQUIRED_STEPS = [
  "company_profile",
  "billing",
  "whatsapp_connection",
  "agent_config",
  "knowledge_upload",
  "publish",
];

serve(async (req: Request) => {
  const cors = handleCors(req);
  if (cors) return cors;

  try {
    const userId = await getAuthenticatedUserId(req);
    const tenantId = await getUserTenantId(userId);
    const supabase = createAdminClient();

    if (req.method === "GET") {
      const { data: rows, error } = await supabase
        .from("onboarding_steps")
        .select("step_code, status, completed_at")
        .eq("tenant_id", tenantId);

      if (error) {
        return jsonResponse(500, { ok: false, error: error.message });
      }

      const map = new Map<string, { status: string; completedAt: string | null }>();
      for (const row of rows ?? []) {
        map.set(row.step_code, {
          status: row.status,
          completedAt: row.completed_at,
        });
      }

      const steps = REQUIRED_STEPS.map((stepCode) => ({
        stepCode,
        status: map.get(stepCode)?.status ?? "pending",
        completedAt: map.get(stepCode)?.completedAt ?? null,
      }));

      const completedCount = steps.filter((s) => s.status === "completed").length;
      return jsonResponse(200, {
        ok: true,
        tenantId,
        completedCount,
        total: REQUIRED_STEPS.length,
        done: completedCount === REQUIRED_STEPS.length,
        steps,
      });
    }

    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const stepCode = String(body.stepCode ?? "").trim();
      const status = String(body.status ?? "completed").trim();

      if (!REQUIRED_STEPS.includes(stepCode)) {
        return jsonResponse(400, { ok: false, error: "stepCode invalido." });
      }
      if (status !== "completed" && status !== "pending") {
        return jsonResponse(400, { ok: false, error: "status invalido." });
      }

      const payload = {
        tenant_id: tenantId,
        step_code: stepCode,
        status,
        completed_at: status === "completed" ? new Date().toISOString() : null,
      };

      const { error } = await supabase
        .from("onboarding_steps")
        .upsert(payload, { onConflict: "tenant_id,step_code" });

      if (error) {
        return jsonResponse(500, { ok: false, error: error.message });
      }

      return jsonResponse(200, {
        ok: true,
        tenantId,
        stepCode,
        status,
      });
    }

    return jsonResponse(405, { ok: false, error: "Method not allowed" });
  } catch (error) {
    return jsonResponse(401, { ok: false, error: (error as Error).message });
  }
});
