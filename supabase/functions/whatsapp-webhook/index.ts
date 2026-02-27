import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { handleCors, jsonResponse } from "../_shared/http.ts";
import { writeOperationLog } from "../_shared/ops_log.ts";
import { parseTenantIdFromInstance } from "../_shared/parse_tenant.ts";
import { createAdminClient } from "../_shared/supabase.ts";

serve(async (req: Request) => {
  const cors = handleCors(req);
  if (cors) return cors;

  if (req.method !== "POST") {
    return jsonResponse(405, { ok: false, error: "Method not allowed" });
  }

  // Proteção do webhook Evolution:
  // - Se EVOLUTION_WEBHOOK_SECRET estiver definido, exigir que a URL tenha o formato:
  //   /functions/v1/whatsapp-webhook/<SEGREDO>
  //   onde <SEGREDO> corresponde exatamente ao valor da env.
  // - Se EVOLUTION_WEBHOOK_SECRET estiver em branco, aceitar todas as chamadas (uso apenas para desenvolvimento).
  try {
    const expectedSecret = (Deno.env.get("EVOLUTION_WEBHOOK_SECRET") ?? "").trim();
    if (expectedSecret) {
      const url = new URL(req.url);
      const segments = url.pathname.split("/").filter(Boolean);
      const lastSegment = segments[segments.length - 1] ?? "";

      const hasFunctionSegment = segments.includes("whatsapp-webhook");
      const providedSecret = decodeURIComponent(lastSegment);

      if (!hasFunctionSegment || !providedSecret || providedSecret !== expectedSecret) {
        console.warn("whatsapp-webhook: tentativa de webhook nao autorizada ou segredo invalido.");
        return jsonResponse(401, { ok: false, error: "Evolution webhook nao autorizado" });
      }
    }
  } catch (e) {
    console.error("whatsapp-webhook: erro ao validar segredo", (e as Error).message);
    return jsonResponse(500, { ok: false, error: "Falha na validacao do webhook" });
  }

  try {
    const payload = await req.json().catch(() => ({} as Record<string, unknown>));
    const event = String(payload?.event ?? "").toLowerCase();
    const instanceId = String(payload?.instanceId ?? (payload as Record<string, unknown>)?.data?.instanceId ?? "").trim();
    let instanceKey = String(
      payload?.instance ?? payload?.instanceName ?? payload?.numberId ?? "",
    ).trim();
    let tenantId = parseTenantIdFromInstance(instanceKey);

    const supabase = createAdminClient();

    // Se o payload trouxer só instanceId (UUID) e não tenant_xxx, resolver pelo metadata (evolutionInstanceId)
    if (!tenantId && instanceId) {
      const { data: row } = await supabase
        .from("whatsapp_instances")
        .select("tenant_id, instance_key")
        .filter("metadata->>evolutionInstanceId", "eq", instanceId)
        .limit(1)
        .maybeSingle();
      if (row) {
        tenantId = row.tenant_id;
        instanceKey = row.instance_key ?? instanceKey;
      }
    }

    console.log(JSON.stringify({
      ev: "webhook_received",
      event,
      instanceKey,
      instanceId: instanceId || undefined,
      hasTenant: !!tenantId,
      keys: Object.keys(payload ?? {}),
    }));

    if (!tenantId) {
      return jsonResponse(200, { ok: true, ignored: true, reason: "tenant nao identificado" });
    }

    if (event.includes("connection")) {
      const connectionStatus = String(
        payload?.data?.state ?? payload?.state ?? "connecting",
      ).toLowerCase();
      const mappedStatus =
        connectionStatus.includes("open") || connectionStatus.includes("connected")
          ? "connected"
          : connectionStatus.includes("close") || connectionStatus.includes("disconnected")
            ? "disconnected"
            : connectionStatus.includes("error")
              ? "error"
              : "connecting";

      await supabase
        .from("whatsapp_instances")
        .update({
          status: mappedStatus,
          metadata: payload,
          last_seen_at: new Date().toISOString(),
        })
        .eq("instance_key", instanceKey);

      await writeOperationLog({
        tenantId,
        source: "whatsapp-webhook",
        level: mappedStatus === "error" ? "error" : "info",
        event: "connection_status",
        message: `Status atualizado para ${mappedStatus}.`,
        details: { instanceKey, mappedStatus },
      });

      return jsonResponse(200, { ok: true, tenantId, instanceKey, status: mappedStatus });
    }

    // Evolution v1: payload.data.message/key; v2: payload.message/key no topo; algumas versões: payload.data.messages[0]
    const firstMsg = Array.isArray((payload?.data as Record<string, unknown>)?.messages)
      ? ((payload?.data as Record<string, unknown>)?.messages as Record<string, unknown>[])?.[0]
      : null;
    const msg = firstMsg ?? payload?.data ?? payload;
    const key = (msg as Record<string, unknown>)?.key ?? payload?.key;
    const message = (msg as Record<string, unknown>)?.message ?? payload?.message;
    const fromMe = Boolean((key as Record<string, unknown>)?.fromMe);
    if (fromMe) {
      return jsonResponse(200, { ok: true, ignored: true, reason: "mensagem enviada por nos" });
    }
    const messageText = String(
      (message as Record<string, unknown>)?.conversation ??
        (message as Record<string, unknown>)?.extendedTextMessage?.text ??
        (payload?.data as Record<string, unknown>)?.body ??
        "",
    ).trim();
    const remoteJid = String(
      (key as Record<string, unknown>)?.remoteJid ??
        (payload?.data as Record<string, unknown>)?.from ??
        payload?.from ??
        "",
    ).trim();

    if (!messageText || !remoteJid) {
      return jsonResponse(200, { ok: true, ignored: true, reason: "mensagem nao suportada" });
    }

    // Respeitar publicação do agente: só encaminhar para n8n e responder se automation_enabled
    const { data: tenantRow } = await supabase
      .from("tenants")
      .select("automation_enabled")
      .eq("id", tenantId)
      .maybeSingle();
    const automationEnabled = tenantRow?.automation_enabled === true;

    const { data: instance } = await supabase
      .from("whatsapp_instances")
      .select("id")
      .eq("instance_key", instanceKey)
      .maybeSingle();

    const messageItem = {
      role: "user",
      message: messageText,
      at: new Date().toISOString(),
    };

    const { data: existingConv } = await supabase
      .from("conversations")
      .select("id, messages")
      .eq("tenant_id", tenantId)
      .eq("external_contact_id", remoteJid)
      .eq("channel", "whatsapp")
      .maybeSingle();

    const currentMessages = Array.isArray(existingConv?.messages) ? existingConv.messages : [];
    const mergedMessages = [...currentMessages, messageItem];

    await supabase.from("conversations").upsert({
      id: existingConv?.id,
      tenant_id: tenantId,
      whatsapp_instance_id: instance?.id ?? null,
      external_contact_id: remoteJid,
      channel: "whatsapp",
      last_message_at: new Date().toISOString(),
      messages: mergedMessages,
    }, { onConflict: "tenant_id,external_contact_id,channel" });

    // Contar uso e encaminhar para n8n apenas quando o agente foi publicado
    if (automationEnabled) {
      await supabase.from("usage_events").insert({
        tenant_id: tenantId,
        event_type: "whatsapp_inbound_message",
        quantity: 1,
        metadata: {
          instanceKey,
          remoteJid,
        },
      });
    }

    const isDev = (Deno.env.get("STRATOSBOT_ENV") ?? "").toLowerCase() === "development";
    const n8nWebhookUrl = (
      isDev ? (Deno.env.get("N8N_INGRESS_WEBHOOK_URL_TEST") ?? "") : (Deno.env.get("N8N_INGRESS_WEBHOOK_URL") ?? "")
    ).trim();
    if (automationEnabled && n8nWebhookUrl) {
      const n8nResp = await fetch(n8nWebhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": Deno.env.get("N8N_INGRESS_API_KEY") ?? "",
        },
        body: JSON.stringify({
          tenantId,
          instanceKey,
          channel: "whatsapp",
          externalContactId: remoteJid,
          message: messageText,
          source: "evolution-webhook",
          raw: payload,
        }),
      });

      if (!n8nResp.ok) {
        await writeOperationLog({
          tenantId,
          source: "whatsapp-webhook",
          level: "warn",
          event: "n8n_forward_failed",
          message: "Falha ao encaminhar mensagem para n8n.",
          details: {
            instanceKey,
            remoteJid,
            status: n8nResp.status,
          },
        });
      } else {
        const n8nData = await n8nResp.json().catch(() => ({} as Record<string, unknown>));
        const replyText = String(
          n8nData?.message ?? n8nData?.output ?? (n8nData?.data as Record<string, unknown>)?.message ?? "",
        ).trim();
        if (replyText) {
          const baseUrl = (Deno.env.get("EVOLUTION_API_BASE_URL") ?? "").replace(/\/+$/, "");
          const apiKey = Deno.env.get("EVOLUTION_API_KEY") ?? "";
          if (baseUrl && apiKey) {
            try {
              const sendResp = await fetch(`${baseUrl}/message/sendText/${instanceKey}`, {
                method: "POST",
                headers: { "Content-Type": "application/json", apikey: apiKey },
                body: JSON.stringify({
                  number: remoteJid.includes("@") ? remoteJid : `${remoteJid.replace(/\D/g, "")}@s.whatsapp.net`,
                  text: replyText,
                }),
              });
              if (!sendResp.ok) {
                const errBody = await sendResp.text();
                console.error("whatsapp-webhook: Evolution sendText falhou", sendResp.status, errBody);
                await writeOperationLog({
                  tenantId,
                  source: "whatsapp-webhook",
                  level: "warn",
                  event: "evolution_send_failed",
                  message: "Falha ao enviar resposta para o WhatsApp.",
                  details: { instanceKey, remoteJid, status: sendResp.status, body: errBody },
                });
              }
            } catch (e) {
              console.error("whatsapp-webhook: Evolution sendText erro", (e as Error).message);
            }
          }
          const assistantItem = {
            role: "assistant",
            message: replyText,
            at: new Date().toISOString(),
          };
          await supabase
            .from("conversations")
            .update({
              messages: [...mergedMessages, assistantItem],
              last_message_at: new Date().toISOString(),
            })
            .eq("tenant_id", tenantId)
            .eq("external_contact_id", remoteJid)
            .eq("channel", "whatsapp");
        }
      }
    }

    await writeOperationLog({
      tenantId,
      source: "whatsapp-webhook",
      level: "info",
      event: "inbound_message_saved",
      message: automationEnabled ? "Mensagem inbound persistida e encaminhada." : "Mensagem inbound persistida (agente não publicado, sem resposta).",
      details: {
        instanceKey,
        remoteJid,
        automationEnabled,
      },
    });

    return jsonResponse(200, {
      ok: true,
      tenantId,
      forwardedToN8n: automationEnabled && Boolean(n8nWebhookUrl),
      automationEnabled,
    });
  } catch (error) {
    return jsonResponse(500, { ok: false, error: (error as Error).message });
  }
});
