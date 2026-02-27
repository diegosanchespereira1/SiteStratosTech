import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { handleCors, jsonResponse } from "../_shared/http.ts";
import { createAdminClient, getAuthenticatedUserId, getUserTenantId } from "../_shared/supabase.ts";

interface AgentConfigBody {
  assistantName?: string;
  objective?: string;
  tone?: string;
  allowedTopics?: string[];
  blockedTopics?: string[];
  responseGuidelines?: string;
  fallbackHuman?: string;
  active?: boolean;
}

serve(async (req: Request) => {
  const cors = handleCors(req);
  if (cors) return cors;

  try {
    const userId = await getAuthenticatedUserId(req);
    const tenantId = await getUserTenantId(userId);
    const supabase = createAdminClient();

    if (req.method === "GET") {
      const { data, error } = await supabase
        .from("agent_configs")
        .select("*")
        .eq("tenant_id", tenantId)
        .maybeSingle();

      if (error) {
        return jsonResponse(500, { ok: false, error: error.message });
      }

      if (!data) {
        return jsonResponse(200, {
          ok: true,
          config: {
            tenant_id: tenantId,
            assistant_name: "Assistente",
            objective: null,
            tone: "profissional",
            allowed_topics: [],
            blocked_topics: [],
            response_guidelines: null,
            fallback_human: null,
            active: true,
          },
        });
      }

      return jsonResponse(200, { ok: true, config: data });
    }

    if (req.method === "PUT") {
      const body = (await req.json().catch(() => ({}))) as AgentConfigBody;
      const payload = {
        tenant_id: tenantId,
        assistant_name: String(body.assistantName ?? "Assistente").slice(0, 120),
        objective: body.objective ?? null,
        tone: String(body.tone ?? "profissional").slice(0, 60),
        allowed_topics: Array.isArray(body.allowedTopics) ? body.allowedTopics.slice(0, 100) : [],
        blocked_topics: Array.isArray(body.blockedTopics) ? body.blockedTopics.slice(0, 100) : [],
        response_guidelines: body.responseGuidelines ?? null,
        fallback_human: body.fallbackHuman ?? null,
        active: body.active ?? true,
      };

      const { data, error } = await supabase
        .from("agent_configs")
        .upsert(payload, { onConflict: "tenant_id" })
        .select("*")
        .maybeSingle();

      if (error) {
        return jsonResponse(500, { ok: false, error: error.message });
      }

      return jsonResponse(200, { ok: true, config: data });
    }

    return jsonResponse(405, { ok: false, error: "Method not allowed" });
  } catch (error) {
    return jsonResponse(401, { ok: false, error: (error as Error).message });
  }
});
