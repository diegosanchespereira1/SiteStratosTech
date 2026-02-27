import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { handleCors, jsonResponse } from "../_shared/http.ts";
import { createAdminClient, getAuthenticatedUserId, getUserTenantId } from "../_shared/supabase.ts";

function getClientIp(req: Request): string | null {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  const real = req.headers.get("x-real-ip");
  if (real) return real.trim();
  return null;
}

serve(async (req: Request) => {
  const cors = handleCors(req);
  if (cors) return cors;

  if (req.method !== "POST" && req.method !== "GET") {
    return jsonResponse(405, { ok: false, error: "Method not allowed" });
  }

  try {
    const userId = await getAuthenticatedUserId(req);
    let tenantId: string | null = null;
    try {
      tenantId = await getUserTenantId(userId);
    } catch {
      // usuário ainda sem tenant (ex.: logo após signup, antes de provision-tenant)
    }

    const supabase = createAdminClient();
    const { error } = await supabase.from("auth_login_log").insert({
      user_id: userId,
      tenant_id: tenantId,
      ip: getClientIp(req),
      user_agent: req.headers.get("user-agent")?.slice(0, 500) ?? null,
    });

    if (error) {
      return jsonResponse(500, { ok: false, error: error.message });
    }

    return jsonResponse(200, { ok: true, logged: true });
  } catch (error) {
    return jsonResponse(401, { ok: false, error: (error as Error).message });
  }
});
