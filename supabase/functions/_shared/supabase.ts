import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";

export function createAdminClient() {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  if (!url || !serviceRole) {
    throw new Error("SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY sao obrigatorios.");
  }

  return createClient(url, serviceRole);
}

export async function getAuthenticatedUserId(req: Request): Promise<string> {
  const authHeader = req.headers.get("authorization") ?? "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) {
    throw new Error("Token Bearer ausente.");
  }

  const jwt = authHeader.slice(7).trim();
  if (!jwt) {
    throw new Error("Token Bearer invalido.");
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase.auth.getUser(jwt);
  if (error || !data?.user?.id) {
    throw new Error("Usuario nao autenticado.");
  }
  return data.user.id;
}

export async function getUserTenantId(userId: string): Promise<string> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("tenant_members")
    .select("tenant_id")
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error || !data?.tenant_id) {
    throw new Error("Nenhum tenant encontrado para o usuario.");
  }

  return data.tenant_id as string;
}
