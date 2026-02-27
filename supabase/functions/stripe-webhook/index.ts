import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { handleCors, jsonResponse } from "../_shared/http.ts";
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

async function isValidWebhook(rawBody: string, header: string, secret: string): Promise<boolean> {
  if (!header || !secret) return false;

  const parts = header.split(",").map((x) => x.trim());
  const timestampPart = parts.find((p) => p.startsWith("t="));
  const signaturePart = parts.find((p) => p.startsWith("v1="));

  if (!timestampPart || !signaturePart) return false;
  const timestamp = timestampPart.replace("t=", "");
  const signature = signaturePart.replace("v1=", "");
  const signedPayload = `${timestamp}.${rawBody}`;
  const expected = await signHmacSHA256(signedPayload, secret);

  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) {
    diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return diff === 0;
}

function mapStripeStatus(status?: string): string {
  if (!status) return "inactive";
  if (status === "trialing") return "trialing";
  if (status === "active") return "active";
  if (status === "past_due" || status === "unpaid") return "past_due";
  if (status === "canceled" || status === "incomplete_expired") return "canceled";
  return "inactive";
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

    const tenantId =
      event?.data?.object?.metadata?.tenant_id ??
      event?.data?.object?.subscription_details?.metadata?.tenant_id ??
      null;

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
      return jsonResponse(200, { ok: true, ignored: true, reason: "tenant_id ausente no metadata" });
    }

    if (eventType === "checkout.session.completed") {
      const sessionObj = event.data.object;
      await supabase.from("subscriptions").upsert({
        tenant_id: tenantId,
        stripe_customer_id: sessionObj.customer ?? null,
        stripe_subscription_id: sessionObj.subscription ?? null,
        stripe_checkout_session_id: sessionObj.id ?? null,
        status: "active",
      }, { onConflict: "tenant_id" });
    }

    if (eventType === "customer.subscription.updated" || eventType === "customer.subscription.created") {
      const subscription = event.data.object;
      const mapped = mapStripeStatus(subscription.status);
      await supabase.from("subscriptions").upsert({
        tenant_id: tenantId,
        stripe_customer_id: subscription.customer ?? null,
        stripe_subscription_id: subscription.id ?? null,
        status: mapped,
        current_period_start: subscription.current_period_start
          ? new Date(subscription.current_period_start * 1000).toISOString()
          : null,
        current_period_end: subscription.current_period_end
          ? new Date(subscription.current_period_end * 1000).toISOString()
          : null,
      }, { onConflict: "tenant_id" });
    }

    if (eventType === "customer.subscription.deleted") {
      const subscription = event.data.object;
      await supabase
        .from("subscriptions")
        .update({
          status: "canceled",
          stripe_subscription_id: subscription.id ?? null,
        })
        .eq("tenant_id", tenantId);
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
