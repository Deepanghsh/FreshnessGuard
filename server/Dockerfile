FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm install --legacy-peer-deps

COPY tsconfig.json ./
COPY src/ ./src/

RUN npm run build

FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

COPY package*.json ./
RUN npm install --omit=dev --legacy-peer-deps

COPY --from=builder /app/dist ./dist

EXPOSE 3001

HEALTHCHECK --interval=20s --timeout=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:${PORT:-3001}/healthz || exit 1

CMD ["node", "dist/index.js"]
