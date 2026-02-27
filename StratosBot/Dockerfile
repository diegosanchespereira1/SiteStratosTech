FROM nginx:alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY stratosbot.html /usr/share/nginx/html/stratosbot.html
COPY onboarding.html /usr/share/nginx/html/onboarding.html
COPY config.js /usr/share/nginx/html/config.js

EXPOSE 80
