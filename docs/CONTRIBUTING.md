# Contributing to FreshnessGuard

Thank you for contributing! This document covers everything you need to get a local development environment running, understand the codebase conventions, and submit changes.

---

## Repository Structure

```
.
├── server/                   # Node.js / TypeScript API server
│   ├── src/
│   │   ├── routes/           # Express route handlers (api.ts)
│   │   ├── services/         # Core logic: extraction, verification, scoring, cache
│   │   ├── models/           # Mongoose schemas (IResponse, IClaim, etc.)
│   │   └── index.ts          # App entry point
│   ├── tests/                # Jest test suites
│   ├── tsconfig.json
│   └── package.json
│
├── client/                   # React / TypeScript front-end (Vite)
│   ├── src/
│   ├── tests/                # Vitest test suites
│   ├── tsconfig.json
│   └── package.json
│
├── plugins/
│   └── freshnessguard/       # Go Bifrost plugin source
│       ├── plugin_test.go
│       └── go.mod
│
├── docs/                     # Documentation (you are here)
│   ├── API.md
│   ├── DEPLOYMENT.md
│   ├── TESTING.md
│   └── CONTRIBUTING.md
│
├── eval/                     # Accuracy evaluation harness
├── docker-compose.yml
├── .env.example
└── README.md
```

---

## Development Prerequisites

| Tool | Minimum Version | Purpose |
|------|----------------|---------|
| Node.js | **20+** | Server and client development |
| npm | 10+ | Package management (bundled with Node 20) |
| Go | **1.27+** | Bifrost plugin development (aligns with Bifrost v2.5.1 runtime) |
| MongoDB | **7+** | Persistence layer (local or Docker) |
| Tavily API key | — | **Required** for live claim verification |
| OpenAI API key | — | Optional — regex fallback activates automatically if omitted |

---

## Local Development Setup

### 1. Clone and install dependencies

```bash
git clone <repo-url>
cd freshnessguard

# Install server dependencies
npm install --prefix server

# Install client dependencies
npm install --prefix client
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env — set TAVILY_API_KEY at minimum
```

### 3. Start MongoDB

You can use a local install or Docker:

```bash
docker run -d -p 27017:27017 --name fg-mongo mongo:7.0
```

The server will start in degraded mode (no persistence) if MongoDB is unavailable — this is intentional and safe for development.

### 4. Start the backend server

```bash
cd server
npm run dev       # ts-node-dev / nodemon watch mode
```

The API server listens on `http://localhost:3001` by default.

### 5. Start the front-end

```bash
cd client
npm run dev       # Vite dev server
```

The UI is served at `http://localhost:5173`.

### 6. (Optional) Go plugin development

```bash
cd plugins/freshnessguard
go test -v ./...        # run unit tests
# Note: .so builds require Linux; use the Docker builder for final compilation
```

---

## Coding Conventions

### TypeScript

- **Strict mode** is enabled in both `server/tsconfig.json` and `client/tsconfig.json`. All code must compile with `"strict": true` — no `any` escapes, no implicit `any`.
- Use **Zod** for all external input validation. Never trust raw `req.body` or `req.query` without a Zod parse. See `server/src/routes/api.ts` for the established patterns.
- All new service modules must be **exported** from their file and must have corresponding **unit tests**. A service with no test will not be accepted.

### Dependency management

- Do **not** run `pip install` or add Python dependencies — this is a Node.js / Go / React project.
- Do **not** add npm or Go dependencies without discussion. Open an issue or PR comment proposing the dependency and its rationale before adding it.

### Error handling — fail-open principle

Verification errors must **never** break the main request path. If Tavily is unreachable, the claim should receive verdict `unverified` and processing continues. If the LLM fails, fall back to regex extraction. If MongoDB persistence fails, log a warning and return the in-memory result to the caller.

```typescript
// ✅ Correct — fail open
try {
  await verifyClaimWithTavily(claim);
} catch (err) {
  logger.warn('Tavily verification failed, marking unverified', { err });
  claim.verdict = 'unverified';
}

// ❌ Wrong — rethrows and breaks the request
await verifyClaimWithTavily(claim); // no try/catch
```

### Safe persistence — `safeSave()` pattern

All Mongoose document saves must go through `safeSave()` (or an equivalent wrapper that guards the `readyState`). Never call `doc.save()` directly in a route or service without a `readyState` check.

```typescript
// ✅ Correct
await safeSave(responseDoc);

// ❌ Wrong — will throw if MongoDB is disconnected
await responseDoc.save();
```

### `readyState` guard

Before **any** Mongoose query (`find`, `findOne`, `countDocuments`, etc.), check the connection `readyState`:

```typescript
import mongoose from 'mongoose';

if (mongoose.connection.readyState !== 1) {
  // Return degraded/empty response instead of throwing
  return { data: [], total: 0, page, limit, pages: 0 };
}
// safe to query
const docs = await Response.find(filter).lean();
```

This is what enables degraded mode — the server stays healthy even without a database.

### SSE events

When adding a new SSE event type, update:
1. The emitter call site (server-side).
2. The `GET /api/events` documentation in `docs/API.md`.
3. Any front-end listener (`client/src/`).

---

## Branch Workflow

1. **Fork** the repository (external contributors) or create a **feature branch** (team members):
   ```bash
   git checkout -b feat/my-feature-name
   ```

2. Keep branches **focused** — one feature or fix per branch.

3. **Rebase** onto `main` before opening a PR to avoid merge conflicts:
   ```bash
   git fetch origin
   git rebase origin/main
   ```

4. Open a **Pull Request** against `main` with:
   - A clear description of what changed and why.
   - Reference to any related issue (`Fixes #123`).
   - Confirmation that the full test suite passes (see below).

5. PRs require at least one review before merging.

---

## Running Tests Before Submitting

All four test commands must pass with zero failures before a PR can be merged:

```bash
# 1. Backend (run outside sandbox on Windows — see TESTING.md)
cd server && npm test

# 2. Frontend
cd client && npx vitest run

# 3. Go plugin
cd plugins/freshnessguard && go test -v ./...

# 4. TypeScript builds
npm run build --prefix server
npm run build --prefix client
```

Expected: **102 backend + 7 frontend + 22 Go = 131 tests passing, 2 skipped, 0 failed.**

See [TESTING.md](./TESTING.md) for full detail on each suite, mocking strategies, and how to enable the skipped DB integration tests.

---

## Common Troubleshooting

### 1. `EACCES loopback socket` on Windows sandbox

**Symptom:** Backend Jest tests fail with `EACCES: permission denied, bind 127.0.0.1:XXXXX`.

**Cause:** Supertest binds a real loopback TCP socket, which is blocked inside the Windows sandbox.

**Fix:** Run `cd server && npm test` in a regular (non-sandboxed) terminal, or in Linux CI.

---

### 2. `pattern ./...: directory prefix . does not contain main module`

**Symptom:** `go test ./...` fails from the repository root.

**Cause:** The `plugins/freshnessguard/` directory is a self-contained Go module with its own `go.mod`.

**Fix:**
```bash
cd plugins/freshnessguard
go test -v ./...
```

---

### 3. MongoDB timeout / connection refused

**Symptom:** Server logs show MongoDB connection errors; `GET /healthz` returns `"mongodb": "disconnected"`.

**Cause:** `MONGODB_URI` in `.env` points to an unreachable instance, or MongoDB is not running.

**Fix:**
```bash
# Start MongoDB via Docker
docker run -d -p 27017:27017 mongo:7.0

# Verify MONGODB_URI in .env
cat .env | grep MONGODB_URI
```

The server continues to operate in degraded mode until MongoDB is available; no restart is needed once it reconnects.

---

### 4. OpenAI 429 (rate limit)

**Symptom:** Log line: `OpenAI rate limit hit, falling back to regex extractor`.

**Action required:** None. FreshnessGuard automatically switches to the built-in regex extractor when OpenAI returns a 429 or is otherwise unavailable. All claims are still extracted and verified — just without LLM-enhanced extraction.

---

### 5. Tavily rate limit

**Symptom:** Verification results intermittently show `verdict: "unverified"` during high-volume runs; Tavily logs show 429 responses.

**Cause:** Tavily enforces a limit of **10 requests per minute per Node.js process**.

**Fixes:**
- Switch to `mode=async` so HTTP responses are not blocked by verification.
- Stagger check requests using a queue or rate-limiter upstream of FreshnessGuard.
- If running multiple Node.js worker processes, note that each has its own token bucket — the aggregate rate limit scales with the number of processes.
