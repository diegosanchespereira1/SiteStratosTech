FROM node:20-alpine

WORKDIR /app

# Compatibilidade com stacks que injetam build args (ex.: Vite).
# Aqui nao usamos isso no build, mas aceitar os args evita erro em `docker build --build-arg ...`.
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_PUBLISHABLE_KEY

# App é estático + server.mjs (sem dependências npm).
COPY . .

# Porta padrão do server.mjs
EXPOSE 5173

# Persistência do fallback local (data/registry.json)
VOLUME ["/app/data"]

ENV NODE_ENV=production
ENV PORT=5173
ENV HOST=0.0.0.0

CMD ["node", "server.mjs"]

