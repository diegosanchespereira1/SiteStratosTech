import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { handleCors, jsonResponse } from "../_shared/http.ts";
import { createAdminClient, getAuthenticatedUserId, getUserTenantId } from "../_shared/supabase.ts";

interface CheckoutBody {
  planCode?: string;
  successUrl?: string;
  cancelUrl?: string;
}

serve(async (req: Request) => {
  const cors = handleCors(req);
  if (cors) return cors;

  if (req.method !== "POST") {
    return jsonResponse(405, { ok: false, error: "Method not allowed" });
  }

  try {
    const userId = await getAuthenticatedUserId(req);
    const tenantId = await getUserTenantId(userId);
    const body = (await req.json()) as CheckoutBody;

    const planCode = String(body.planCode ?? "").trim().toLowerCase();
    const successUrl = String(body.successUrl ?? "").trim();
    const cancelUrl = String(body.cancelUrl ?? "").trim();

    if (!planCode || !successUrl || !cancelUrl) {
      return jsonResponse(400, {
        ok: false,
        error: "Campos obrigatorios: planCode, successUrl, cancelUrl.",
      });
    }

    const supabase = createAdminClient();
    const { data: plan, error: planError } = await supabase
      .from("plans")
      .select("id, code, stripe_price_id")
      .eq("code", planCode)
      .eq("active", true)
      .maybeSingle();

    if (planError || !plan?.stripe_price_id) {
      return jsonResponse(400, {
        ok: false,
        error: "Plano invalido ou sem stripe_price_id configurado.",
      });
    }

    const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
    if (!stripeSecretKey) {
      return jsonResponse(500, { ok: false, error: "STRIPE_SECRET_KEY nao configurada." });
    }

    const stripePayload = new URLSearchParams();
    stripePayload.set("mode", "subscription");
    stripePayload.set("success_url", successUrl);
    stripePayload.set("cancel_url", cancelUrl);
    stripePayload.set("line_items[0][price]", plan.stripe_price_id);
    stripePayload.set("line_items[0][quantity]", "1");
    stripePayload.set("metadata[tenant_id]", tenantId);
    stripePayload.set("metadata[plan_code]", plan.code);
    stripePayload.set("subscription_data[metadata][tenant_id]", tenantId);
    stripePayload.set("subscription_data[metadata][plan_code]", plan.code);

    const stripeResp = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${stripeSecretKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: stripePayload.toString(),
    });

    const stripeData = await stripeResp.json();
    if (!stripeResp.ok) {
      return jsonResponse(502, {
        ok: false,
        error: "Falha ao criar sessao no Stripe.",
        details: stripeData,
      });
    }

    await supabase.from("billing_events").insert({
      tenant_id: tenantId,
      source: "stripe",
      external_event_id: stripeData.id,
      event_type: "checkout.session.created",
      payload: stripeData,
      processed_at: new Date().toISOString(),
    });

    return jsonResponse(200, {
      ok: true,
      sessionId: stripeData.id,
      checkoutUrl: stripeData.url,
    });
  } catch (error) {
    return jsonResponse(500, { ok: false, error: (error as Error).message });
  }
});
