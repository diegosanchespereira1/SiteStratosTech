import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { handleCors, jsonResponse } from "../_shared/http.ts";
import { createAdminClient, getAuthenticatedUserId } from "../_shared/supabase.ts";

function slugFromName(name: string): string {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "empresa";
  return base.length > 60 ? base.slice(0, 60) : base;
}

serve(async (req: Request) => {
  const cors = handleCors(req);
  if (cors) return cors;

  if (req.method !== "POST") {
    return jsonResponse(405, { ok: false, error: "Method not allowed" });
  }

  try {
    const userId = await getAuthenticatedUserId(req);
    const body = (await req.json().catch(() => ({}))) as { companyName?: string };
    const companyName = String(body?.companyName ?? "").trim() || "Minha Empresa";

    const supabase = createAdminClient();

    const { data: existing } = await supabase
      .from("tenant_members")
      .select("tenant_id")
      .eq("user_id", userId)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (existing?.tenant_id) {
      return jsonResponse(200, {
        ok: true,
        alreadyHadTenant: true,
        tenantId: existing.tenant_id,
      });
    }

    const baseSlug = slugFromName(companyName);
    let slug = baseSlug;
    let attempts = 0;
    while (attempts < 10) {
      const { data: conflict } = await supabase
        .from("tenants")
        .select("id")
        .eq("slug", slug)
        .maybeSingle();
      if (!conflict) break;
      slug = `${baseSlug}-${crypto.randomUUID().slice(0, 8)}`;
      attempts++;
    }

    const { data: tenant, error: tenantError } = await supabase
      .from("tenants")
      .insert({
        name: companyName,
        slug,
        owner_user_id: userId,
        status: "active",
      })
      .select("id")
      .single();

    if (tenantError || !tenant?.id) {
      return jsonResponse(500, {
        ok: false,
        error: "Falha ao criar tenant.",
        details: tenantError?.message,
      });
    }

    const { error: memberError } = await supabase.from("tenant_members").insert({
      tenant_id: tenant.id,
      user_id: userId,
      role: "owner",
    });

    if (memberError) {
      await supabase.from("tenants").delete().eq("id", tenant.id);
      return jsonResponse(500, {
        ok: false,
        error: "Falha ao vincular usuário ao tenant.",
        details: memberError.message,
      });
    }

    const { data: starterPlan } = await supabase
      .from("plans")
      .select("id")
      .eq("code", "starter")
      .eq("active", true)
      .maybeSingle();

    if (starterPlan?.id) {
      await supabase.from("subscriptions").insert({
        tenant_id: tenant.id,
        plan_id: starterPlan.id,
        status: "inactive",
      });
    }

    return jsonResponse(200, {
      ok: true,
      alreadyHadTenant: false,
      tenantId: tenant.id,
      tenantName: companyName,
      slug,
    });
  } catch (error) {
    return jsonResponse(500, { ok: false, error: (error as Error).message });
  }
});
