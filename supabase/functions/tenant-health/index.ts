import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { handleCors, jsonResponse } from "../_shared/http.ts";
import { createAdminClient, getAuthenticatedUserId, getUserTenantId } from "../_shared/supabase.ts";

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

    const [tenantRes, waRes, subRes, logsRes, usageRes] = await Promise.all([
      supabase
        .from("tenants")
        .select("status, automation_enabled, published_at, updated_at")
        .eq("id", tenantId)
        .maybeSingle(),
      supabase
        .from("whatsapp_instances")
        .select("status, last_seen_at")
        .eq("tenant_id", tenantId)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("subscriptions")
        .select("status, current_period_end")
        .eq("tenant_id", tenantId)
        .maybeSingle(),
      supabase
        .from("tenant_operation_logs")
        .select("source, level, event, message, created_at")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })
        .limit(30),
      supabase
        .from("usage_events")
        .select("event_type, created_at")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })
        .limit(20),
    ]);

    const logRows = logsRes.data ?? [];
    const errorLogs = logRows.filter((row) => row.level === "error");
    const warnLogs = logRows.filter((row) => row.level === "warn");

    const latestInbound = (usageRes.data ?? []).find(
      (row) => row.event_type === "whatsapp_inbound_message",
    );

    const scoreParts = [
      tenantRes.data?.status === "active",
      tenantRes.data?.automation_enabled === true,
      ["active", "trialing"].includes(subRes.data?.status ?? ""),
      waRes.data?.status === "connected",
      errorLogs.length === 0,
    ];
    const score = Math.round((scoreParts.filter(Boolean).length / scoreParts.length) * 100);

    return jsonResponse(200, {
      ok: true,
      tenantId,
      score,
      status: {
        tenant: tenantRes.data?.status ?? "unknown",
        automationEnabled: tenantRes.data?.automation_enabled ?? false,
        publishedAt: tenantRes.data?.published_at ?? null,
        subscription: subRes.data?.status ?? "inactive",
        subscriptionPeriodEnd: subRes.data?.current_period_end ?? null,
        whatsapp: waRes.data?.status ?? "disconnected",
        whatsappLastSeenAt: waRes.data?.last_seen_at ?? null,
        lastInboundAt: latestInbound?.created_at ?? null,
      },
      diagnostics: {
        errorCount: errorLogs.length,
        warnCount: warnLogs.length,
        recentErrors: errorLogs.slice(0, 5),
      },
      recentLogs: logRows.slice(0, 10),
    });
  } catch (error) {
    return jsonResponse(401, { ok: false, error: (error as Error).message });
  }
});
