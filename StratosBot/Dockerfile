# Sempre buildar para linux/amd64 (servidores/Swarm). No Mac use: ./build.sh ou docker build --platform linux/amd64
FROM --platform=linux/amd64 nginx:alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY stratosbot.html /usr/share/nginx/html/stratosbot.html
COPY onboarding.html /usr/share/nginx/html/onboarding.html
COPY config.js /usr/share/nginx/html/config.js

EXPOSE 80
