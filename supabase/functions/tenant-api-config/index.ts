import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { handleCors, jsonResponse } from "../_shared/http.ts";
import { decryptSecret, encryptSecret } from "../_shared/secrets_crypto.ts";
import { createAdminClient, getAuthenticatedUserId, getUserTenantId } from "../_shared/supabase.ts";

interface TenantApiConfigBody {
  apiBaseUrl?: string;
  apiToken?: string;
}

function maskToken(token?: string | null): string | null {
  if (!token) return null;
  const tail = token.slice(-4);
  return `****${tail}`;
}

async function resolveTokenForMask(
  encryptedToken: string | null,
  legacyToken: string | null,
  passphrase: string,
): Promise<string | null> {
  if (encryptedToken) {
    try {
      return await decryptSecret(encryptedToken, passphrase);
    } catch {
      return null;
    }
  }
  return legacyToken ?? null;
}

serve(async (req: Request) => {
  const cors = handleCors(req);
  if (cors) return cors;

  try {
    const userId = await getAuthenticatedUserId(req);
    const tenantId = await getUserTenantId(userId);
    const supabase = createAdminClient();
    const encryptionPassphrase = Deno.env.get("TENANT_TOKEN_ENCRYPTION_KEY") ?? "";
    if (!encryptionPassphrase) {
      return jsonResponse(500, {
        ok: false,
        error: "TENANT_TOKEN_ENCRYPTION_KEY nao configurada.",
      });
    }

    if (req.method === "GET") {
      const { data, error } = await supabase
        .from("tenant_api_configs")
        .select("api_base_url, api_token, api_token_encrypted, updated_at")
        .eq("tenant_id", tenantId)
        .maybeSingle();

      if (error) {
        return jsonResponse(500, { ok: false, error: error.message });
      }

      const tokenRaw = await resolveTokenForMask(
        data?.api_token_encrypted ?? null,
        data?.api_token ?? null,
        encryptionPassphrase,
      );

      return jsonResponse(200, {
        ok: true,
        config: {
          apiBaseUrl: data?.api_base_url ?? null,
          hasToken: Boolean(tokenRaw),
          tokenMasked: maskToken(tokenRaw),
          updatedAt: data?.updated_at ?? null,
        },
      });
    }

    if (req.method === "PUT") {
      const body = (await req.json().catch(() => ({}))) as TenantApiConfigBody;
      const apiBaseUrl = String(body.apiBaseUrl ?? "").trim();
      const apiToken = String(body.apiToken ?? "").trim();

      if (!apiBaseUrl) {
        return jsonResponse(400, { ok: false, error: "apiBaseUrl e obrigatorio." });
      }

      const { data: current } = await supabase
        .from("tenant_api_configs")
        .select("api_token, api_token_encrypted")
        .eq("tenant_id", tenantId)
        .maybeSingle();

      const currentPlain = await resolveTokenForMask(
        current?.api_token_encrypted ?? null,
        current?.api_token ?? null,
        encryptionPassphrase,
      );

      const nextToken = apiToken || currentPlain || null;
      const nextEncrypted = nextToken
        ? await encryptSecret(nextToken, encryptionPassphrase)
        : null;

      const payload = {
        tenant_id: tenantId,
        api_base_url: apiBaseUrl,
        api_token: null, // deprecated plaintext storage
        api_token_encrypted: nextEncrypted,
      };

      const { data, error } = await supabase
        .from("tenant_api_configs")
        .upsert(payload, { onConflict: "tenant_id" })
        .select("api_base_url, api_token_encrypted, updated_at")
        .maybeSingle();

      if (error) {
        return jsonResponse(500, { ok: false, error: error.message });
      }

      const savedPlain = data?.api_token_encrypted
        ? await decryptSecret(data.api_token_encrypted, encryptionPassphrase).catch(() => null)
        : null;

      return jsonResponse(200, {
        ok: true,
        config: {
          apiBaseUrl: data?.api_base_url ?? null,
          hasToken: Boolean(savedPlain),
          tokenMasked: maskToken(savedPlain),
          updatedAt: data?.updated_at ?? null,
        },
      });
    }

    return jsonResponse(405, { ok: false, error: "Method not allowed" });
  } catch (error) {
    return jsonResponse(401, { ok: false, error: (error as Error).message });
  }
});
