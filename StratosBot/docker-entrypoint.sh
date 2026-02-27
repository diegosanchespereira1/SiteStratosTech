#!/bin/sh
set -e
# Garante LF (evita "bad interpreter" em Linux quando o arquivo tem CRLF)
# Gera config.js a partir do template e variáveis de ambiente (deploy SaaS Portainer/Swarm).
echo "[stratosbot] Gerando config.js..."
if command -v envsubst >/dev/null 2>&1; then
  envsubst '${SUPABASE_URL} ${SUPABASE_ANON_KEY}' \
    < /usr/share/nginx/html/config.js.template \
    > /usr/share/nginx/html/config.js 2>/dev/null || true
fi
if [ ! -s /usr/share/nginx/html/config.js ]; then
  echo "(function(){ \"use strict\"; window.SUPABASE_URL=\"\"; window.SUPABASE_ANON_KEY=\"\"; })();" \
    > /usr/share/nginx/html/config.js
fi
echo "[stratosbot] Iniciando nginx..."
exec nginx -g "daemon off;"
