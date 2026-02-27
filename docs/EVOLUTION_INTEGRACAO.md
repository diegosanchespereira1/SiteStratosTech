# Integração Evolution API com o StratosBot

Este guia explica como conectar sua instância **Evolution API** ao projeto para o botão **Conexão WhatsApp** no onboarding e para receber mensagens via webhook.

---

## 1. Onde o projeto usa a Evolution

| Uso | Edge Function | O que faz |
|-----|----------------|-----------|
| Conectar WhatsApp (QR) | `whatsapp-connect` | Chama `POST /instance/create` e `GET /instance/connect/{instanceKey}` na Evolution |
| Consultar status | `whatsapp-status` | Lê no Supabase (atualizado pelo webhook) |
| Receber eventos/mensagens | `whatsapp-webhook` | Recebe POST da Evolution; atualiza status da instância e encaminha mensagens para n8n |

O **instanceKey** gerado pelo projeto é sempre `tenant_{tenantId sem hífens}` (ex.: `tenant_abc123def456...`).

---

## 2. Rodar a Evolution API

Você pode usar:

- **Docker** (recomendado): [Evolution API no GitHub](https://github.com/EvolutionAPI/evolution-api)
- **Serviço gerenciado** que ofereça Evolution (ex.: VPS com Docker)
- **Evolution API v1** (o código atual usa endpoints v1: `instance/create`, `instance/connect`)

Exemplo mínimo com Docker:

```bash
docker run -d \
  -p 8080:8080 \
  -e AUTHENTICATION_API_KEY=sua_api_key_aqui \
  atendai/evolution-api
```

Anote:

- **URL base** da API (ex.: `http://localhost:8080` ou `https://sua-evolution.exemplo.com`)
- **API Key** configurada (ex.: `AUTHENTICATION_API_KEY`)

---

## 3. Variáveis de ambiente no Supabase (Edge Functions)

Defina os **secrets** do projeto Supabase para as Edge Functions:

```bash
# No Supabase Dashboard: Project Settings → Edge Functions → Secrets
# Ou via CLI: supabase secrets set ...
```

| Secret | Obrigatório | Descrição |
|--------|-------------|-----------|
| `EVOLUTION_API_BASE_URL` | Sim | URL base da Evolution (sem barra no final). Ex.: `https://sua-evolution.exemplo.com` ou `http://host.docker.internal:8080` |
| `EVOLUTION_API_KEY` | Sim | API Key da Evolution (mesmo valor usado no header `apikey` nas chamadas) |
| `EVOLUTION_WEBHOOK_SECRET` | Não (Evolution v2) | Na **Evolution API v2** não há opção de enviar headers no webhook ([doc](https://doc.evolution-api.com/v2/api-reference/webhook/set)). Deixe **vazio**; a URL do webhook (difícil de adivinhar) é a única proteção. Só defina se usar Evolution v1 ou outro cliente que envie `x-webhook-signature`. |

Exemplo (CLI):

```bash
supabase secrets set EVOLUTION_API_BASE_URL=https://sua-evolution.exemplo.com
supabase secrets set EVOLUTION_API_KEY=sua_api_key
# EVOLUTION_WEBHOOK_SECRET: não definir com Evolution v2 (ela não envia header)
```

---

## 4. Configurar o webhook na Evolution

A Evolution precisa enviar eventos para a Edge Function **whatsapp-webhook**. A URL da função é:

```
https://<SEU_PROJECT_REF>.supabase.co/functions/v1/whatsapp-webhook
```

Substitua `<SEU_PROJECT_REF>` pelo ref do seu projeto (ex.: no Dashboard Supabase → Settings → General → Reference ID).

### 4.1 Opção A: Webhook global (configuração da Evolution)

Na Evolution, configure apenas a **URL** (a v2 não permite configurar headers no webhook):

- **URL:** `https://<SEU_PROJECT_REF>.supabase.co/functions/v1/whatsapp-webhook`

Eventos que o código espera:

- **Conexão:** algo como `connection.update` ou evento cujo payload tenha `state` / `data.state` (`open`, `connected`, `close`, `disconnected`, `error`).
- **Mensagens:** evento de mensagem com `data.message.conversation` ou `data.body` e `data.key.remoteJid` ou `data.from`.

Consulte a documentação da sua versão da Evolution para os nomes exatos dos eventos e do payload.

### 4.2 Opção B: Webhook por instância (API v2)

Na [Evolution API v2](https://doc.evolution-api.com/v2/pt/configuration/webhooks) o webhook é configurado apenas com **url**, **enabled** e **events** (sem headers). Após criar a instância, chame:

```http
POST /webhook/set/{instanceKey}
Content-Type: application/json
apikey: <sua EVOLUTION_API_KEY>

{
  "url": "https://<SEU_PROJECT_REF>.supabase.co/functions/v1/whatsapp-webhook",
  "enabled": true,
  "webhookByEvents": false,
  "webhookBase64": false,
  "events": ["QRCODE_UPDATED", "CONNECTION_UPDATE", "MESSAGES_UPSERT", "MESSAGES_UPDATE", "MESSAGES_DELETE", "SEND_MESSAGE"]
}
```

A Evolution v2 **não** envia header customizado; não é necessário configurar `EVOLUTION_WEBHOOK_SECRET` no Supabase.

---

## 5. Fluxo resumido

1. **Você:** sobe a Evolution, configura URL e API Key.
2. **Você:** define `EVOLUTION_API_BASE_URL` e `EVOLUTION_API_KEY` nos secrets do Supabase. Com Evolution v2, **não** defina `EVOLUTION_WEBHOOK_SECRET` (a v2 não envia headers no webhook).
3. **Você:** na Evolution configura apenas a **URL** do webhook: `.../functions/v1/whatsapp-webhook`.
4. **Usuário no onboarding:** clica em **Executar** na etapa **Conexão WhatsApp** → o backend cria/conecta a instância na Evolution e devolve o QR.
5. **Usuário:** escaneia o QR no celular.
6. **Evolution:** envia evento de conexão para o webhook → `whatsapp-webhook` atualiza `whatsapp_instances` para `connected`.
7. **Usuário:** clica em **Atualizar status** no onboarding → vê “WhatsApp conectado”.
8. Mensagens recebidas no WhatsApp dessa instância são enviadas pela Evolution ao webhook → salvas no Supabase e, se configurado, encaminhadas para o n8n.

---

## 6. Troubleshooting

| Problema | O que verificar |
|----------|------------------|
| “Evolution API nao configurada” | `EVOLUTION_API_BASE_URL` e `EVOLUTION_API_KEY` definidos e acessíveis a partir do Supabase (rede/firewall). |
| QR não aparece / erro ao conectar | Logs da Evolution e da Edge Function `whatsapp-connect`; se a Evolution está atrás de proxy, garantir que a URL base está correta. |
| Status não vira “connected” após escanear | Webhook configurado na Evolution (URL apenas; v2 não usa header); evento de conexão com `state`/`data.state`; logs da função `whatsapp-webhook`. |
| Mensagens não chegam no n8n | (1) **Secrets Supabase:** `N8N_INGRESS_WEBHOOK_URL` (e opcionalmente `N8N_INGRESS_API_KEY`). (2) **Webhook na Evolution:** ao clicar em "Executar" na Conexão WhatsApp, a Edge Function `whatsapp-connect` passa a configurar o webhook na instância (POST `/webhook/set/{instance}`) com eventos `MESSAGES_UPSERT` e `CONNECTION_UPDATE`. Se a instância foi criada antes dessa alteração, reconecte (desmarque a etapa e clique em Executar de novo) ou configure o webhook manualmente na Evolution. (3) No n8n, o workflow deve estar ativo e a URL do webhook deve coincidir com `N8N_INGRESS_WEBHOOK_URL`. |

O **whatsapp-connect** já define o webhook na Evolution ao criar/conectar a instância. O **whatsapp-webhook** aceita tanto o payload no formato v1 (`data.message`, `data.key`) quanto no formato v2 (campos no topo: `message`, `key`) e também `data.messages[0]`.

### Nada aparece no n8n nem no Supabase

Se ao enviar mensagem para o número conectado **não aparece execução no n8n** e **nada nos logs do Supabase**:

1. **A Evolution está chamando nosso webhook?**  
   Supabase Dashboard → **Edge Functions** → **whatsapp-webhook** → aba **Logs**. Envie uma mensagem de teste e veja se surge alguma invocação. A função agora registra `webhook_received` no log (event, instanceKey, hasTenant).  
   - **Se não houver nenhuma invocação:** o webhook **não está configurado** na instância da Evolution (ou a URL está errada). Siga o passo 2.  
   - **Se houver invocação** mas ainda nada no n8n: veja o log (ex.: `tenant nao identificado`, `mensagem nao suportada`) ou erro ao chamar N8N.

2. **Configurar o webhook na instância (Evolution):**  
   O nome da instância no projeto é `tenant_{uuid sem hífens}` (ex.: `tenant_0a9b271b7afb4136b89bba0c5d83dc5c`).  
   - **Opção A:** No onboarding, **desmarque** a etapa “Conexão WhatsApp”, clique de novo em **Executar**. Isso chama `whatsapp-connect`, que define o webhook na Evolution para essa instância.  
   - **Opção B:** Na Evolution, chamar manualmente:
     ```http
     POST {EVOLUTION_API_BASE_URL}/webhook/set/tenant_XXXXXXXX
     Content-Type: application/json
     apikey: {EVOLUTION_API_KEY}
     {"url":"https://SEU_PROJECT_REF.supabase.co/functions/v1/whatsapp-webhook","enabled":true,"webhookByEvents":false,"webhookBase64":false,"events":["CONNECTION_UPDATE","MESSAGES_UPSERT"]}
     ```
     Substitua `tenant_XXXXXXXX` pelo nome real da sua instância (sem hífens no UUID).

3. **Conferir na Evolution o que está configurado:**  
   `GET {EVOLUTION_API_BASE_URL}/webhook/find/tenant_XXXXXXXX` (com o mesmo `tenant_...`). Deve retornar a URL do Supabase e os eventos.

4. Depois de ajustar o webhook, **faça deploy** da Edge Function `whatsapp-webhook` (se alterou código) e **teste de novo** enviando uma mensagem.

5. **Evolution envia `instanceId` (UUID) em vez do nome da instância?** Se nos logs aparecer `hasTenant: false` e um `instanceId` em formato UUID, a Evolution está identificando a instância pelo UUID. O sistema passa a guardar esse UUID em `metadata->evolutionInstanceId` quando você clica em **Executar** (whatsapp-connect chama webhook/set e grava a resposta). Se você configurou o webhook manualmente (curl), faça **uma** das opções: (a) No onboarding, desmarque a etapa Conexão WhatsApp e clique em **Executar** de novo (o sistema reconfigura o webhook e grava o `instanceId` no banco); ou (b) Atualize o metadata no Supabase (SQL): `update whatsapp_instances set metadata = coalesce(metadata,'{}')::jsonb || '{"evolutionInstanceId":"SEU_UUID_AQUI"}'::jsonb where instance_key = 'tenant_0a9b271b7afb4136b89bba0c5d83dc5c';` (substitua o UUID pelo `instanceId` que aparece na resposta do curl de webhook/set).
