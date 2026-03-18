# Deploy n8n em queue mode (Swarm)

Stack: **docker-compose.n8n-queue.swarm.yml** — Redis + Postgres + n8n main + n8n workers, integrado ao Traefik e à rede `PolygonNetwork`.

**Se você já tem n8n e Redis rodando:** use o stack **só de workers** em `docker-compose.n8n-workers-only.swarm.yml` e deixe main + Redis onde já estão. Veja a seção [Só workers (n8n e Redis já existentes)](#só-workers-n8n-e-redis-já-existentes) no final.

---

## 1. Um container por serviço (não “tudo no mesmo container”)

No Swarm, um **stack** agrupa vários **serviços**. Cada serviço = uma imagem + N **réplicas** (containers). Ou seja:

- **Não** é “todas as aplicações no mesmo container”.
- São **containers separados**: um (ou mais) para Redis, um para Postgres, um para n8n-main, dois ou mais para n8n-worker. Cada um roda sua própria imagem e processo.

A rede `PolygonNetwork` é compartilhada entre os serviços do stack (e com outros stacks que usem essa rede), então main, workers, Redis e Postgres se enxergam por nome do serviço (ex.: `redis`, `postgres`).

---

## 2. Arquitetura (stack completo)

| Serviço     | Função |
|------------|--------|
| **redis**  | Fila Bull: main enfileira execuções, workers consomem. |
| **postgres** | Banco do n8n (workflows, credenciais, execuções). Queue mode exige Postgres (não SQLite). |
| **n8n-main** | UI, API e recebimento de webhooks. Envia jobs para o Redis. Exposto pelo Traefik. |
| **n8n-worker** | N processos que só executam workflows (replicas configurável). |

Fluxo: Webhook → main → Redis → worker executa → resultado no Postgres.

## 3. Variáveis obrigatórias

Definir no Portainer ao criar/atualizar o stack (ou em arquivo `.env` no mesmo diretório do compose).

| Variável | Descrição |
|----------|-----------|
| `N8N_ENCRYPTION_KEY` | Chave única; **deve ser a mesma** no main e em todos os workers. Gerar uma segura (ex.: `openssl rand -hex 32`) e guardar em lugar seguro. |
| `N8N_WEBHOOK_URL` | URL pública do n8n (HTTPS). Ex.: `https://n8n.stratostech.com.br`. O Supabase usará `N8N_INGRESS_WEBHOOK_URL = ${N8N_WEBHOOK_URL}/webhook/stratosbotsaas`. |
| `N8N_DB_PASSWORD` | Senha do usuário Postgres do n8n (banco criado pelo serviço `postgres`). |

## 4. Variáveis opcionais

| Variável | Default | Descrição |
|----------|--------|-----------|
| `N8N_HOSTNAME` | `n8n.stratostech.com.br` | Host no Traefik (rule `Host(...)`). Deve bater com o domínio que aponta para o Swarm. |
| `N8N_DB_USER` | `n8n` | Usuário Postgres. |
| `N8N_DB_NAME` | `n8n` | Nome do banco. |
| `N8N_WORKER_REPLICAS` | `2` | Número de réplicas do serviço `n8n-worker`. |
| `N8N_GENERIC_TIMEZONE` | `America/Sao_Paulo` | Timezone do n8n. |
| `N8N_INGRESS_API_KEY` | - | Se configurar auth no webhook do n8n, use o mesmo valor no Supabase (Secrets da Edge Function). |

## 5. Pré-requisitos

- Rede **PolygonNetwork** existente no Swarm (igual às outras stacks).
- Traefik com entrypoints `web` e `websecure` e cert resolver `letsencryptresolver`.
- DNS: o host escolhido (ex.: `n8n.stratostech.com.br`) apontando para o IP do Traefik.

## 6. Deploy no Portainer

1. **Stacks** → **Add stack**.
2. Nome (ex.: `n8n-queue`).
3. Build method: **Web editor** (ou upload do `docker-compose.n8n-queue.swarm.yml`).
4. Colar o conteúdo de `docker-compose.n8n-queue.swarm.yml`.
5. Em **Environment variables** (ou **Env**), adicionar:
   - `N8N_ENCRYPTION_KEY` = (sua chave)
   - `N8N_WEBHOOK_URL` = `https://n8n.stratostech.com.br` (ou seu host)
   - `N8N_DB_PASSWORD` = (senha forte para o Postgres n8n)
6. **Deploy the stack**.

## 7. Após o deploy

1. Acessar a UI: `https://n8n.stratostech.com.br` (ou o `N8N_HOSTNAME` que definiu).
2. Criar o primeiro usuário (owner) e importar o workflow **StratosBot/n8n-workflow-saas-stratosbot.json**.
3. Ativar o workflow e copiar a **Production URL** do nó Webhook (ex.: `https://n8n.stratostech.com.br/webhook/stratosbotsaas`).
4. No **Supabase** → Edge Functions → **whatsapp-webhook** → Secrets:
   - `N8N_INGRESS_WEBHOOK_URL` = essa URL de produção.

Assim as mensagens do WhatsApp (Evolution) serão enviadas ao n8n; o main enfileira no Redis e os workers executam o workflow.

## 8. Escalar workers

No Portainer, editar o stack e alterar a variável **N8N_WORKER_REPLICAS** (ex.: `3` ou `4`). Ou editar o compose e aumentar `replicas` do serviço `n8n-worker`. Deploy novamente.

## 9. Redis com senha (opcional)

Para proteger o Redis na rede interna:

1. No compose, no serviço **redis**, descomentar/ajustar:
   ```yaml
   command: ["redis-server", "--requirepass", "${REDIS_PASSWORD}"]
   ```
2. Adicionar variável **REDIS_PASSWORD** no stack.
3. Nos serviços **n8n-main** e **n8n-worker**, descomentar:
   ```yaml
   QUEUE_BULL_REDIS_PASSWORD: ${REDIS_PASSWORD}
   ```

## 10. Referências

- **Guia queue mode:** `docs/N8N_QUEUE_MODE_GUIA.md`
- **Plano de escala (1 workflow):** `docs/PLANO_ESCALA_SAAS_UM_WORKFLOW_N8N.md`
- n8n: [Configuring queue mode](https://docs.n8n.io/hosting/scaling/queue-mode/)

---

## Só workers (n8n e Redis já existentes)

Se você **já tem n8n (main) e Redis** rodando (fora deste stack ou em outro stack), não precisa subir main, Redis nem Postgres de novo. Basta rodar **só os workers** no Swarm, apontando para o seu Redis e o banco do n8n.

- **Compose:** `docker-compose.n8n-workers-only.swarm.yml`
- Cada worker é um **container separado**; você define quantas réplicas quer.
- O n8n main continua onde está (outro host, outro stack ou mesmo máquina). Ele já deve estar com `EXECUTIONS_MODE=queue` e conectado ao mesmo Redis e ao mesmo Postgres que você informar aqui.

**Variáveis obrigatórias (no Portainer / env do stack):**

| Variável | Descrição |
|----------|-----------|
| `N8N_ENCRYPTION_KEY` | **Mesma** chave do seu n8n main (obrigatório para workers lerem credenciais). |
| `QUEUE_BULL_REDIS_HOST` | Host do seu Redis (IP ou hostname acessível a partir dos nós do Swarm). |
| `QUEUE_BULL_REDIS_PORT` | Porta do Redis (ex.: 6379). |
| `DB_POSTGRESDB_HOST` | Host do Postgres onde o n8n guarda workflows/execuções. |
| `DB_POSTGRESDB_PORT` | Porta (ex.: 5432). |
| `DB_POSTGRESDB_DATABASE` | Nome do banco n8n. |
| `DB_POSTGRESDB_USER` | Usuário. |
| `DB_POSTGRESDB_PASSWORD` | Senha. |

Opcional: `QUEUE_BULL_REDIS_PASSWORD`, `N8N_WORKER_REPLICAS`, `N8N_WORKER_CONCURRENCY`.

**Rede:** Os workers precisam conseguir acessar Redis e Postgres. Se Redis/Postgres estão em outro servidor, use o IP/hostname desse servidor. Se estão em outro stack no mesmo Swarm, use o **nome do serviço** como host (ex.: `redis`, `postgres`) e coloque os workers na mesma rede (`PolygonNetwork` ou a rede onde Redis/Postgres estão).
