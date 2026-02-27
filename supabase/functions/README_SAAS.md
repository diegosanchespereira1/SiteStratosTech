# SaaS Edge Functions (StratosBot)

Este diretório contém a base inicial dos endpoints para o SaaS self-service:

- `create-checkout-session`: cria checkout no Stripe.
- `stripe-webhook`: processa eventos Stripe e atualiza assinatura.
- `onboarding-status`: consulta/marca progresso do onboarding.
- `whatsapp-connect`: cria/conecta instância no Evolution.
- `whatsapp-status`: consulta estado atual da conexão WhatsApp.
- `whatsapp-webhook`: recebe eventos do Evolution, salva histórico e encaminha para n8n.
- `agent-config`: leitura e atualização da configuração do agente por tenant.
- `knowledge-upload`: cadastro/upload de documento guia.
- `knowledge-list`: lista documentos guia do tenant.
- `knowledge-process`: processa documento em chunks para contexto.
- `agent-simulate`: retorna resposta real do agente de IA (OpenAI) usando config + base de conhecimento do tenant.
- `publish-agent`: valida prontidão e ativa automação do tenant.
- `tenant-readiness`: retorna checklist e percentual de prontidão do tenant.
- `tenant-health`: diagnóstico operacional com score, status e erros recentes.
- `tenant-api-config`: salva/carrega configuração da API do tenant no banco com token mascarado.
- `provision-tenant`: após cadastro (signUp), cria tenant + tenant_member + subscription (starter) para o usuário. POST com JWT; body: `{ companyName }`.
- `log-session`: registra login/sessão em `auth_login_log` (user_id, tenant_id, IP, user_agent) para rastreabilidade. POST com JWT.

## Onde configurar os secrets (Super Admin)

As variáveis das Edge Functions **não** ficam em "Edge Functions" → código; ficam em **Secrets**:

1. No [Supabase Dashboard](https://supabase.com/dashboard), abra o projeto.
2. Menu lateral: **Project Settings** (ícone de engrenagem).
3. Na barra lateral de configurações: **Edge Functions**.
4. Aba **Secrets** (ou "Environment variables" / "Manage secrets").
5. Adicione cada variável (Key + Value) e salve.

Alternativa via CLI (a partir da raiz do repo, com projeto linkado):

```bash
supabase secrets set --env-file supabase/functions/.env
```

Use o arquivo `supabase/functions/.env.example` como referência; copie para `.env`, preencha os valores e **não** faça commit do `.env`.

### Checklist Evolution API

1. **Secrets no Supabase:** `EVOLUTION_API_BASE_URL`, `EVOLUTION_API_KEY`. Com Evolution v2, **não** definir `EVOLUTION_WEBHOOK_SECRET` (a v2 não permite configurar headers no webhook).
2. **whatsapp-webhook** deve ser implantada **sem verificação JWT** para a Evolution conseguir chamar sem header `Authorization`: `supabase functions deploy whatsapp-webhook --no-verify-jwt`.
3. **Na Evolution:** a Edge Function `whatsapp-connect` **configura o webhook automaticamente** ao criar/conectar a instância (URL do Supabase + `/functions/v1/whatsapp-webhook`). Se `SUPABASE_URL` não estiver nos secrets, a URL é obtida pela origem da própria requisição. Se o webhook não aparecer na instância, veja os logs da `whatsapp-connect` (erro "Evolution webhook/set falhou" ou "webhook URL invalida").
4. Guia passo a passo: [docs/EVOLUTION_INTEGRACAO.md](../docs/EVOLUTION_INTEGRACAO.md).

## Variáveis de ambiente obrigatórias

### Comum
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `TENANT_TOKEN_ENCRYPTION_KEY` (chave usada para criptografar/descriptografar token de API do tenant)

### Stripe
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`

### Evolution API (WhatsApp)
- `EVOLUTION_API_BASE_URL` – URL base da Evolution (sem barra no final). Ex.: `https://evolution.seudominio.com`
- `EVOLUTION_API_KEY` – API Key da Evolution (header `apikey` nas chamadas da Edge Function)
- `EVOLUTION_WEBHOOK_SECRET` – **Evolution API v2 não envia headers no webhook** ([doc](https://doc.evolution-api.com/v2/api-reference/webhook/set)); deixe **vazio**. Só defina se usar v1 ou outro cliente que envie `x-webhook-signature`.

**Na Evolution:** configurar apenas a **URL** do webhook: `https://<PROJECT_REF>.supabase.co/functions/v1/whatsapp-webhook` (sem header). Guia: [docs/EVOLUTION_INTEGRACAO.md](../docs/EVOLUTION_INTEGRACAO.md).

### n8n (opcional para forwarding)
- `N8N_INGRESS_WEBHOOK_URL` – **Produção:** `https://webhook.stratostech.com.br/webhook/stratosbotsaas` (mensagens inbound Evolution → n8n).
- `N8N_INGRESS_WEBHOOK_URL_TEST` – **Só desenvolvimento:** `https://n8n.stratostech.com.br/webhook-test/stratosbotsaas`. Usado apenas quando `STRATOSBOT_ENV=development`.
- `N8N_INGRESS_API_KEY` – opcional; header `x-api-key` nas requisições para o webhook de ingress.
- `N8N_PUBLISH_WEBHOOK_URL`
- `N8N_PUBLISH_API_KEY`
- `STRATOSBOT_ENV` – `production` (padrão) ou `development`; em `development` o ingress usa a URL de teste.

### OpenAI (para Simular resposta no onboarding)
- `OPENAI_API_KEY` – obrigatório para o endpoint `agent-simulate` responder com a LLM em vez de erro.
- `OPENAI_SIMULATE_MODEL` – opcional; padrão: `gpt-4o-mini`.

### Storage (recomendado para knowledge)
- Bucket: `knowledge-files`

## Observações importantes

- Todos os endpoints foram construídos para uso no **backend/edge**, sem expor segredos no front-end.
- O isolamento entre clientes depende do `tenant_id` + RLS da migration `20260225113000_saas_core_multitenant.sql`.
- Para produção, valide os paths da Evolution API da sua versão (algumas instalações variam endpoints).
