import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { handleCors, jsonResponse } from "../_shared/http.ts";
import { createAdminClient, getAuthenticatedUserId, getUserTenantId } from "../_shared/supabase.ts";

type ReadinessKey =
  | "billing"
  | "whatsapp_connection"
  | "agent_config"
  | "knowledge_upload"
  | "publish";

serve(async (req: Request) => {
  const cors = handleCors(req);
  if (cors) return cors;

  if (req.method !== "GET") {
    return jsonResponse(405, { ok: false, error: "Method not allowed" });
  }

  try {
    const userId = await getAuthenticatedUserId(req);
    const tenantId = await getUserTenantId(userId);
    const supabase = createAdminClient();

    const [subscriptionRes, whatsappRes, agentRes, knowledgeRes, tenantRes] = await Promise.all([
      supabase
        .from("subscriptions")
        .select("status")
        .eq("tenant_id", tenantId)
        .maybeSingle(),
      supabase
        .from("whatsapp_instances")
        .select("id")
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
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("status", "ready")
        .limit(1),
      supabase
        .from("tenants")
        .select("automation_enabled, published_at")
        .eq("id", tenantId)
        .maybeSingle(),
    ]);

    const checklist: Record<ReadinessKey, boolean> = {
      billing: ["active", "trialing"].includes(subscriptionRes.data?.status ?? ""),
      whatsapp_connection: (whatsappRes.data?.length ?? 0) > 0,
      agent_config: Boolean(agentRes.data?.id),
      knowledge_upload: (knowledgeRes.data?.length ?? 0) > 0,
      publish: Boolean(tenantRes.data?.automation_enabled),
    };

    const keys = Object.keys(checklist) as ReadinessKey[];
    const completedCount = keys.filter((k) => checklist[k]).length;
    const total = keys.length;
    const percent = Math.round((completedCount / total) * 100);
    const missing = keys.filter((k) => !checklist[k]);

    const nextActions = missing.map((item) => {
      switch (item) {
        case "billing":
          return "Ativar assinatura no Stripe.";
        case "whatsapp_connection":
          return "Conectar WhatsApp e validar status connected.";
        case "agent_config":
          return "Salvar configuração do agente.";
        case "knowledge_upload":
          return "Subir e processar documento guia.";
        case "publish":
          return "Publicar agente para habilitar automação.";
      }
    });

    return jsonResponse(200, {
      ok: true,
      tenantId,
      checklist,
      completedCount,
      total,
      percent,
      missing,
      nextActions,
      publishedAt: tenantRes.data?.published_at ?? null,
    });
  } catch (error) {
    return jsonResponse(401, { ok: false, error: (error as Error).message });
  }
});
