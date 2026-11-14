# FreshnessGuard Deployment Guide

## Prerequisites

| Tool | Minimum Version | Notes |
|------|----------------|-------|
| Docker | 24+ | Required for containerised deployment |
| Docker Compose | v2.x | Included with Docker Desktop |
| Tavily API key | — | **Required** for live claim verification |
| OpenAI API key | — | Optional — regex fallback activates automatically if omitted |

> **Linux requirement for plugin build:** The Bifrost plugin (`.so` file) must be compiled on Linux. The `plugin-builder` Docker Compose profile handles this automatically. Building the plugin directly on macOS or Windows is not supported by Go's `plugin` build mode.

---

## Environment Setup

Copy the root `.env.example` to `.env` and fill in your values:

```bash
cp .env.example .env
```

**Never commit real secrets.** The table below describes every variable:

| Variable | Required | Default (example) | Description |
|----------|----------|-------------------|-------------|
| `PORT` | ❌ | `3001` | Port the server listens on |
| `NODE_ENV` | ❌ | `production` | Node environment |
| `LLM_MODEL` | ❌ | `gpt-4o-mini` | Default LLM model for claim extraction |
| `CORS_ORIGINS` | ❌ | `http://localhost:5173,...` | Comma-separated allowed CORS origins |
| `FRESHNESSGUARD_MODE` | ❌ | `inline` | Default processing mode (`inline`\|`async`\|`basic`\|`bypass`) |
| `FRESHNESSGUARD_API_KEY` | ❌ | *(empty)* | Optional API key enforcing auth on POST /api/check and /api/verify/:id |
| `MONGODB_URI` | ❌ | `mongodb://mongodb:27017/freshnessguard` | MongoDB connection string |
| `TAVILY_API_KEY` | ✅ | `tvly-your-key-here` | Tavily search API key |
| `OPENAI_API_KEY` | ❌ | `sk-your-key-here` | OpenAI API key (regex fallback if omitted) |
| `OPENAI_BASE_URL` | ❌ | `https://api.openai.com/v1` | Override for custom OpenAI-compatible endpoints |
| `BIFROST_HOST` | ❌ | `http://bifrost:8080` | Internal Bifrost base URL |
| `BIFROST_ENCRYPTION_KEY` | ❌ | *(placeholder)* | Encryption key for Bifrost at-rest secrets |
| `RATE_LIMIT_WINDOW_MS` | ❌ | `60000` | Rate-limit window in milliseconds |
| `RATE_LIMIT_MAX` | ❌ | `100` | Maximum requests per window across all /api routes |
| `RATE_LIMIT_CHECK_MAX` | ❌ | `60` | Stricter rate limit on POST /api/check verification calls |
| `CACHE_MAX_ENTRIES` | ❌ | `1000` | Maximum in-memory L1 LRU cache entries before eviction |

---

## MongoDB Configuration & Database Isolation

FreshnessGuard enforces strict separation of database environments across three isolated namespaces:

1. **`freshnessguard` (Production)**: Untouched production collection.
2. **`freshnessguard_demo` (Demo & Development)**: Isolated collection pre-seeded with reproducible demo scenarios.
3. **`freshnessguard_test` (Automated Tests)**: Dedicated test database populated by integration tests and purged on teardown.

### Security Warning: Atlas Network Access

> [!CAUTION]
> **Production Network Security**: During initial rapid prototyping on dynamic consumer cellular connections, temporary `0.0.0.0/0` IP access was enabled to establish connectivity. **`0.0.0.0/0` MUST NEVER BE USED IN PRODUCTION DEPLOYMENTS.**
>
> In production environments, MongoDB Atlas network access must be locked down using one of the following methods:
> - **VPC Peering / AWS PrivateLink / GCP Private Service Connect**: Direct private network route from your gateway/service cluster to the Atlas cluster.
> - **Static IP Whitelisting**: Strict single IP or CIDR block whitelist matching the dedicated NAT Gateway or static elastic IP of your production ECS/Kubernetes nodes.

### Connection String Credentials Hygiene

Never commit raw database URIs containing plaintext credentials to source control or logs. The FreshnessGuard server automatically sanitizes connection strings in logs by masking credentials (`mongodb+srv://<credentials>@...`).

---

## Docker Compose Quick Start

### 1. Build the Bifrost plugin (Linux only)

The plugin must be compiled before starting the main stack. Use the dedicated `plugin-builder` profile:

```bash
docker compose --profile build-plugin up plugin-builder
```

This builds `freshnessguard.so` using `golang:1.27-alpine` and copies it to `./plugins/freshnessguard.so`. The file is then mounted into the Bifrost container at `/app/plugins/`.

### 2. Start the full stack

```bash
docker compose up -d
```

This starts all four core services (see table below). Pull images first if needed:

```bash
docker compose pull
docker compose up -d
```

### 3. Verify everything is running

```bash
docker compose ps
```

### 4. Stop the stack

```bash
docker compose down
```

To also remove the persistent MongoDB volume:

```bash
docker compose down -v
```

---

## Service URLs

| Service | Internal Name | External URL | Notes |
|---------|--------------|--------------|-------|
| Server (API) | `server` | `http://localhost:3001` | REST API + SSE |
| Client (UI) | `client` | `http://localhost:5173` | nginx-served React app (maps to internal port 80) |
| Bifrost | `bifrost` | `http://localhost:8080` | LLM gateway |
| MongoDB | `mongodb` | *(internal only)* | Not exposed externally |

---

## Health Check Commands

```bash
# Server health (via Docker host)
curl http://localhost:3001/healthz

# Server health (via Docker network — from another container)
curl http://server:3001/healthz

# MongoDB connectivity reflected in health response
curl http://localhost:3001/healthz | jq .mongodb
```

Expected healthy response:

```json
{
  "status": "ok",
  "service": "freshnessguard",
  "version": "1.0.0",
  "mongodb": "connected",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "sseClients": 0
}
```

---

## Plugin Build Process (Detail)

The Bifrost plugin is a Go shared object (`.so`) that must be built targeting the same Go version used by Bifrost.

| Detail | Value |
|--------|-------|
| Builder image | `golang:1.27-alpine` |
| Bifrost version | `maximhq/bifrost:v2.5.1` |
| Go version (Bifrost) | `1.27.3` (from `go.work`) |
| Build command | `go build -buildmode=plugin -trimpath -ldflags="-s -w" -o /build/freshnessguard.so .` |
| Output path (host) | `./plugins/freshnessguard.so` |
| Mounted path (Bifrost) | `/app/plugins/freshnessguard.so` |

**Why Linux only?** Go's `-buildmode=plugin` is only supported on Linux. The `plugin-builder` Docker Compose service runs a Linux container for this reason, even when the host is macOS or Windows.

```bash
# Rebuild the plugin after code changes
docker compose --profile build-plugin up --build plugin-builder
```

---

## Logs

```bash
# Tail all services
docker compose logs -f

# Tail a specific service
docker compose logs -f server
docker compose logs -f client
docker compose logs -f bifrost
docker compose logs -f mongodb
```

---

## Troubleshooting

### MongoDB connection fails at startup

The server starts successfully even if MongoDB is unavailable (degraded mode — see below). Check the connection string in your `.env`:

```bash
# Verify MongoDB is reachable from host
docker compose exec server wget -qO- http://localhost:3001/healthz
```

### Bifrost plugin not loading

> **Known limitation:** Live Bifrost plugin loading has not been verified in this release. If the plugin fails to load, check that:
> 1. `freshnessguard.so` exists in `./plugins/` after running the builder.
> 2. The Go version of the builder matches Bifrost's Go runtime exactly (`1.27.3`).
> 3. The plugin was built on a Linux host or via the Docker builder.

### OpenAI rate limit (429)

No action required. FreshnessGuard automatically falls back to its built-in regex extractor when OpenAI returns a 429 or is unavailable.

### Tavily rate limit

Tavily is limited to **10 requests per minute per Node.js process**. For high-throughput workloads:
- Use `mode=async` to prevent blocking HTTP responses.
- Stagger check requests using a queue or scheduler.

### Port conflicts

If ports 3001, 5173, or 8080 are already in use, override them in `docker-compose.override.yml` or update the `ports` mapping in `docker-compose.yml`.

---

## MongoDB-less Degraded Mode

FreshnessGuard is designed to start and remain operational even when MongoDB is unreachable.

| Feature | Degraded behaviour |
|---------|-------------------|
| `GET /api/responses` | Returns `{ data: [], total: 0, ... }` |
| `GET /api/responses/:id` | Returns `404` |
| `GET /api/stats` | Returns all zeros (except in-memory cache metrics) |
| `POST /api/check` | Verification still runs; persistence is skipped silently (logged as warning) |
| L1 in-memory cache | Fully operational |
| Tavily verification | Fully operational |
| SSE stream | Fully operational |

Persistence failures are logged at `warn` level and do **not** surface as errors to API callers. MongoDB reconnection is automatic — once the database comes back online, persistence resumes without a server restart.

---

## Known Deployment Limitations

| Limitation | Detail |
|------------|--------|
| Docker deployment not tested | No Docker daemon was available during development; the Compose configuration is based on the service definitions but has not been run end-to-end. |
| Bifrost plugin loading not live-tested | The `.so` build process is validated via the builder image, but actual plugin load-and-dispatch through Bifrost has not been verified live. |
| Live OpenAI integration | The LLM extraction path works via mock in tests; live OpenAI calls have not been exercised in this environment. |
| Live evaluation script | The evaluation harness exists but has not been run against a live deployment. |
