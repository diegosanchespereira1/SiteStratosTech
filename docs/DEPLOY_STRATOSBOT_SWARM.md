# Deploy StratosBot SaaS (Portainer / Swarm)

Stack usa o mesmo `docker-compose.stratosbot.swarm.yml`: Traefik, rede `PolygonNetwork`, host `stratosbot.stratostech.com.br`.

## 1. Build da imagem (opcional)

Se você faz build local e sobe para o registry:

```bash
cd StratosBot
docker build -t polygonuser/stratosbot:latest .
docker push polygonuser/stratosbot:latest
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
