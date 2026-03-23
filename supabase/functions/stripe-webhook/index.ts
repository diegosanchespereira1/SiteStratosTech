import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { handleCors, jsonResponse } from "../_shared/http.ts";
import { getStripeApiVersion } from "../_shared/stripe_api_version.ts";
import { writeOperationLog } from "../_shared/ops_log.ts";
import { createAdminClient } from "../_shared/supabase.ts";

function hex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function signHmacSHA256(payload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return hex(signature);
}

/** Stripe recomenda tolerância ao timestamp (replay); ver https://docs.stripe.com/webhooks/signature */
const WEBHOOK_TIMESTAMP_TOLERANCE_SEC = 300;

async function isValidWebhook(rawBody: string, header: string, secret: string): Promise<boolean> {
  if (!header || !secret) return false;

  const parts = header.split(",").map((x) => x.trim());
  const timestampPart = parts.find((p) => p.startsWith("t="));
  const signatureParts = parts.filter((p) => p.startsWith("v1="));

  if (!timestampPart || signatureParts.length === 0) return false;
  const timestamp = timestampPart.replace("t=", "");
  const tsNum = parseInt(timestamp, 10);
  if (Number.isNaN(tsNum)) return false;
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - tsNum) > WEBHOOK_TIMESTAMP_TOLERANCE_SEC) return false;

  const signedPayload = `${timestamp}.${rawBody}`;
  const expected = await signHmacSHA256(signedPayload, secret);

  for (const sp of signatureParts) {
    const signature = sp.replace("v1=", "");
    if (expected.length !== signature.length) continue;
    let diff = 0;
    for (let i = 0; i < expected.length; i += 1) {
      diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
    }
    if (diff === 0) return true;
  }
  return false;
}

function mapStripeStatus(status?: string): string {
  if (!status) return "inactive";
  if (status === "trialing") return "trialing";
  if (status === "active") return "active";
  if (status === "past_due" || status === "unpaid") return "past_due";
  if (status === "canceled" || status === "incomplete_expired") return "canceled";
  return "inactive";
}

async function resolvePlanIdByCode(
  supabase: ReturnType<typeof createAdminClient>,
  planCode: string | null | undefined,
): Promise<string | null> {
  const code = String(planCode ?? "").trim().toLowerCase();
  if (!code) return null;
  const { data } = await supabase
    .from("plans")
    .select("id")
    .eq("code", code)
    .eq("active", true)
    .maybeSingle();
  return data?.id ?? null;
}

async function markBillingOnboardingComplete(
  supabase: ReturnType<typeof createAdminClient>,
  tenantId: string,
) {
  await supabase.from("onboarding_steps").upsert(
    {
      tenant_id: tenantId,
      step_code: "billing",
      status: "completed",
      completed_at: new Date().toISOString(),
    },
    { onConflict: "tenant_id,step_code" },
  );
}

/** https://docs.stripe.com/payments/checkout/fulfillment — dados fiáveis da API (payload do evento pode ser mínimo). */
async function retrieveCheckoutSession(sessionId: string): Promise<Record<string, unknown> | null> {
  const key = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
  if (!key || !sessionId) return null;
  const ver = getStripeApiVersion();
  const url =
    `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}` +
    `?expand[]=subscription`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${key}`,
      "Stripe-Version": ver,
    },
  });
  if (!res.ok) return null;
  return (await res.json()) as Record<string, unknown>;
}

function tenantIdFromCheckoutSession(sess: Record<string, unknown>): string | null {
  const meta = sess.metadata as Record<string, string> | undefined;
  const fromMeta = String(meta?.tenant_id ?? "").trim();
  if (fromMeta) return fromMeta;
  const ref = String(sess.client_reference_id ?? "").trim();
  if (ref) return ref;
  return null;
}

function idFromExpandable(field: unknown): string | null {
  if (typeof field === "string" && field.length > 0) return field;
  if (field && typeof field === "object" && "id" in field) {
    return String((field as { id: string }).id);
  }
  return null;
}

serve(async (req: Request) => {
  const cors = handleCors(req);
  if (cors) return cors;

  if (req.method !== "POST") {
    return jsonResponse(405, { ok: false, error: "Method not allowed" });
  }

  const secret = Deno.env.get("STRIPE_WEBHOOK_SECRET") ?? "";
  const signatureHeader = req.headers.get("stripe-signature") ?? "";
  const rawBody = await req.text();

  const valid = await isValidWebhook(rawBody, signatureHeader, secret);
  if (!valid) {
    return jsonResponse(401, { ok: false, error: "Invalid stripe signature" });
  }

  let event: any;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return jsonResponse(400, { ok: false, error: "Invalid payload" });
  }

  try {
    const supabase = createAdminClient();
    const eventId = String(event.id ?? "");
    const eventType = String(event.type ?? "");

    if (!eventId || !eventType) {
      return jsonResponse(400, { ok: false, error: "Evento Stripe invalido." });
    }

    const obj = event?.data?.object;
    let tenantId: string | null = null;
    let checkoutSessionResolved: Record<string, unknown> | null = null;

    if (eventType === "checkout.session.completed") {
      const payloadSession = obj as Record<string, unknown>;
      const sid = String(payloadSession.id ?? "");
      let session = payloadSession;
      const retrieved = await retrieveCheckoutSession(sid);
      if (retrieved) session = retrieved;
      checkoutSessionResolved = session;

      const paymentStatus = String(session.payment_status ?? "");
      if (paymentStatus === "unpaid") {
        const { error: insUnpaid } = await supabase.from("billing_events").insert({
          tenant_id: tenantIdFromCheckoutSession(session),
          source: "stripe",
          external_event_id: eventId,
          event_type: eventType,
          payload: event,
          processed_at: new Date().toISOString(),
        });
        if (insUnpaid && !String(insUnpaid.message).toLowerCase().includes("duplicate")) {
          return jsonResponse(500, { ok: false, error: insUnpaid.message });
        }
        return jsonResponse(200, { ok: true, ignored: true, reason: "checkout_session_unpaid" });
      }

      tenantId = tenantIdFromCheckoutSession(session);
    } else {
      tenantId =
        obj?.metadata?.tenant_id ??
        obj?.subscription_details?.metadata?.tenant_id ??
        null;
    }

    const { error: eventInsertError } = await supabase.from("billing_events").insert({
      tenant_id: tenantId,
      source: "stripe",
      external_event_id: eventId,
      event_type: eventType,
      payload: event,
      processed_at: new Date().toISOString(),
    });

    if (eventInsertError && !String(eventInsertError.message).toLowerCase().includes("duplicate")) {
      return jsonResponse(500, { ok: false, error: eventInsertError.message });
    }

    if (!tenantId) {
      return jsonResponse(200, { ok: true, ignored: true, reason: "tenant_id_ausente_metadata_ou_client_reference_id" });
    }

    if (eventType === "checkout.session.completed" && checkoutSessionResolved) {
      const session = checkoutSessionResolved;
      const meta = session.metadata as Record<string, string> | undefined;
      const planCode = meta?.plan_code;
      const planId = await resolvePlanIdByCode(supabase, planCode);

      const upsertRow: Record<string, unknown> = {
        tenant_id: tenantId,
        stripe_customer_id: idFromExpandable(session.customer),
        stripe_subscription_id: idFromExpandable(session.subscription),
        stripe_checkout_session_id: session.id ?? null,
        status: "active",
      };
      if (planId) upsertRow.plan_id = planId;

      await supabase.from("subscriptions").upsert(upsertRow as never, { onConflict: "tenant_id" });
      await markBillingOnboardingComplete(supabase, tenantId);
    }

    if (eventType === "customer.subscription.updated" || eventType === "customer.subscription.created") {
      const subscription = event.data.object;
      const subTenantId = subscription.metadata?.tenant_id ?? tenantId;
      if (!subTenantId) {
        return jsonResponse(200, { ok: true, ignored: true, reason: "tenant_id ausente na subscription" });
      }
      const mapped = mapStripeStatus(subscription.status);
      const planId = await resolvePlanIdByCode(supabase, subscription.metadata?.plan_code);

      const upsertRow: Record<string, unknown> = {
        tenant_id: subTenantId,
        stripe_customer_id: subscription.customer ?? null,
        stripe_subscription_id: subscription.id ?? null,
        status: mapped,
        current_period_start: subscription.current_period_start
          ? new Date(subscription.current_period_start * 1000).toISOString()
          : null,
        current_period_end: subscription.current_period_end
          ? new Date(subscription.current_period_end * 1000).toISOString()
          : null,
      };
      if (planId) upsertRow.plan_id = planId;

      await supabase.from("subscriptions").upsert(upsertRow as never, { onConflict: "tenant_id" });

      if (mapped === "active" || mapped === "trialing") {
        await markBillingOnboardingComplete(supabase, subTenantId);
      }
    }

    if (eventType === "customer.subscription.deleted") {
      const subscription = event.data.object;
      const subTenantId = subscription.metadata?.tenant_id ?? tenantId;
      if (!subTenantId) {
        return jsonResponse(200, { ok: true, ignored: true, reason: "tenant_id ausente na subscription" });
      }
      await supabase
        .from("subscriptions")
        .update({
          status: "canceled",
          stripe_subscription_id: subscription.id ?? null,
        })
        .eq("tenant_id", subTenantId);
    }

    await writeOperationLog({
      tenantId,
      source: "stripe-webhook",
      level: "info",
      event: "stripe_event_processed",
      message: `Evento Stripe processado: ${eventType}`,
      details: {
        eventId,
        eventType,
      },
    });

    return jsonResponse(200, { ok: true });
  } catch (error) {
    return jsonResponse(500, { ok: false, error: (error as Error).message });
  }
});
