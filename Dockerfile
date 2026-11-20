# FreshnessGuard Backend Service Dockerfile (Render & Cloud Deployment)
# ----------------------------------------------------------------------
FROM node:20-alpine AS builder

WORKDIR /app

# Copy server package manifests and install all build dependencies
COPY server/package*.json ./server/
WORKDIR /app/server
RUN npm install --legacy-peer-deps

# Copy TypeScript configuration and source files
COPY server/tsconfig.json ./
COPY server/src/ ./src/

# Compile TypeScript to JavaScript in /app/server/dist
RUN npm run build

# ── Production Runtime Stage ──────────────────────────────────────────
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

# Install production-only dependencies
COPY server/package*.json ./
RUN npm install --omit=dev --legacy-peer-deps

# Copy compiled JavaScript output from builder stage
COPY --from=builder /app/server/dist ./dist

# Expose port (Render automatically provides and binds $PORT, default 3001)
EXPOSE 3001

HEALTHCHECK --interval=20s --timeout=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:${PORT:-3001}/healthz || exit 1

CMD ["node", "dist/index.js"]
