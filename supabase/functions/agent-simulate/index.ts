import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { handleCors, jsonResponse } from "../_shared/http.ts";
import { createAdminClient, getAuthenticatedUserId, getUserTenantId } from "../_shared/supabase.ts";

interface SimulateBody {
  message?: string;
}

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const DEFAULT_MODEL = "gpt-4o-mini";
const MAX_CONTEXT_CHARS = 6000;

serve(async (req: Request) => {
  const cors = handleCors(req);
  if (cors) return cors;

  if (req.method !== "POST") {
    return jsonResponse(405, { ok: false, error: "Method not allowed" });
  }

  try {
    const apiKey = Deno.env.get("OPENAI_API_KEY");
    if (!apiKey?.trim()) {
      return jsonResponse(503, {
        ok: false,
        error: "Simulacao com IA nao configurada (OPENAI_API_KEY ausente).",
      });
    }

    const userId = await getAuthenticatedUserId(req);
    const tenantId = await getUserTenantId(userId);
    const body = (await req.json().catch(() => ({}))) as SimulateBody;
    const message = String(body.message ?? "").trim();

    if (!message) {
      return jsonResponse(400, { ok: false, error: "message e obrigatoria." });
    }

    const supabase = createAdminClient();

    const [{ data: config }, { data: chunksData }] = await Promise.all([
      supabase
        .from("agent_configs")
        .select("assistant_name, tone, objective, response_guidelines")
        .eq("tenant_id", tenantId)
        .maybeSingle(),
      supabase
        .from("knowledge_chunks")
        .select("content")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })
        .limit(12)
        .then((r) => r),
    ]);

    const assistantName = config?.assistant_name ?? "Assistente";
    const tone = config?.tone ?? "profissional";
    const objective = config?.objective?.trim() ?? "";
    const guidelines = config?.response_guidelines?.trim() ?? "";

    const chunks = (chunksData ?? []).map((c: { content?: string }) => c?.content ?? "").filter(Boolean);
    let contextBlock = chunks.length === 0
      ? "Contexto do documento: ainda nao processado."
      : chunks.join("\n\n").slice(0, MAX_CONTEXT_CHARS);
    if (chunks.join("").length > MAX_CONTEXT_CHARS) {
      contextBlock += "\n[...]";
    }

    const systemParts: string[] = [
      `Voce e o assistente "${assistantName}".`,
      `Tom de voz: ${tone}.`,
      objective ? `Objetivo: ${objective}` : "",
      guidelines ? `Diretrizes de resposta: ${guidelines}` : "Seja objetivo e util.",
      "",
      "Base de conhecimento (use para fundamentar suas respostas):",
      contextBlock,
    ];
    const systemPrompt = systemParts.filter(Boolean).join("\n");

    const model = Deno.env.get("OPENAI_SIMULATE_MODEL")?.trim() || DEFAULT_MODEL;
    const res = await fetch(OPENAI_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: message },
        ],
        max_tokens: 1024,
        temperature: 0.7,
      }),
    });

    if (!res.ok) {
      const errBody = await res.text();
      let errMsg = `OpenAI API error: ${res.status}`;
      try {
        const j = JSON.parse(errBody);
        if (j.error?.message) errMsg = j.error.message;
      } catch {
        if (errBody.length < 200) errMsg = errBody;
      }
      return jsonResponse(502, { ok: false, error: errMsg });
    }

    const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
    const reply = data?.choices?.[0]?.message?.content?.trim() ?? "";

    return jsonResponse(200, {
      ok: true,
      tenantId,
      reply: reply || "Sem resposta gerada.",
      source: "agent-simulate",
    });
  } catch (error) {
    const msg = (error as Error).message ?? String(error);
    const isAuthError = /token bearer|usuario nao autenticado|nenhum tenant/i.test(msg);
    const status = isAuthError ? 401 : 500;
    let userMessage = msg;
    if (isAuthError) {
      if (/nenhum tenant/i.test(msg)) {
        userMessage = "Sua conta ainda não tem um espaço (empresa). Faça logout, cadastre-se novamente ou entre em contato com o suporte.";
      } else {
        userMessage = "Sessão inválida ou expirada. Faça login novamente.";
      }
    }
    return jsonResponse(status, { ok: false, error: userMessage });
  }
});
