# Impacto de comandos no Supabase – checklist

Se você executou comandos no Supabase (SQL, migrations, `db reset`, etc.) e a aplicação parou de funcionar, use este checklist para conferir o que pode ter sido afetado e como reverter/ajustar.

---

## 1. O que foi verificado no projeto (estado atual)

- **Migrations aplicadas no projeto:** existe uma migration `clear_all_public_tables` (20260226014103) na lista do Supabase. **Se essa migration foi executada** (por exemplo via `supabase db reset` ou aplicação manual), ela **apaga dados** das tabelas públicas. Hoje você tem 2 tenants, 2 whatsapp_instances e dados em outras tabelas, então ou essa migration não foi rodada depois dos dados criados, ou os dados foram recriados depois.
- **Dados críticos consultados:**
  - **Tenant "Empresa Diego" (0a9b271b-...):** `automation_enabled = true`, WhatsApp **connected**, `evolution_instance_id` = **null**.
  - **Tenant "OnTime Prime Cars":** `automation_enabled = true`, WhatsApp disconnected.
- **Conclusão:** O schema e os dados que conferimos (tenants, whatsapp_instances, subscriptions) estão consistentes. O problema pode estar em **Evolution não chamando o webhook**, **secret do n8n** ou **evolutionInstanceId** (veja abaixo).

---

## 2. Comandos que podem ter impacto

| Comando / ação | Impacto possível | O que fazer |
|----------------|------------------|-------------|
| **`supabase db reset`** | Reaplica todas as migrations, incluindo a que **limpa tabelas públicas**. Apaga tenants, whatsapp_instances, conversations, etc. | Recriar tenant/usuário pelo onboarding e reconectar WhatsApp. |
| **Migration `clear_all_public_tables`** | Remove/trunca dados das tabelas públicas. | Mesmo que acima: recriar dados ou restaurar backup. |
| **SQL que altera `tenants`** | Ex.: `UPDATE tenants SET automation_enabled = false` → o webhook **não** encaminha para o n8n. | `UPDATE tenants SET automation_enabled = true WHERE id = 'SEU_TENANT_ID';` |
| **SQL que altera `whatsapp_instances`** | Ex.: apagar linha ou mudar `instance_key` → o webhook pode não achar o tenant. | Garantir que existe uma linha com `instance_key = 'tenant_XXXXXXXX'` e `tenant_id` correto. |
| **Alterar/remover Secrets das Edge Functions** | Se **`N8N_INGRESS_WEBHOOK_URL`** (ou `_TEST`) for apagada ou alterada, a função `whatsapp-webhook` **não** chama o n8n. | Supabase Dashboard → Edge Functions → whatsapp-webhook → Secrets. Definir de novo a URL completa do webhook do n8n. |
| **Redeploy da Edge Function com JWT** | Se `whatsapp-webhook` for deployada **com** `--verify-jwt`, a Evolution (que não manda Authorization) passa a receber 401. | Deploy sem JWT: `supabase functions deploy whatsapp-webhook --no-verify-jwt` |

---

## 3. Checklist rápido (bot não responde no WhatsApp)

1. **Evolution está chamando o webhook?**  
   Supabase → Edge Functions → **whatsapp-webhook** → Logs. Envie uma mensagem e veja se aparece **POST** e algo como `webhook_received`.  
   - Se **não** aparecer: na Evolution, conferir URL do webhook (igual à da função, com ou sem path do segredo) e evento **MESSAGES_UPSERT** ativo. Reconfigurar o webhook (ex.: executar de novo a etapa “Conexão WhatsApp” no onboarding).

2. **Tenant identificado?**  
   Nos logs da função, ver se **`hasTenant: true`**.  
   - Se for **false:** a Evolution pode estar enviando só `instanceId` (UUID). No banco, `whatsapp_instances.metadata->evolutionInstanceId` está **null**.  
   - **Correção:** No onboarding, desmarcar “Conexão WhatsApp” e clicar em **Executar** de novo (isso chama a Evolution e grava o `instanceId` no `metadata`).  
   - **Ou** em SQL (troque o UUID pelo `instanceId` que a Evolution envia):  
     `UPDATE whatsapp_instances SET metadata = COALESCE(metadata,'{}')::jsonb || '{"evolutionInstanceId":"UUID_DA_EVOLUTION"}'::jsonb WHERE instance_key = 'tenant_0a9b271b7afb4136b89bba0c5d83dc5c';`

3. **URL do n8n definida?**  
   Edge Functions → whatsapp-webhook → **Secrets**. Deve existir **`N8N_INGRESS_WEBHOOK_URL`** (produção) ou **`N8N_INGRESS_WEBHOOK_URL_TEST`** (dev), com a URL **completa** do webhook do n8n (ex.: `https://n8n.xxx.com/webhook/stratosbotsaas`).

4. **n8n:** Workflow **ativo**, URL do nó Webhook igual à do secret acima.

5. **Automação ligada:**  
   `SELECT id, name, automation_enabled FROM tenants WHERE id = '0a9b271b-7afb-4136-b89b-ba0c5d83dc5c';`  
   Deve retornar `automation_enabled = true`. Se não, atualizar com o `UPDATE` da tabela acima.

---

## 4. Conferir se algo foi apagado (após `db reset` ou migration de clear)

Rodar no SQL Editor (ajuste o tenant_id se precisar):

```sql
-- Contagem básica
SELECT 'tenants' AS tbl, COUNT(*) FROM tenants
UNION ALL SELECT 'whatsapp_instances', COUNT(*) FROM whatsapp_instances
UNION ALL SELECT 'subscriptions', COUNT(*) FROM subscriptions
UNION ALL SELECT 'agent_configs', COUNT(*) FROM agent_configs
UNION ALL SELECT 'onboarding_steps', COUNT(*) FROM onboarding_steps;
```

Se algum número for 0 e deveria ter dados, os comandos no Supabase podem ter apagado; aí é recriar pelo onboarding ou restaurar backup.

---

## 5. Resumo

- **Sim, comandos no Supabase podem impactar:** principalmente `db reset`, migrations que limpam tabelas, SQL que altera `tenants.automation_enabled` ou `whatsapp_instances`, e alteração/remoção de **Secrets** da Edge Function.
- No estado atual do projeto, **tenants e whatsapp_instances estão presentes** e um tenant está com `automation_enabled = true` e WhatsApp connected; **`evolution_instance_id` está null**, o que pode fazer o webhook não identificar o tenant se a Evolution enviar só UUID. Vale seguir o checklist acima (logs do webhook, Evolution, secret do n8n, evolutionInstanceId e n8n ativo).
