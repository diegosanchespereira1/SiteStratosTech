#!/bin/sh
set -e
# Gera config.js a partir do template (Portainer/Swarm: env ou Docker secrets).
echo "[stratosbot] Gerando config.js..."

# Se as env estiverem vazias, tenta ler de Docker secrets (Swarm)
if [ -z "$SUPABASE_URL" ] && [ -f /run/secrets/SUPABASE_URL ]; then
  export SUPABASE_URL="$(cat /run/secrets/SUPABASE_URL)"
fi
if [ -z "$SUPABASE_ANON_KEY" ] && [ -f /run/secrets/SUPABASE_ANON_KEY ]; then
  export SUPABASE_ANON_KEY="$(cat /run/secrets/SUPABASE_ANON_KEY)"
fi

if command -v envsubst >/dev/null 2>&1 && [ -n "$SUPABASE_URL" ] && [ -n "$SUPABASE_ANON_KEY" ]; then
  envsubst '${SUPABASE_URL} ${SUPABASE_ANON_KEY}' \
    < /usr/share/nginx/html/config.js.template \
    > /usr/share/nginx/html/config.js
  echo "[stratosbot] config.js gerado com SUPABASE_URL e SUPABASE_ANON_KEY."
else
  if [ -z "$SUPABASE_URL" ] || [ -z "$SUPABASE_ANON_KEY" ]; then
    echo "[stratosbot] AVISO: SUPABASE_URL ou SUPABASE_ANON_KEY vazios. Onboarding mostrara erro de config. Defina no Portainer: Stack > Editor > Env vars (SUPABASE_URL e SUPABASE_ANON_KEY) ou use Docker secrets."
  fi
  echo '(function () { "use strict"; window.SUPABASE_URL = ""; window.SUPABASE_ANON_KEY = ""; })();' > /usr/share/nginx/html/config.js
fi
echo "[stratosbot] Iniciando nginx..."
exec nginx -g "daemon off;"
