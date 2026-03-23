import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { handleCors, jsonResponse } from "../_shared/http.ts";
import { getStripeApiVersion } from "../_shared/stripe_api_version.ts";
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

    const priceId = String(plan.stripe_price_id).trim();
    if (priceId.startsWith("prod_")) {
      return jsonResponse(400, {
        ok: false,
        error:
          "stripe_price_id esta com Product ID (prod_...). Use o Price ID (price_...): Stripe → Products → o produto → em Pricing copie o API ID do preco (comeca com price_), nao o do produto.",
      });
    }
    if (!priceId.startsWith("price_")) {
      return jsonResponse(400, {
        ok: false,
        error:
          "stripe_price_id deve ser um Price ID valido (comeca com price_). Atualize public.plans com o ID do preco no Stripe.",
      });
    }

    const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
    if (!stripeSecretKey) {
      return jsonResponse(500, { ok: false, error: "STRIPE_SECRET_KEY nao configurada." });
    }

    const { data: authUser } = await supabase.auth.admin.getUserById(userId);
    const customerEmail = authUser?.user?.email?.trim();

    const stripePayload = new URLSearchParams();
    stripePayload.set("mode", "subscription");
    stripePayload.set("success_url", successUrl);
    stripePayload.set("cancel_url", cancelUrl);
    stripePayload.set("line_items[0][price]", priceId);
    stripePayload.set("line_items[0][quantity]", "1");
    stripePayload.set("client_reference_id", tenantId);
    if (customerEmail) {
      stripePayload.set("customer_email", customerEmail);
    }
    stripePayload.set("metadata[tenant_id]", tenantId);
    stripePayload.set("metadata[plan_code]", plan.code);
    stripePayload.set("subscription_data[metadata][tenant_id]", tenantId);
    stripePayload.set("subscription_data[metadata][plan_code]", plan.code);

    const stripeApiVersion = getStripeApiVersion();
    const stripeResp = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${stripeSecretKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "Stripe-Version": stripeApiVersion,
      },
      body: stripePayload.toString(),
    });

    const stripeData = (await stripeResp.json()) as {
      error?: { message?: string; type?: string; code?: string };
      url?: string;
      id?: string;
    };
    if (!stripeResp.ok) {
      const stripeMsg = stripeData?.error?.message?.trim();
      const fallback = "Falha ao criar sessao no Stripe.";
      return jsonResponse(502, {
        ok: false,
        error: stripeMsg || fallback,
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
