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

      let currentPlan: {
        code: string;
        name: string;
        displayPriceBrl: string | null;
      } | null = null;
      let subscriptionStatus: string | null = null;

      const { data: subRow } = await supabase
        .from("subscriptions")
        .select("status, plan_id, stripe_subscription_id")
        .eq("tenant_id", tenantId)
        .maybeSingle();

      subscriptionStatus = subRow?.status ?? null;

      if (subRow?.plan_id) {
        const { data: planRow } = await supabase
          .from("plans")
          .select("code, name, display_price_brl")
          .eq("id", subRow.plan_id)
          .maybeSingle();
        if (planRow) {
          currentPlan = {
            code: planRow.code,
            name: planRow.name,
            displayPriceBrl: planRow.display_price_brl ?? null,
          };
        }
      }

      const subStatus = String(subRow?.status ?? "").toLowerCase();
      const hasStripeSubscriptionId = !!(
        subRow?.stripe_subscription_id &&
        String(subRow.stripe_subscription_id).trim().length > 0
      );
      // Inclui past_due; se existir stripe_subscription_id e não estiver cancelado, o checkout já criou subscrição na Stripe
      // (evita ficar preso em "inactive" por atraso do webhook ou race no redirect).
      const subscriptionPaid =
        subStatus === "active" ||
        subStatus === "trialing" ||
        subStatus === "past_due" ||
        (hasStripeSubscriptionId && subStatus !== "canceled");
      const billingIdx = steps.findIndex((s) => s.stepCode === "billing");
      const billingRowPending =
        billingIdx >= 0 && steps[billingIdx].status !== "completed";

      if (subscriptionPaid && billingRowPending) {
        await supabase.from("onboarding_steps").upsert(
          {
            tenant_id: tenantId,
            step_code: "billing",
            status: "completed",
            completed_at: new Date().toISOString(),
          },
          { onConflict: "tenant_id,step_code" },
        );
        if (billingIdx >= 0) {
          steps[billingIdx] = {
            ...steps[billingIdx],
            status: "completed",
            completedAt: new Date().toISOString(),
          };
        }
      }

      const completedCountAfter = steps.filter((s) => s.status === "completed").length;

      return jsonResponse(200, {
        ok: true,
        tenantId,
        completedCount: completedCountAfter,
        total: REQUIRED_STEPS.length,
        done: completedCountAfter === REQUIRED_STEPS.length,
        steps,
        subscriptionStatus,
        currentPlan,
        hasPaidSubscription: subscriptionPaid,
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
