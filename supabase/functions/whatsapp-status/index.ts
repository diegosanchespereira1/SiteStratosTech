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

    const { data, error } = await supabase
      .from("whatsapp_instances")
      .select("id, instance_key, phone_number, status, last_seen_at, metadata")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      return jsonResponse(500, { ok: false, error: error.message });
    }

    if (!data) {
      return jsonResponse(200, {
        ok: true,
        connected: false,
        status: "disconnected",
        instance: null,
      });
    }

    // Sincronizar com a Evolution: consultar estado real para refletir "conectado" após escanear o QR
    const baseUrl = (Deno.env.get("EVOLUTION_API_BASE_URL") ?? "").replace(/\/+$/, "");
    const apiKey = Deno.env.get("EVOLUTION_API_KEY") ?? "";
    let status = data.status;

    if (baseUrl && apiKey && data.instance_key) {
      try {
        const stateResp = await fetch(`${baseUrl}/instance/connectionState/${data.instance_key}`, {
          method: "GET",
          headers: { apikey: apiKey },
        });
        const stateData = await stateResp.json().catch(() => ({}));
        const state = String(stateData?.instance?.state ?? stateData?.state ?? "").toLowerCase();

        if (state === "open") {
          status = "connected";
          await supabase
            .from("whatsapp_instances")
            .update({
              status: "connected",
              metadata: stateData,
              last_seen_at: new Date().toISOString(),
            })
            .eq("instance_key", data.instance_key);
        } else if (state === "close" || state === "closed") {
          status = "disconnected";
          await supabase
            .from("whatsapp_instances")
            .update({
              status: "disconnected",
              metadata: stateData,
              last_seen_at: new Date().toISOString(),
            })
            .eq("instance_key", data.instance_key);
        }
        // Se state vazio ou outro valor, mantemos o status atual do banco
      } catch (_) {
        // Evolution indisponível: retornamos o que temos no banco
      }
    }

    return jsonResponse(200, {
      ok: true,
      connected: status === "connected",
      status,
      instance: {
        id: data.id,
        instanceKey: data.instance_key,
        phoneNumber: data.phone_number,
        lastSeenAt: data.last_seen_at,
      },
      metadata: data.metadata,
    });
  } catch (error) {
    return jsonResponse(401, { ok: false, error: (error as Error).message });
  }
});
