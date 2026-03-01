# n8n não executou – diagnóstico

Quando a mensagem chega no WhatsApp mas o agente não responde (n8n “não executou”), siga estes passos.

---

## 1. Ver os logs da Edge Function (Supabase)

1. Abra **Supabase Dashboard** → **Edge Functions** → **whatsapp-webhook** → aba **Logs**.
2. Envie **uma mensagem de teste** no WhatsApp para o número conectado.
3. Procure no log:

| Log | Significado |
|-----|-------------|
| `webhook_received` | A Evolution chamou o webhook. |
| `hasTenant: true` | O tenant foi identificado (instanceKey ou evolutionInstanceId). |
| `n8n_forward_check` | Indica se vai chamar o n8n: `willForward`, `hasN8nUrl`, `automationEnabled`, `n8nHost`. |
| `n8n_response` | Resposta do n8n: `status`, `ok`. |
| `n8n_forward_failed` (em `tenant_operation_logs`) | A chamada ao n8n falhou (status 4xx/5xx ou timeout). |

**Se não aparecer nenhuma linha:** a Evolution **não** está chamando o webhook. Veja [EVOLUTION_INTEGRACAO.md](./EVOLUTION_INTEGRACAO.md) e [SUPABASE_COMANDOS_IMPACTO.md](./SUPABASE_COMANDOS_IMPACTO.md) (webhook na Evolution, URL, eventos).

---

## 2. Conferir por que o n8n não foi chamado

No log `n8n_forward_check`:

- **`willForward: false`**  
  - **`automationEnabled: false`** → No Supabase, tabela `tenants`: o tenant precisa ter `automation_enabled = true`.  
  - **`hasN8nUrl: false`** → O secret **N8N_INGRESS_WEBHOOK_URL** (produção) ou **N8N_INGRESS_WEBHOOK_URL_TEST** (dev) não está definido ou está vazio.  
    - Supabase → Edge Functions → whatsapp-webhook → **Secrets** → definir a URL **completa** do webhook do n8n (ex.: `https://webhook.stratostech.com.br/webhook/stratosbotsaas`).

- **`willForward: true`** mas não há resposta do bot:  
  - Veja o log `n8n_response`: se `ok: false` e `status: 404`, a **URL do n8n está errada** ou o path não bate (ex.: `/webhook/stratosbotsaas` vs `/webhook-test/stratosbotsaas`).  
  - Se `status: 401` ou `403`, o n8n pode estar exigindo autenticação: configurar **N8N_INGRESS_API_KEY** no Supabase com o mesmo valor configurado no n8n para o webhook.

---

## 3. Conferir o n8n

1. **Workflow ativo**  
   No n8n, o workflow que contém o webhook **stratosbotsaas** deve estar **Ativo** (toggle ligado).

2. **URL do webhook**  
   - Abra o nó **Webhook** do workflow e copie a **Production URL** (ou Test URL, se estiver em dev).  
   - Essa URL deve ser **exatamente** a que está no secret do Supabase (`N8N_INGRESS_WEBHOOK_URL` ou `N8N_INGRESS_WEBHOOK_URL_TEST`).  
   - Produção costuma ser: `https://<seu-n8n>/webhook/<path>` (ex.: `https://webhook.stratostech.com.br/webhook/stratosbotsaas`).  
   - Teste: `https://<seu-n8n>/webhook-test/<path>`.

3. **Autenticação do webhook (opcional)**  
   Se no nó Webhook do n8n estiver configurado “Authentication” (ex.: Header Auth com `x-api-key`), o valor deve ser o mesmo do secret **N8N_INGRESS_API_KEY** no Supabase.

---

## 4. Resumo rápido

| Sintoma | O que verificar |
|--------|------------------|
| Nenhum log ao enviar mensagem | Evolution não chama o webhook → URL do webhook na Evolution, eventos MESSAGES_UPSERT. |
| `hasTenant: false` | evolutionInstanceId no metadata da instância; reconectar WhatsApp no onboarding. |
| `willForward: false`, `hasN8nUrl: false` | Definir **N8N_INGRESS_WEBHOOK_URL** (ou _TEST) nos Secrets da função. |
| `willForward: false`, `automationEnabled: false` | `UPDATE tenants SET automation_enabled = true WHERE id = '...';` |
| `n8n_response` com status 404 | URL do n8n errada ou path diferente; conferir Production URL no nó Webhook. |
| `n8n_response` com status 401/403 | N8N_INGRESS_API_KEY no Supabase igual ao configurado no n8n para o webhook. |
| `n8n_response` ok mas bot não responde | Resposta do n8n sem campo `message`; ver formato esperado em API_CONTRACT_SAAS.md. |

Depois de alterar **Secrets** no Supabase, não é necessário redeploy da função; na próxima mensagem já usa o novo valor.
