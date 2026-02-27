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
      .from("knowledge_files")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false });

    if (error) {
      return jsonResponse(500, { ok: false, error: error.message });
    }

    return jsonResponse(200, { ok: true, files: data ?? [] });
  } catch (error) {
    return jsonResponse(401, { ok: false, error: (error as Error).message });
  }
});
