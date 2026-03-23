# API Contract - SaaS StratosBot

Base URL (Edge Functions):
- `https://<project-ref>.supabase.co/functions/v1`

Auth:
- Enviar `Authorization: Bearer <supabase_access_token>` nos endpoints autenticados.

## Configuração segura da API do tenant

### PUT `/tenant-api-config`
Salva base URL e token da API no banco (tenant-scoped). O token é armazenado criptografado e não é retornado em claro.

Body:
```json
{
  "apiBaseUrl": "https://SEU-PROJETO.supabase.co/functions/v1",
  "apiToken": "eyJ..."
}
```

Response:
```json
{
  "ok": true,
  "config": {
    "apiBaseUrl": "https://SEU-PROJETO.supabase.co/functions/v1",
    "hasToken": true,
    "tokenMasked": "****a1b2"
  }
}
```

### GET `/tenant-api-config`
Carrega configuração salva do tenant com token mascarado.

## Billing

### POST `/create-checkout-session`
Body (`planCode` deve existir em `public.plans` com `stripe_price_id` preenchido; ex.: `starter`, `pro`, `scale`):
```json
{
  "planCode": "starter",
  "successUrl": "https://app.seudominio.com/#/app/onboarding?step=billing&status=success",
  "cancelUrl": "https://app.seudominio.com/#/app/onboarding?step=billing&status=cancel"
}
```

Response:
```json
{
  "ok": true,
  "sessionId": "cs_test_...",
  "checkoutUrl": "https://checkout.stripe.com/c/pay/..."
}
```

### POST `/stripe-webhook`
- Endpoint server-to-server (nao chamar do front-end).
- Header: `stripe-signature`.

## Onboarding

### GET `/onboarding-status`
Response:
```json
{
  "ok": true,
  "tenantId": "uuid",
  "completedCount": 2,
  "total": 6,
  "done": false,
  "steps": [
    { "stepCode": "company_profile", "status": "completed", "completedAt": "2026-01-01T00:00:00.000Z" },
    { "stepCode": "billing", "status": "completed", "completedAt": "2026-01-01T00:00:00.000Z" },
    { "stepCode": "whatsapp_connection", "status": "pending", "completedAt": null }
  ]
}
```

### POST `/onboarding-status`
Body:
```json
{
  "stepCode": "whatsapp_connection",
  "status": "completed"
}
```

## WhatsApp / Evolution

### POST `/whatsapp-connect`
Body (opcional):
```json
{
  "phoneNumber": "5511999999999"
}
```

Response:
```json
{
  "ok": true,
  "tenantId": "uuid",
  "instanceKey": "tenant_abcd...",
  "status": "connecting",
  "qrCode": "data:image/png;base64,...",
  "pairingCode": null
}
```

### GET `/whatsapp-status`
Response:
```json
{
  "ok": true,
  "connected": true,
  "status": "connected",
  "instance": {
    "id": "uuid",
    "instanceKey": "tenant_abcd...",
    "phoneNumber": "5511999999999",
    "lastSeenAt": "2026-01-01T00:00:00.000Z"
  }
}
```

### POST `/whatsapp-webhook`
- Endpoint server-to-server (Evolution -> Supabase function).
- Header recomendado: `x-webhook-signature`.
- Se `N8N_INGRESS_WEBHOOK_URL` estiver definido, a mensagem inbound e encaminhada para n8n.

## Agente e documento guia

### GET `/agent-config`
Response:
```json
{
  "ok": true,
  "config": {
    "assistant_name": "Assistente",
    "tone": "profissional",
    "allowed_topics": [],
    "blocked_topics": []
  }
}
```

### PUT `/agent-config`
Body:
```json
{
  "assistantName": "Atendimento Loja XPTO",
  "tone": "amigavel",
  "objective": "Responder duvidas e qualificar leads",
  "allowedTopics": ["produtos", "precos", "entrega"],
  "blockedTopics": ["assuntos juridicos"],
  "responseGuidelines": "Responda em ate 3 frases e use portugues BR.",
  "fallbackHuman": "Encaminhar para humano em temas bloqueados",
  "active": true
}
```

### POST `/knowledge-upload`
Body (com upload direto opcional):
```json
{
  "fileName": "guia-agente.txt",
  "mimeType": "text/plain",
  "fileBase64": "SGVsbG8gV29ybGQ="
}
```

### GET `/knowledge-list`
Response:
```json
{
  "ok": true,
  "files": []
}
```

### POST `/knowledge-process`
Body:
```json
{
  "knowledgeFileId": "uuid"
}
```

### POST `/agent-simulate`
Retorna a resposta do agente usando **o mesmo fluxo do atendimento real** (webhook n8n), para prévia fiel no onboarding. Se `N8N_INGRESS_WEBHOOK_URL` (ou `N8N_INGRESS_WEBHOOK_URL_TEST` em desenvolvimento) estiver configurada, a função chama esse webhook com o mesmo payload que o WhatsApp usa; caso contrário, usa OpenAI diretamente (fallback).

Body:
```json
{
  "message": "Vocês atendem no fim de semana?"
}
```
Response (sucesso):
```json
{
  "ok": true,
  "tenantId": "uuid",
  "reply": "Texto da resposta do agente (n8n ou OpenAI).",
  "source": "n8n"
}
```
ou `"source": "agent-simulate"` quando o fallback OpenAI for usado.
- `503`: nem n8n nem OpenAI disponíveis (corpo: `error` com mensagem).
- `502`: erro da API OpenAI no fallback (corpo: `error` com detalhe).

### POST `/publish-agent`
Valida pré-requisitos e ativa automação do tenant.

Response (sucesso):
```json
{
  "ok": true,
  "tenantId": "uuid",
  "automationEnabled": true,
  "checklist": {
    "billing": true,
    "whatsapp_connection": true,
    "agent_config": true,
    "knowledge_upload": true
  }
}
```

Response (faltando etapas):
```json
{
  "ok": false,
  "error": "Requisitos de publicacao nao atendidos.",
  "missing": ["billing", "knowledge_upload"]
}
```

### GET `/tenant-readiness`
Retorna checklist operacional e percentual de prontidão.

Response:
```json
{
  "ok": true,
  "tenantId": "uuid",
  "checklist": {
    "billing": true,
    "whatsapp_connection": false,
    "agent_config": true,
    "knowledge_upload": true,
    "publish": false
  },
  "completedCount": 3,
  "total": 5,
  "percent": 60,
  "missing": ["whatsapp_connection", "publish"],
  "nextActions": [
    "Conectar WhatsApp e validar status connected.",
    "Publicar agente para habilitar automação."
  ]
}
```

### GET `/tenant-health`
Retorna score operacional e diagnóstico recente.

Response:
```json
{
  "ok": true,
  "tenantId": "uuid",
  "score": 80,
  "status": {
    "tenant": "active",
    "automationEnabled": true,
    "subscription": "active",
    "whatsapp": "connected"
  },
  "diagnostics": {
    "errorCount": 0,
    "warnCount": 1,
    "recentErrors": []
  }
}
```

## Evento encaminhado para n8n

Payload padrao enviado para `N8N_INGRESS_WEBHOOK_URL`:
```json
{
  "tenantId": "uuid",
  "tenantName": "Nome da Empresa",
  "instanceKey": "tenant_abcd...",
  "channel": "whatsapp",
  "externalContactId": "5511999999999@s.whatsapp.net",
  "message": "texto recebido",
  "source": "evolution-webhook",
  "raw": {}
}
```
`tenantName` vem de `tenants.name` e é usado pelo agente para se identificar (nome da empresa). Mensagens de áudio são transcritas (Whisper) e o texto transcrito é enviado em `message` e salvo no histórico da conversa.
