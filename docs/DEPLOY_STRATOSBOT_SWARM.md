# Deploy StratosBot SaaS (Portainer / Swarm)

Stack usa o mesmo `docker-compose.stratosbot.swarm.yml`: Traefik, rede `PolygonNetwork`, host `stratosbot.stratostech.com.br`.

## 1. Build da imagem (opcional)

Se você faz build **no Mac** e sobe para uma **VPS Linux (amd64)**, use `--platform linux/amd64` para evitar container que não inicia / log vazio:

```bash
cd StratosBot
docker build --platform linux/amd64 -t polygonuser/stratosbot:latest .
docker push polygonuser/stratosbot:latest
```

Se a VPS for ARM (ex.: Oracle Ampere), use `--platform linux/arm64`. Se build já for feito na própria VPS, pode usar só:

```bash
docker build -t polygonuser/stratosbot:latest .
```

## 2. Variáveis no Portainer (SUPABASE_URL e SUPABASE_ANON_KEY)

O onboarding só funciona se o container receber `SUPABASE_URL` e `SUPABASE_ANON_KEY`. Há duas formas:

### Opção A: Environment variables do stack (no deploy)

1. No Portainer: **Stacks** → abra o stack do StratosBot.
2. Clique em **Editor** (ou **Web editor**).
3. Role até a área **Environment variables** (ou **Env**) **do stack** (não do serviço).
4. Adicione duas entradas com o **nome exato** (case-sensitive):
   - Nome: `SUPABASE_URL` — Valor: `https://SEU_PROJECT_REF.supabase.co`
   - Nome: `SUPABASE_ANON_KEY` — Valor: a chave **anon public** do Supabase (Dashboard → Project Settings → API).
5. Clique em **Update the stack**.

Em alguns ambientes Swarm/Portainer as env vars do stack **não** são passadas ao container. Se após atualizar o stack o onboarding ainda mostrar "Configure config.js com SUPABASE_URL e SUPABASE_ANON_KEY", use a **Opção B**.

### Opção B: Docker secrets (recomendado se a Opção A não funcionar)

1. No Portainer: **Secrets** → **Add secret**.
   - Nome: `SUPABASE_URL` — Valor: `https://SEU_PROJECT_REF.supabase.co`
   - Nome: `SUPABASE_ANON_KEY` — Valor: chave anon do Supabase.
2. No **Editor** do stack, no serviço `stratosbot`, descomente as linhas:
   ```yaml
   secrets:
     - SUPABASE_URL
     - SUPABASE_ANON_KEY
   ```
3. No **final** do arquivo, descomente:
   ```yaml
   secrets:
     SUPABASE_URL:
       external: true
     SUPABASE_ANON_KEY:
       external: true
   ```
4. **Update the stack**.

O entrypoint do container lê primeiro as env vars; se estiverem vazias, lê de `/run/secrets/SUPABASE_URL` e `/run/secrets/SUPABASE_ANON_KEY`.

### Conferir no log do container

Após o deploy, abra o serviço **stratosbot** → **Logs**. Deve aparecer:

- `[stratosbot] config.js gerado com SUPABASE_URL e SUPABASE_ANON_KEY.` — valores recebidos.
- Se aparecer `AVISO: SUPABASE_URL ou SUPABASE_ANON_KEY vazios` — o container não recebeu as variáveis; use a Opção B (secrets).

## 3. Evolution e n8n

Podem estar em outro stack. No Supabase (Edge Functions → Secrets) configure:

- `EVOLUTION_API_BASE_URL`, `EVOLUTION_API_KEY`, `EVOLUTION_WEBHOOK_SECRET`
- `N8N_INGRESS_WEBHOOK_URL` (URL pública do webhook do workflow SaaS)

## 4. URLs

- Landing: `https://stratosbot.stratostech.com.br/` → `stratosbot.html`
- Onboarding SaaS: `https://stratosbot.stratostech.com.br/onboarding.html` (ou `/onboarding`)

## 5. Troubleshooting (serviço sem log / não inicia)

| Sintoma | Causa provável | Solução |
|--------|-----------------|---------|
| Status do serviço sem informação no log | Imagem buildada no Mac (arm64) rodando em VPS amd64 | Rebuild com `docker build --platform linux/amd64 -t polygonuser/stratosbot:latest .` e push de novo. |
| Container sai imediatamente / log vazio | Entrypoint com CRLF (Windows) | Já corrigido no Dockerfile (`sed -i 's/\r$//'`). Rebuild da imagem. |
| Log mostra "Starting nginx..." e depois nada | Nginx não sobe (config/porta) | Confira no container: `docker run --rm -it polygonuser/stratosbot:latest sh` e rode `/docker-entrypoint.sh` manualmente para ver erro. |
| 502 Bad Gateway no Traefik | Container não escuta na porta 80 | Verifique se o serviço está "Running" e se a rede (PolygonNetwork) está correta. |
| Onboarding mostra "Configure config.js com SUPABASE_URL e SUPABASE_ANON_KEY" | Container não recebeu as env vars no Swarm | Use **Docker secrets** (Opção B na seção 2). Confira os logs do container: se aparecer "AVISO: SUPABASE_URL ou SUPABASE_ANON_KEY vazios", as variáveis não chegaram. |
