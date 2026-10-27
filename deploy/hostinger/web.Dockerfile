FROM node:24-alpine AS build
WORKDIR /app/client
COPY client/package.json client/package-lock.json ./
RUN npm ci
COPY client/src/ ./src/
COPY client/public/ ./public/
ARG REACT_APP_API_BASE
RUN test -n "$REACT_APP_API_BASE" && npm run build

FROM nginx:stable-alpine
COPY deploy/hostinger/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/client/build/ /usr/share/nginx/html/
EXPOSE 80
