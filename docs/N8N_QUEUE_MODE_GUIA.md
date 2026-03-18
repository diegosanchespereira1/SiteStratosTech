# Guia: Queue mode no n8n para distribuir carga

Este guia explica como ativar o **queue mode** no n8n para escalar execuções usando uma instância **main** (recebe triggers/webhooks e UI) e uma ou mais instâncias **worker** (executam os workflows). Assim você distribui a carga e evita gargalo em um único processo.

---

## 1. Visão geral da arquitetura

- **Main:** Recebe webhooks, triggers, cron e serve a interface do n8n. Envia os **jobs** (execuções) para o Redis.
- **Redis:** Fila de mensagens (Bull). O main publica jobs; os workers consomem.
- **Workers:** Processos n8n que só executam workflows. Puxam jobs do Redis, rodam o workflow e gravam o resultado no banco.
- **Banco:** Postgres (ou MySQL). **SQLite não é suportado** em queue mode (vários processos precisam do mesmo banco).

Fluxo: Webhook chega no main → main coloca job no Redis → um worker pega o job → executa o workflow → grava resultado no DB → Redis notifica o main.

---

## 2. Pré-requisitos

- **Redis** acessível por main e workers (localhost ou servidor).
- **Postgres** (recomendado 13+) como banco do n8n. Se hoje você usa SQLite, é preciso migrar para Postgres antes.
- **Chave de criptografia:** A mesma `N8N_ENCRYPTION_KEY` deve ser usada no main e em **todos** os workers (senão os workers não conseguem ler credenciais do banco).

---

## 3. Passo a passo

### 3.1 Subir o Redis

Exemplo com Docker:

```bash
docker run --name n8n-redis -p 6379:6379 -d redis
```

Com senha (recomendado em produção):

```bash
docker run --name n8n-redis -p 6379:6379 -e REDIS_PASSWORD=sua_senha -d redis redis-server --requirepass sua_senha
```

Anote: host, porta, senha (se usar). Em produção, use um Redis gerenciado ou em servidor dedicado.

### 3.2 Configurar a instância MAIN

Na máquina/container onde roda o n8n **principal** (UI + recebe webhooks):

1. **Modo de execução = queue**

   ```bash
   export EXECUTIONS_MODE=queue
   ```

2. **Conexão com Redis**

   ```bash
   export QUEUE_BULL_REDIS_HOST=localhost    # ou IP do Redis
   export QUEUE_BULL_REDIS_PORT=6379
   export QUEUE_BULL_REDIS_PASSWORD=sua_senha # se tiver
   # Opcional: export QUEUE_BULL_REDIS_DB=0
   ```

3. **Chave de criptografia** (obrigatória para workers depois)

   No primeiro start o n8n gera uma chave. Para definir uma fixa (igual em main e workers):

   ```bash
   export N8N_ENCRYPTION_KEY=<sua_chave_secreta_longa>
   ```

   Você pode pegar a chave já existente no arquivo de config do n8n ou definir uma nova e anotar.

4. **Banco:** garantir que está usando Postgres (variáveis `DB_TYPE`, `DB_POSTGRESDB_*` etc.).

5. Reiniciar o n8n em modo **main** (padrão):

   ```bash
   n8n start
   # ou
   docker run ... docker.n8n.io/n8nio/n8n
   ```

Após isso, o main passa a **enfileirar** as execuções no Redis em vez de executar localmente. Até você subir workers, os jobs ficam na fila.

### 3.3 Subir os WORKERS

Em uma ou mais máquinas/containers (podem ser a mesma do main ou outras):

1. **Mesmo banco** que o main (mesmas env vars de Postgres).
2. **Mesmo Redis** que o main:

   ```bash
   export QUEUE_BULL_REDIS_HOST=localhost
   export QUEUE_BULL_REDIS_PORT=6379
   export QUEUE_BULL_REDIS_PASSWORD=sua_senha  # se tiver
   ```

3. **Mesma chave de criptografia:**

   ```bash
   export N8N_ENCRYPTION_KEY=<mesma_do_main>
   ```

4. **Modo de execução = queue:**

   ```bash
   export EXECUTIONS_MODE=queue
   ```

5. Iniciar o processo **worker** (não é `n8n start`):

   **Se instalou o n8n via npm:**

   ```bash
   n8n worker
   ```

   **Com concurrency customizada (padrão 10):**

   ```bash
   n8n worker --concurrency=5
   ```

   **Com Docker:**

   ```bash
   docker run --name n8n-worker \
     -e EXECUTIONS_MODE=queue \
     -e N8N_ENCRYPTION_KEY=<mesma_do_main> \
     -e QUEUE_BULL_REDIS_HOST=host.docker.internal \
     -e QUEUE_BULL_REDIS_PORT=6379 \
     -e DB_TYPE=postgresdb \
     -e DB_POSTGRESDB_HOST=... \
     -e DB_POSTGRESDB_DATABASE=... \
     -e DB_POSTGRESDB_USER=... \
     -e DB_POSTGRESDB_PASSWORD=... \
     docker.n8n.io/n8nio/n8n worker --concurrency=5
   ```

Você pode subir vários workers (no mesmo servidor ou em servidores diferentes). Todos precisam de acesso ao **mesmo** Redis e ao **mesmo** banco.

### 3.4 (Opcional) Processadores de webhook

Para **escalar** o recebimento de webhooks (ex.: StratosBot com muitas mensagens simultâneas):

- Rode processos **webhook** em containers/máquinas separadas.
- Coloque um **load balancer** na frente:
  - Rotas `/webhook/*` → pool de processos **webhook**.
  - Resto (UI, API) → **main** (e **não** coloque o main no pool de webhook).

Iniciar processo webhook:

```bash
n8n webhook
```

Com Docker:

```bash
docker run --name n8n-webhook -p 5679:5678 \
  -e EXECUTIONS_MODE=queue \
  -e N8N_ENCRYPTION_KEY=<mesma_do_main> \
  -e QUEUE_BULL_REDIS_HOST=... \
  -e QUEUE_BULL_REDIS_PORT=6379 \
  -e DB_TYPE=postgresdb \
  ... \
  docker.n8n.io/n8nio/n8n webhook
```

Configurar a URL pública dos webhooks no main:

```bash
export WEBHOOK_URL=https://sua-url-webhook.com
```

Se quiser que o main **não** processe webhooks de produção (só os processadores de webhook):

```bash
export N8N_DISABLE_PRODUCTION_MAIN_PROCESS=true
```

Assim o main não entra no pool de webhook e não sofre carga de entrada.

---

## 4. Variáveis de ambiente resumidas (queue mode)

| Variável | Onde | Descrição |
|----------|------|-----------|
| `EXECUTIONS_MODE` | main + workers (+ webhook) | `queue` |
| `N8N_ENCRYPTION_KEY` | main + workers + webhook | Mesma chave em todos |
| `QUEUE_BULL_REDIS_HOST` | main + workers | Host do Redis |
| `QUEUE_BULL_REDIS_PORT` | main + workers | Porta (ex.: 6379) |
| `QUEUE_BULL_REDIS_PASSWORD` | main + workers | Se Redis tiver senha |
| `QUEUE_BULL_REDIS_DB` | main + workers | Opcional, default 0 |
| `N8N_DISABLE_PRODUCTION_MAIN_PROCESS` | main | `true` para não processar webhooks no main |
| `WEBHOOK_URL` | main | URL pública dos webhooks (para callbacks) |
| `OFFLOAD_MANUAL_EXECUTIONS_TO_WORKERS` | main | `true` para rodar execuções manuais nos workers |

Worker:

- `n8n worker --concurrency=5` (ou 10, etc.). Recomendado 5 ou mais; muitos workers com concurrency muito baixa pode estourar o connection pool do banco.

---

## 5. Conferindo se está funcionando

- No main, ao disparar um workflow por webhook (ex.: enviar mensagem no StratosBot), a execução deve aparecer como "running" e depois "success" quando um worker processar.
- Logs do worker devem mostrar o consumo dos jobs.
- Se nada processar, verifique: Redis acessível por main e workers, mesma `N8N_ENCRYPTION_KEY`, mesmo banco e `EXECUTIONS_MODE=queue` em todos.

---

## 6. Referências

- [n8n – Configuring queue mode](https://docs.n8n.io/hosting/scaling/queue-mode/)
- [n8n – Queue mode environment variables](https://docs.n8n.io/hosting/configuration/environment-variables/queue-mode/)

Depois de ativar o queue mode, você pode aumentar a carga distribuída adicionando mais workers ou mais processos webhook atrás do load balancer.
