import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { handleCors, jsonResponse } from "../_shared/http.ts";
import { createAdminClient, getAuthenticatedUserId, getUserTenantId } from "../_shared/supabase.ts";

async function setEvolutionWebhook(
  baseUrl: string,
  apiKey: string,
  instanceKey: string,
  webhookUrl: string,
): Promise<{ ok: boolean; instanceId?: string; status?: number; error?: string }> {
  if (!webhookUrl || webhookUrl.includes("undefined")) {
    console.error("whatsapp-connect: webhook URL invalida (defina SUPABASE_URL nos secrets ou use requisicao pelo dominio do projeto)");
    return { ok: false, error: "webhook URL invalida" };
  }
  try {
    const webhookBody = {
      url: webhookUrl,
      enabled: true,
      webhookByEvents: false,
      webhookBase64: false,
      events: ["QRCODE_UPDATED", "CONNECTION_UPDATE", "MESSAGES_UPSERT", "MESSAGES_UPDATE", "MESSAGES_DELETE", "SEND_MESSAGE"],
    };
    const res = await fetch(`${baseUrl}/webhook/set/${instanceKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: apiKey },
      body: JSON.stringify({ webhook: webhookBody }),
    });
    const body = await res.text();
    if (!res.ok) {
      console.error("whatsapp-connect: Evolution webhook/set falhou", res.status, body);
      return { ok: false, status: res.status, error: body };
    }
    const data = (JSON.parse(body || "{}") as { instanceId?: string });
    const instanceId = data?.instanceId;
    console.log("whatsapp-connect: webhook configurado na Evolution", instanceKey, instanceId || "");
    return { ok: true, instanceId };
  } catch (e) {
    console.error("whatsapp-connect: Evolution webhook/set erro", (e as Error).message);
    return { ok: false, error: (e as Error).message };
  }
}

interface ConnectBody {
  phoneNumber?: string;
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
    const body = (await req.json().catch(() => ({}))) as ConnectBody;

    const baseUrl = (Deno.env.get("EVOLUTION_API_BASE_URL") ?? "").replace(/\/+$/, "");
    const apiKey = Deno.env.get("EVOLUTION_API_KEY") ?? "";
    if (!baseUrl || !apiKey) {
      return jsonResponse(500, { ok: false, error: "Evolution API nao configurada." });
    }

    const supabase = createAdminClient();
    const instanceKey = `tenant_${tenantId.replace(/-/g, "")}`;
    // URL do webhook: SUPABASE_URL nos secrets ou origem da própria requisição (evita webhook não configurado)
    const baseSupabase = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/+$/, "") || new URL(req.url).origin;
    const webhookUrl = `${baseSupabase}/functions/v1/whatsapp-webhook`;

    // 1) Criar ou garantir instância na Evolution.
    const createResp = await fetch(`${baseUrl}/instance/create`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: apiKey,
      },
      body: JSON.stringify({
        instanceName: instanceKey,
        qrcode: true,
        integration: "WHATSAPP-BAILEYS",
      }),
    });

    const createData = await createResp.json().catch(() => ({}));
    const createMsg = String(createData?.message ?? createData?.error ?? "").toLowerCase();
    const createBodyStr = JSON.stringify(createData).toLowerCase();
    const createOk =
      createResp.ok ||
      createMsg.includes("already") ||
      createMsg.includes("exist") ||
      createMsg.includes("já existe") ||
      createMsg.includes("duplicate") ||
      createBodyStr.includes("already") ||
      createBodyStr.includes("already exists");

    // 2) Obter QR ou estado (sempre chamar connect: se a instância já existir, retorna QR ou estado).
    const connectResp = await fetch(`${baseUrl}/instance/connect/${instanceKey}`, {
      method: "GET",
      headers: { apikey: apiKey },
    });

    const connectData = await connectResp.json().catch(() => ({}));
    const hasQr = !!(connectData?.base64 ?? connectData?.qrcode);

    if (connectResp.ok && hasQr) {
      // Tem QR: sucesso (instância nova ou já existente); webhook configurado no bloco comum abaixo.
    } else if (!connectResp.ok && !createOk) {
      return jsonResponse(502, { ok: false, error: "Falha ao criar instancia no Evolution.", details: createData });
    } else if (connectResp.ok && !hasQr) {
      // Sem QR: já conectado ou QR expirado.
      const stateResp = await fetch(`${baseUrl}/instance/connectionState/${instanceKey}`, {
        method: "GET",
        headers: { apikey: apiKey },
      });
      const stateData = await stateResp.json().catch(() => ({}));
      const state = String(stateData?.instance?.state ?? stateData?.state ?? "").toLowerCase();

      if (state === "open") {
        const webhookResult = await setEvolutionWebhook(baseUrl, apiKey, instanceKey, webhookUrl);
        const meta = { ...(stateData as Record<string, unknown>), ...(webhookResult.instanceId && { evolutionInstanceId: webhookResult.instanceId }) };
        await supabase.from("whatsapp_instances").upsert({
          tenant_id: tenantId,
          provider: "evolution",
          instance_key: instanceKey,
          phone_number: body.phoneNumber ?? null,
          status: "connected",
          metadata: meta,
          last_seen_at: new Date().toISOString(),
        }, { onConflict: "instance_key" });
        return jsonResponse(200, {
          ok: true,
          tenantId,
          instanceKey,
          status: "connected",
          qrCode: null,
          pairingCode: null,
        });
      }
      const webhookResult = await setEvolutionWebhook(baseUrl, apiKey, instanceKey, webhookUrl);
      if (webhookResult.instanceId) {
        const { data: row } = await supabase.from("whatsapp_instances").select("metadata").eq("instance_key", instanceKey).maybeSingle();
        await supabase.from("whatsapp_instances").update({
          metadata: { ...(row?.metadata as Record<string, unknown> ?? {}), evolutionInstanceId: webhookResult.instanceId },
          last_seen_at: new Date().toISOString(),
        }).eq("instance_key", instanceKey);
      }
      return jsonResponse(200, {
        ok: true,
        tenantId,
        instanceKey,
        status: "expired",
        qrCode: null,
        pairingCode: null,
      });
    } else if (!connectResp.ok) {
      return jsonResponse(502, { ok: false, error: "Falha ao obter QR da instancia no Evolution.", details: connectData });
    }

    // connectResp.ok && hasQr: instância existe e tem QR (nova ou já existente).
    const webhookResult = await setEvolutionWebhook(baseUrl, apiKey, instanceKey, webhookUrl);
    const meta = { ...(connectData as Record<string, unknown>), ...(webhookResult.instanceId && { evolutionInstanceId: webhookResult.instanceId }) };
    await supabase.from("whatsapp_instances").upsert({
      tenant_id: tenantId,
      provider: "evolution",
      instance_key: instanceKey,
      phone_number: body.phoneNumber ?? null,
      status: "connecting",
      metadata: meta,
      last_seen_at: new Date().toISOString(),
    }, { onConflict: "instance_key" });

    return jsonResponse(200, {
      ok: true,
      tenantId,
      instanceKey,
      status: "connecting",
      qrCode: connectData?.base64 ?? connectData?.qrcode ?? null,
      pairingCode: connectData?.pairingCode ?? null,
      raw: connectData,
    });
  } catch (error) {
    return jsonResponse(500, { ok: false, error: (error as Error).message });
  }
});
