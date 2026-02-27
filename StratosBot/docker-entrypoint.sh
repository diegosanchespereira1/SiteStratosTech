#!/bin/sh
set -e
# Gera config.js a partir do template e variáveis de ambiente (para deploy SaaS no Portainer/Swarm).
envsubst '${SUPABASE_URL} ${SUPABASE_ANON_KEY}' \
  < /usr/share/nginx/html/config.js.template \
  > /usr/share/nginx/html/config.js
exec nginx -g "daemon off;"
