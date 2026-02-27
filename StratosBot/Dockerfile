FROM nginx:alpine

RUN apk add --no-cache gettext

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

COPY stratosbot.html /usr/share/nginx/html/stratosbot.html
COPY onboarding.html /usr/share/nginx/html/onboarding.html
COPY config.js.template /usr/share/nginx/html/config.js.template

# config.js é gerado em runtime pelo entrypoint (SUPABASE_URL, SUPABASE_ANON_KEY)
RUN touch /usr/share/nginx/html/config.js

ENTRYPOINT ["/docker-entrypoint.sh"]
EXPOSE 80
