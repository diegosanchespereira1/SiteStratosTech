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

## 2. Config Supabase (StratosBot/config.js)

Para o SaaS, o onboarding lê `SUPABASE_URL` e `SUPABASE_ANON_KEY` diretamente do arquivo **`StratosBot/config.js`** (commitado no repositório). O container apenas serve esses arquivos estáticos.

1. No seu repositório local, edite `StratosBot/config.js`:
   ```js
   (function () {
     "use strict";
     window.SUPABASE_URL = "https://SEU_PROJECT_REF.supabase.co";
     window.SUPABASE_ANON_KEY = "SUA_ANON_KEY_PUBLICA_AQUI";
   })();
   ```
2. Os valores vêm do Supabase: Dashboard → **Project Settings** → **API**:
   - **Project URL** → `SUPABASE_URL`
   - **anon public** → `SUPABASE_ANON_KEY`
3. Faça commit e push desse arquivo.  
4. No Portainer, atualize o stack (ele vai puxar a nova imagem/tag, mas a configuração Supabase é sempre a do `config.js` já empacotado na imagem).

> Observação: a chave **anon** é feita para estar no frontend (é a mesma que o Supabase usa em exemplos React/Vue etc). A proteção real é feita pela RLS no banco; **não** use a chave `service_role` no frontend.

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
| Onboarding mostra "Configure config.js com SUPABASE_URL e SUPABASE_ANON_KEY" | `config.js` não foi atualizado ou a versão antiga da imagem ainda está em uso | Confira se `StratosBot/config.js` no repositório tem os valores corretos, rode o build/push da imagem e atualize o stack no Portainer. |
