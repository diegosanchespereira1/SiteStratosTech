import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { handleCors, jsonResponse } from "../_shared/http.ts";
import { writeOperationLog } from "../_shared/ops_log.ts";
import { createAdminClient, getAuthenticatedUserId, getUserTenantId } from "../_shared/supabase.ts";

async function notifyN8nPublish(tenantId: string) {
  const url = (Deno.env.get("N8N_PUBLISH_WEBHOOK_URL") ?? "").trim();
  if (!url) return { sent: false };

  const apiKey = (Deno.env.get("N8N_PUBLISH_API_KEY") ?? "").trim();
  await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(apiKey ? { "x-api-key": apiKey } : {}),
    },
    body: JSON.stringify({
      tenantId,
      event: "publish_agent",
      at: new Date().toISOString(),
    }),
  });

  return { sent: true };
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
    const supabase = createAdminClient();

    const [subscriptionRes, whatsappRes, agentRes, knowledgeRes] = await Promise.all([
      supabase
        .from("subscriptions")
        .select("status")
        .eq("tenant_id", tenantId)
        .maybeSingle(),
      supabase
        .from("whatsapp_instances")
        .select("status")
        .eq("tenant_id", tenantId)
        .eq("status", "connected")
        .limit(1),
      supabase
        .from("agent_configs")
        .select("id, active")
        .eq("tenant_id", tenantId)
        .eq("active", true)
        .maybeSingle(),
      supabase
        .from("knowledge_files")
        .select("id, status")
        .eq("tenant_id", tenantId)
        .eq("status", "ready")
        .limit(1),
    ]);

    const checklist = {
      billing: ["active", "trialing"].includes(subscriptionRes.data?.status ?? ""),
      whatsapp_connection: (whatsappRes.data?.length ?? 0) > 0,
      agent_config: Boolean(agentRes.data?.id),
      knowledge_upload: (knowledgeRes.data?.length ?? 0) > 0,
    };

    const missing = Object.entries(checklist)
      .filter(([, ok]) => !ok)
      .map(([key]) => key);

    if (missing.length > 0) {
      await writeOperationLog({
        tenantId,
        source: "publish-agent",
        level: "warn",
        event: "publish_blocked",
        message: "Requisitos de publicacao nao atendidos.",
        details: { checklist, missing },
      });
      return jsonResponse(400, {
        ok: false,
        error: "Requisitos de publicacao nao atendidos.",
        checklist,
        missing,
      });
    }

    await supabase
      .from("tenants")
      .update({
        automation_enabled: true,
        published_at: new Date().toISOString(),
        publish_notes: "Publicado via onboarding self-service",
      })
      .eq("id", tenantId);

    await supabase
      .from("onboarding_steps")
      .upsert({
        tenant_id: tenantId,
        step_code: "publish",
        status: "completed",
        completed_at: new Date().toISOString(),
      }, { onConflict: "tenant_id,step_code" });

    const n8n = await notifyN8nPublish(tenantId);

    await writeOperationLog({
      tenantId,
      source: "publish-agent",
      level: "info",
      event: "published",
      message: "Tenant publicado com automacao habilitada.",
      details: {
        checklist,
        n8nPublishTriggered: n8n.sent,
      },
    });

    return jsonResponse(200, {
      ok: true,
      tenantId,
      automationEnabled: true,
      publishedAt: new Date().toISOString(),
      checklist,
      n8nPublishTriggered: n8n.sent,
    });
  } catch (error) {
    return jsonResponse(401, { ok: false, error: (error as Error).message });
  }
});
