import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";
import { handleCors, jsonResponse } from "../_shared/http.ts";

const MAX_EMAIL_LEN = 254;

/** Primeira tentativa: captura 4xx do GoTrue (redirect inválido, etc.) antes de responder 200. */
const QUICK_RECOVER_MS = 22_000;
/** Tarefa em background se SMTP demora ou GoTrue devolve 504 na tentativa rápida. */
const BG_RECOVER_MS = 120_000;
/** Sem EdgeRuntime.waitUntil: espera única. */
const SYNC_RECOVER_MS = 90_000;

type EdgeRuntimeGlobal = { waitUntil: (p: Promise<unknown>) => void };
function getEdgeRuntime(): EdgeRuntimeGlobal | undefined {
  return (globalThis as { EdgeRuntime?: EdgeRuntimeGlobal }).EdgeRuntime;
}

async function callRecover(
  recoverUrlStr: string,
  recoverPayload: Record<string, string>,
  anon: string,
  ms: number,
): Promise<Response> {
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(recoverUrlStr, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: anon,
        Authorization: `Bearer ${anon}`,
      },
      body: JSON.stringify(recoverPayload),
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(tid);
  }
}

function recoverErrorMessage(res: Response, txt: string): string {
  let j: Record<string, unknown> = {};
  try {
    if (txt) j = JSON.parse(txt) as Record<string, unknown>;
  } catch {
    /* ignore */
  }
  return (
    (typeof j.error_description === "string" && j.error_description) ||
    (typeof j.message === "string" && j.message) ||
    (typeof j.msg === "string" && j.msg) ||
    (typeof j.error === "string" && j.error) ||
    `Erro ao solicitar recuperação (HTTP ${res.status}). Verifique Redirect URLs no Supabase (Authentication → URL Configuration).`
  );
}

function scheduleBgRecover(
  edge: EdgeRuntimeGlobal,
  recoverUrlStr: string,
  recoverPayload: Record<string, string>,
  anon: string,
  emailHint: string,
): void {
  edge.waitUntil(
    (async () => {
      try {
        console.log("[password-reset-request] bg POST /auth/v1/recover for", emailHint);
        const res = await callRecover(recoverUrlStr, recoverPayload, anon, BG_RECOVER_MS);
        const txt = res.ok ? "" : await res.text();
        console.log(
          "[password-reset-request] bg recover HTTP",
          res.status,
          res.ok ? "ok" : txt.slice(0, 600),
        );
      } catch (e) {
        console.error("[password-reset-request] bg recover threw", emailHint, e);
      }
    })(),
  );
}

function isValidEmail(s: string): boolean {
  if (!s || s.length > MAX_EMAIL_LEN) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

serve(async (req: Request) => {
  const cors = handleCors(req);
  if (cors) return cors;

  if (req.method !== "POST") {
    return jsonResponse(405, { ok: false, error: "METHOD_NOT_ALLOWED" });
  }

  try {
    const body = (await req.json().catch(() => ({}))) as {
      email?: string;
      redirectTo?: string;
    };
    const email = String(body?.email ?? "").trim();
    const redirectTo = String(body?.redirectTo ?? "").trim();

    if (!isValidEmail(email)) {
      return jsonResponse(400, {
        ok: false,
        error: "INVALID_EMAIL",
        message: "Informe um e-mail válido.",
      });
    }

    const sbUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!sbUrl || !serviceRole) {
      console.error("[password-reset-request] ausente SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY (secrets da Edge Function)");
      return jsonResponse(500, {
        ok: false,
        error: "SERVER_CONFIG",
        message:
          "Configuração do servidor: defina os secrets SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY em Project Settings → Edge Functions → Secrets e faça redeploy da função.",
      });
    }
    const supabase = createClient(sbUrl, serviceRole);
    const { data: exists, error: rpcError } = await supabase.rpc(
      "check_auth_user_email_exists",
      { p_email: email },
    );

    if (rpcError) {
      console.error("[password-reset-request] rpc check_auth_user_email_exists", rpcError);
      const rpcHint = [rpcError.message, rpcError.code].filter(Boolean).join(" — ");
      return jsonResponse(500, {
        ok: false,
        error: "CHECK_FAILED",
        message: rpcHint
          ? `Não foi possível verificar o e-mail (${rpcHint}). Confira se a função check_auth_user_email_exists existe e se o secret SUPABASE_SERVICE_ROLE_KEY está correto.`
          : "Não foi possível verificar o e-mail. Tente novamente.",
      });
    }

    if (!exists) {
      return jsonResponse(404, {
        ok: false,
        error: "EMAIL_NOT_FOUND",
        message: "Não encontramos uma conta com esse e-mail.",
      });
    }

    const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    if (!anon) {
      return jsonResponse(500, {
        ok: false,
        error: "SERVER_CONFIG",
        message:
          "Defina o secret SUPABASE_ANON_KEY na Edge Function (além do service role) para chamar /auth/v1/recover.",
      });
    }

    const base = sbUrl.replace(/\/+$/, "");
    const recoverUrl = new URL(`${base}/auth/v1/recover`);
    if (redirectTo) recoverUrl.searchParams.set("redirect_to", redirectTo);

    const recoverPayload: Record<string, string> = { email };
    if (redirectTo) recoverPayload.redirect_to = redirectTo;
    const recoverUrlStr = recoverUrl.toString();
    const emailHint = email.slice(0, 3) + "***";

    const edge = getEdgeRuntime();
    if (edge && typeof edge.waitUntil === "function") {
      try {
        let first: Response;
        try {
          console.log("[password-reset-request] quick POST /auth/v1/recover", emailHint);
          first = await callRecover(recoverUrlStr, recoverPayload, anon, QUICK_RECOVER_MS);
        } catch (qe) {
          if (qe instanceof Error && qe.name === "AbortError") {
            console.warn("[password-reset-request] quick recover timeout → bg", emailHint);
            scheduleBgRecover(edge, recoverUrlStr, recoverPayload, anon, emailHint);
            return jsonResponse(200, {
              ok: true,
              pendingDelivery: true,
              message:
                "O envio está demorando; continuamos em segundo plano. Em 1–2 minutos confira o e-mail e o spam. Se não chegar: Authentication → SMTP, Redirect URLs e logs da função (linha bg recover HTTP).",
            });
          }
          throw qe;
        }

        if (first.ok) {
          console.log("[password-reset-request] quick recover OK", emailHint);
          return jsonResponse(200, {
            ok: true,
            emailDispatchConfirmed: true,
            message:
              "O servidor de autenticação aceitou o envio. Você deve receber o link em instantes. Confira spam e promoções.",
          });
        }

        const quickTxt = await first.text();
        console.error("[password-reset-request] quick recover failed", first.status, quickTxt.slice(0, 600));

        if (first.status === 504 || first.status === 503 || first.status >= 500) {
          scheduleBgRecover(edge, recoverUrlStr, recoverPayload, anon, emailHint);
          return jsonResponse(200, {
            ok: true,
            pendingDelivery: true,
            message:
              "O auth demorou a responder (504/erro temporário); tentamos de novo em segundo plano. Confira o e-mail em alguns minutos e os logs da função (bg recover HTTP).",
          });
        }

        const desc = recoverErrorMessage(first, quickTxt);
        return jsonResponse(first.status >= 400 && first.status < 600 ? first.status : 502, {
          ok: false,
          error: "RECOVER_FAILED",
          message: desc,
        });
      } catch (waitErr) {
        console.error("[password-reset-request] ramo Edge falhou; sync longo", waitErr);
        /* cai no sync abaixo */
      }
    }

    let res: Response;
    try {
      console.log("[password-reset-request] sync POST /auth/v1/recover for", emailHint);
      res = await callRecover(recoverUrlStr, recoverPayload, anon, SYNC_RECOVER_MS);
      console.log("[password-reset-request] recover HTTP", res.status);
    } catch (fe) {
      if (fe instanceof Error && fe.name === "AbortError") {
        return jsonResponse(504, {
          ok: false,
          error: "RECOVER_TIMEOUT",
          message:
            "O envio do e-mail está demorando demais. Em Authentication → SMTP, confira o provedor; em URL Configuration, inclua o redirect usado no pedido.",
        });
      }
      throw fe;
    }

    if (!res.ok) {
      const txt = await res.text();
      console.error("[password-reset-request] recover failed", res.status, txt.slice(0, 500));
      return jsonResponse(res.status >= 400 && res.status < 600 ? res.status : 502, {
        ok: false,
        error: "RECOVER_FAILED",
        message: recoverErrorMessage(res, txt),
      });
    }

    return jsonResponse(200, {
      ok: true,
      message:
        "O pedido foi aceito pelo servidor de autenticação. Em instantes você deve receber o link no e-mail informado. Confira a caixa de spam. Se não chegar, verifique Authentication → SMTP e Redirect URLs no Supabase.",
    });
  } catch (e) {
    console.error("[password-reset-request]", e);
    return jsonResponse(500, {
      ok: false,
      error: "INTERNAL",
      message: "Erro inesperado. Tente novamente.",
    });
  }
});
