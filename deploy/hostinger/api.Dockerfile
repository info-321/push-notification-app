FROM node:24-alpine
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server/*.js ./
# Keep the relative public-asset path used by server/push.js.
COPY client/public/sdk/ /app/client/public/sdk/
COPY client/public/downloads/ /app/client/public/downloads/
COPY client/public/push-sw.js /app/client/public/push-sw.js
ENV NODE_ENV=production
USER node
EXPOSE 5000
CMD ["node", "index.js"]
