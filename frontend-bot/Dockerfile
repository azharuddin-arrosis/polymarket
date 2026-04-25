FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json .
RUN npm install --legacy-peer-deps
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/templates/default.conf.template
RUN apk add --no-cache gettext wget
ENV BACKEND_HOST=backend
EXPOSE 80
HEALTHCHECK --interval=15s --timeout=5s CMD wget -qO- http://localhost/ || exit 1
CMD ["/bin/sh", "-c", "envsubst '${BACKEND_HOST}' < /etc/nginx/templates/default.conf.template > /etc/nginx/conf.d/default.conf && nginx -g 'daemon off;'"]
