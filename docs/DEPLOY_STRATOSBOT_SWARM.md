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

## 2. Variáveis no Portainer

No stack do Portainer que usa `docker-compose.stratosbot.swarm.yml`, defina:

| Variável             | Obrigatório | Descrição |
|----------------------|-------------|-----------|
| `SUPABASE_URL`       | Sim (SaaS)  | URL do projeto Supabase (ex.: `https://xxxx.supabase.co`) |
| `SUPABASE_ANON_KEY`  | Sim (SaaS)  | Chave anon do Supabase (Project Settings → API) |
| `STRATOSBOT_IMAGE`   | Não         | Default: `polygonuser/stratosbot:latest` |

O `config.js` do frontend é gerado no startup do container a partir dessas envs.

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
