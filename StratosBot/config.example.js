/**
 * Configuração do Supabase para o onboarding (sessão automática e evitar 401).
 * Copie para config.js e preencha com os dados do seu projeto.
 *
 * Onde achar: Supabase Dashboard → Project Settings → API
 * - Project URL → SUPABASE_URL
 * - anon public → SUPABASE_ANON_KEY
 *
 * Produção: é seguro usar a anon key no frontend. Ela é feita para isso.
 * O Supabase protege os dados com RLS; a service_role key é que NUNCA deve ir no cliente.
 *
 * URL do webhook do n8n (mensagens WhatsApp → n8n): NÃO vai aqui.
 * Configure no Supabase: Edge Functions → Secrets → N8N_INGRESS_WEBHOOK_URL
 * (ex.: https://webhook.stratostech.com.br/webhook/stratosbotsaas)
 */
(function () {
  "use strict";
  window.SUPABASE_URL = "";       // ex: "https://SEU_PROJECT_REF.supabase.co"
  window.SUPABASE_ANON_KEY = "";  // chave anon public do projeto
})();
