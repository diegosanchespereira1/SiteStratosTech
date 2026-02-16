FROM node:20-alpine

WORKDIR /app

COPY . .

EXPOSE 5173

VOLUME ["/app/data"]

ENV NODE_ENV=production
ENV PORT=5173
ENV HOST=0.0.0.0

CMD ["node", "server.mjs"]
