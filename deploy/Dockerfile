FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY . .
RUN addgroup -S zipi && adduser -S zipi -G zipi && mkdir -p /app/data && chown -R zipi:zipi /app/data
USER zipi
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --retries=3 CMD wget -qO- http://127.0.0.1:3000/readyz || exit 1
CMD ["node", "server.js"]
