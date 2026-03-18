# Plano: Análise de arquitetura — Escalar o SaaS com um único workflow N8N

**Objetivo:** Avaliar se usar **apenas 1 workflow N8N** para todos os tenants pode gerar problemas de execução ao escalar o SaaS. Nenhuma alteração de código é proposta neste documento; apenas análise e plano de mitigação.

---

## 1. Arquitetura atual (resumo)

- **Entrada:** Mensagens WhatsApp (Evolution API) → Edge Function `whatsapp-webhook` (Supabase).
- **Encaminhamento:** A Edge Function faz `POST` síncrono para **uma única URL** de webhook N8N (`N8N_INGRESS_WEBHOOK_URL`), com payload contendo `tenantId`, `tenantName`, `message`, `externalContactId`, etc.
- **Workflow N8N (único):** “StratosBot SaaS”
  - **Webhook** (path `stratosbotsaas`) → em paralelo: **Merge** (payload) + **Knowledge Context** (HTTP para Supabase `knowledge-context`).
  - **Merge** → **AI Agent** (LangChain: OpenAI + Redis Chat Memory, `sessionKey = tenantId_externalContactId`).
  - **AI Agent** → **ParseOrderData** → **Respond to Webhook** (resposta JSON com `message`).
- **Saída:** A Edge Function espera a resposta do n8n, lê o campo `message` e envia o texto de volta via Evolution (sendText). Também atualiza `conversations` e logs.

Fluxo adicional que usa o **mesmo** webhook: **agent-simulate** (onboarding “Ver resposta do robô”) chama a mesma URL N8N com `source: "onboarding-simulate"`.

---

## 2. Riscos de usar apenas 1 workflow ao escalar

### 2.1 Concorrência e fila no N8N

- N8N limita execuções **concorrentes** de produção (webhooks/triggers) por configuração (ex.: `N8N_CONCURRENCY_PRODUCTION_LIMIT`, em cloud por plano).
- Todas as mensagens de **todos os tenants** e as simulações do onboarding disputam a **mesma fila** do mesmo workflow.
- Quando o limite é atingido, novas execuções entram em **fila FIFO**. Efeitos:
  - Aumento de **latência** (tempo até “Respond to Webhook”).
  - Risco de **timeout** no chamador (Supabase Edge Function e/ou Evolution) se a espera for longa.

### 2.2 Chamada síncrona sem timeout explícito

- A Edge Function `whatsapp-webhook` faz `await fetch(n8nWebhookUrl, …)` **sem timeout** configurado.
- Se o N8N estiver sobrecarregado (fila grande) ou lento (OpenAI/Redis/Supabase), a Edge Function fica bloqueada até a resposta. O cliente Evolution pode encerrar a conexão ou reenviar o evento, gerando reprocessamento ou perda de mensagem.

### 2.3 Dependências compartilhadas por execução

Cada execução do workflow usa:

| Recurso | Uso por execução | Risco ao escalar |
|--------|-------------------|-------------------|
| **Supabase `knowledge-context`** | 1 GET por mensagem | Limite de concorrência das Edge Functions; throttling por projeto. |
| **Redis (Chat Memory)** | Leitura + escrita por sessão (`tenantId_externalContactId`) | Latência e throughput do Redis; isolamento entre tenants é por chave (OK), mas o mesmo Redis serve todas as sessões. |
| **OpenAI (LLM)** | 1 chamada por mensagem | Limites RPM/TPM da conta; throttling (429) afeta todas as execuções do workflow. |

Com 1 workflow, um pico de mensagens (vários tenants ativos) ou muitas simulações no onboarding concentra carga nesses três pontos ao mesmo tempo.

### 2.4 Ponto único de falha

- Um único workflow significa:
  - **Bug ou deploy quebrado** no workflow afeta todos os tenants.
  - **Manutenção** (editar, desativar, fazer rollback) impacta todo o atendimento.
  - Não há isolamento por tenant a nível de execução (ex.: um tenant com volume anormal não é isolado em outro workflow).

### 2.5 Competição com agent-simulate

- O onboarding chama o **mesmo** webhook N8N para “Ver resposta do robô”.
- Essas execuções consomem o **mesmo** pool de concorrência e as mesmas dependências (OpenAI, Redis, knowledge-context). Em horário de pico de uso do produto + muitos acessos ao onboarding, a fila pode crescer e atrasar tanto o atendimento real quanto a simulação.

---

## 3. Cenários onde os problemas tendem a aparecer

- **Muitos tenants ativos ao mesmo tempo:** dezenas de instâncias WhatsApp recebendo mensagens em paralelo.
- **Picos de mensagens:** campanhas, promoções ou um único tenant com alto volume.
- **Uso intenso do onboarding:** muitos usuários testando “Ver resposta do robô” ao mesmo tempo.
- **OpenAI em limite:** conta próxima do RPM/TPM; uma única fila grande no N8N pode gerar muitas chamadas em sequência e aumentar 429s.
- **Redis ou Supabase sob carga:** latência alta em Knowledge Context ou Redis aumenta o tempo de cada execução e, portanto, o tempo na fila.

---

## 4. Plano de mitigação (sem alterar código aqui — apenas direção)

### 4.1 Curto prazo (um workflow só)

1. **Configurar e monitorar concorrência no N8N**
   - Definir `N8N_CONCURRENCY_PRODUCTION_LIMIT` (ou equivalente em n8n Cloud) com base em carga esperada e capacidade do servidor/Redis/OpenAI.
   - Monitorar fila de execuções e duração média; definir alertas para fila grande ou tempo de resposta alto.

2. **Timeout na chamada ao N8N**
   - Na Edge Function `whatsapp-webhook`, usar `AbortController` + `setTimeout` no `fetch` para o N8N (ex.: 25–30 s). Em caso de timeout, registrar em log, responder 200 ao Evolution (evitar retry infinito) e opcionalmente gravar “resposta não disponível” para o usuário.

3. **Separar simulação do atendimento real (recomendado)**
   - Opção A: Webhook N8N dedicado para simulação (outro path ou outro workflow) com limite de concorrência menor, para não competir com o fluxo de produção.
   - Opção B: Manter agent-simulate usando apenas Edge Function + OpenAI (fallback atual) em produção e usar N8N só para demonstração ou ambiente de teste.

4. **Capacidade de dependências**
   - **OpenAI:** conferir limites (RPM/TPM) e considerar aumento ou múltiplas chaves se necessário.
   - **Redis:** garantir instância adequada (memória, conexões); monitorar latência e uso.
   - **Supabase:** monitorar uso de Edge Functions (knowledge-context) e limites de concorrência do projeto.

### 4.2 Médio prazo (se um workflow não for suficiente)

5. **Múltiplos workflows ou workers**
   - **Vários workflows** com a mesma lógica e webhooks diferentes (ex.: por faixa de tenant ou por hash de `tenantId`), com load balancer na frente, para distribuir carga e reduzir fila única.
   - Ou **queue mode** do N8N: um main para triggers e vários workers para execução, aumentando concorrência total sem depender de um único processo.

6. **Desacoplar resposta do webhook**
   - Webhook N8N responde 200 rápido (aceita a mensagem) e processa em background (outro workflow ou fila). A Edge Function deixaria de esperar a resposta do agente; o envio da resposta ao WhatsApp seria feito por outro processo (worker, outro workflow acionado por fila). Exige mudança de arquitetura (assíncrona) e cuidado com UX (digitando…, atraso esperado).

### 4.3 Validação

7. **Testes de carga**
   - Simular múltiplos tenants e mensagens simultâneas contra o webhook N8N; medir latência p50/p95/p99, taxa de timeout e comportamento da fila.
   - Reproduzir cenário de muitos acessos ao “Ver resposta do robô” junto com mensagens WhatsApp para ver degradação compartilhada.

---

## 5. Conclusão

- **Sim, escalar o SaaS usando apenas 1 workflow N8N pode gerar problemas de execução:** fila única, risco de timeout, contenção em OpenAI/Redis/Supabase e mistura de tráfego de produção com simulação.
- A **gravidade** depende do número de tenants, do volume de mensagens e do uso do onboarding. Com poucos tenants e volume baixo, um único workflow costuma ser suficiente.
- O **plano** recomendado é: (1) aplicar timeouts e limites de concorrência, (2) separar ou limitar o uso do mesmo webhook para simulação, (3) monitorar fila e dependências e (4) planejar múltiplos workflows ou queue mode se os testes de carga indicarem que um único workflow é o gargalo.

Nenhuma alteração de código foi feita neste passo; este documento serve apenas como plano de análise e mitigação para a equipe de arquitetura.
