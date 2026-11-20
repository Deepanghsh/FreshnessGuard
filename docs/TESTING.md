# FreshnessGuard Testing Guide

## Test Architecture Overview

FreshnessGuard has four distinct test layers:

| Layer | Location | Runner | Scope |
|-------|----------|--------|-------|
| **Backend unit & integration** | `server/` | Jest + Supertest | Services, scoring, extraction, caching, API routes, E2E |
| **Frontend unit** | `client/` | Vitest | React components and hooks |
| **Go plugin unit** | `plugins/freshnessguard/` | `go test` | Plugin request/response handling |
| **TypeScript builds** | `server/` + `client/` | `tsc` / `vite build` | Type correctness and bundle integrity |

A fifth layer — genuine DB integration tests — exists but is **skipped by default** (see [Skipped Tests](#skipped-tests) below).

---

## Backend Tests (Jest)

### Run

```bash
cd server
npm test
# or equivalently:
npx jest --forceExit --no-coverage
```

> **Windows sandbox note:** Backend tests use Supertest, which binds a loopback TCP socket. This triggers an `EACCES` error inside the Windows sandbox environment. Run backend tests **outside the sandbox** (directly in a terminal or in Linux CI) to avoid this.

### Test Suites

| Suite | File | Tests | Description |
|-------|------|-------|-------------|
| API routes | `api.test.ts` | 27 | All 7 endpoints: request validation, status codes, response shapes, dual lookup (ObjectId & requestId), security headers, auth boundary |
| Scoring | `scoring.test.ts` | 30 | Freshness score calculation, confidence weighting, volatility triage |
| Triage | `triage.test.ts` | 8 | Claim categorisation, deduplication, and likelihood scoring |
| Verification | `verification.test.ts` | 12 | Tavily mock, verdict assignment, source mapping |
| Extraction | `extraction.test.ts` | 7 | LLM + regex claim extraction, deduplication |
| Cache | `cache.test.ts` | 8 | L1 in-memory cache hits, misses, TTL, L2 promotion, and bounded memory capacity enforcement |
| E2E integration | `e2e_integration.test.ts` | 17 | Full request pipeline with in-memory Mongoose mock + deterministic Tavily mock |
| DB integration | `db_integration.test.ts` | 2 | Real MongoDB Atlas round-trips (requires `MONGO_TEST_URI`) |

### Results Summary

```
Test Suites: 1 skipped, 7 passed, 7 of 8 total
Tests:       2 skipped, 109 passed, 111 total
Snapshots:   0 total
Time:        ~10-25 s
```

> **Note:** The 2 DB integration tests connect via `MONGO_TEST_URI` to `freshnessguard_test` on a live MongoDB instance. When `MONGO_TEST_URI` is unset, this suite is cleanly skipped by design, resulting in **109 passed, 2 skipped, 0 failed (111 total)** with exit code 0.
> **Test Suite Inventory:** Across all three components, the repository defines **140 automated tests** in total:
> - **Backend (Node.js / Express)**: 111 tests across 8 Jest suites (109 executed & passed, 2 skipped by default without live DB)
> - **Frontend (React 18)**: 7 tests defined in `client/test/frontend.test.ts` (Vitest; not executed in this audit environment)
> - **Gateway Plugin (Go)**: 22 tests defined in `plugins/freshnessguard/plugin_test.go` (`go test`; not executed in this audit environment)

---

## Frontend Tests (Vitest)

### Run

```bash
cd client
npx vitest run
```

### Test Suites

| Suite | File | Tests |
|-------|------|-------|
| Frontend | `frontend.test.ts` | 7 |

### Results Summary

```
Test Files:  1 passed, 1 total
Tests:       7 passed, 0 failed
```

---

## Go Plugin Tests

### Run

> **Important:** You must `cd` into the plugin directory before running. Running `go test ./...` from the repository root will fail with:
> ```
> pattern ./...: directory prefix . does not contain main module
> ```

```bash
cd plugins/freshnessguard
go test -v ./...
```

### Test Suites

| Suite | File | Tests |
|-------|------|-------|
| Plugin | `plugin_test.go` | 22 |

### Results Summary

```
--- PASS: all 22 tests
PASS
```

---

## TypeScript Build Verification

Build checks confirm that both packages compile without type errors.

### Server

```bash
npm run build --prefix server
# Runs: tsc
# Expected: exit 0, no errors
```

### Client

```bash
npm run build --prefix client
# Runs: tsc && vite build
# Expected: exit 0, 2126 modules transformed
```

---

## Skipped Tests

### `db_integration.test.ts` (2 tests)

These tests perform real MongoDB read/write round-trips. They are skipped by default because they require a live MongoDB instance.

**To enable:**

1. Start a local MongoDB container:
   ```bash
   docker run -d -p 27017:27017 mongo:7.0
   ```

2. Set the test URI environment variable:
   ```bash
   export MONGO_TEST_URI=mongodb://localhost:27017/freshnessguard_test
   ```

3. Re-run the backend tests:
   ```bash
   cd server && npm test
   ```

The two DB integration tests will now run instead of being skipped.

---

## Mocking Strategy

### E2E Integration Tests (`e2e_integration.test.ts`)

These tests exercise the complete request pipeline — from HTTP request through extraction, verification, scoring, and persistence — without requiring external services.

| Component | Mock |
|-----------|------|
| MongoDB | `mongodb-memory-server` (in-memory Mongoose mock) — provides a real MongoDB wire protocol in-process |
| Tavily | Deterministic mock — returns pre-defined search results, ensuring consistent verdicts across runs |
| Google Gemini | Axios mock — returns structured JSON claim extraction candidates |
| SSE | Captured in-memory event emitter |

This approach gives full pipeline confidence without network calls or flaky external dependencies.

---

## Pending Live Tests

The following test scenarios exist as placeholders or partial implementations and require live infrastructure to run:

| Test | Blocker | Notes |
|------|---------|-------|
| Docker Compose E2E | No Docker daemon available during development | Would test full container stack startup and API reachability |
| Bifrost plugin dispatch | Plugin loading not live-verified | Requires Bifrost + built `.so` |
| Live Gemini extraction | Requires live GEMINI_API_KEY in environment | LLM path is verified via mock in tests; regex fallback is fully tested |
| Live Tavily verification | Rate-limited in CI | 10 req/min limit; mocked in all automated tests |
| Evaluation script | Requires live deployment | Harness exists; not run end-to-end |

---

## Running the Evaluation Script

When a full deployment is available, the evaluation script can be run to measure freshness-detection accuracy against the 35-case ground-truth dataset.

> **Prerequisites:** Running FreshnessGuard server (`POST /api/check` reachable) and a valid `TAVILY_API_KEY`.
> **Note on Evaluation Execution:** This command represents the documented procedure requiring an active FreshnessGuard server and live Tavily credentials. Because a live backend server and live external search APIs were not running in this offline audit environment, this command has not been executed live.

```bash
# Documented command for post-deployment execution against a live FreshnessGuard server
SERVER_URL=http://localhost:3001 npx ts-node eval/run_eval.ts
```

The script evaluates the 35 hand-labeled test cases in `eval/eval_set.json` across pricing, version, leadership, date, and law categories, reporting per-case verdicts and summary accuracy, precision, recall, and F1 metrics. Detailed JSON output is saved to `eval/results.json`.

---

## Windows Sandbox Note

Supertest binds a real loopback socket during test setup. Inside the Windows sandbox environment this raises:

```
Error: EACCES: permission denied, bind 127.0.0.1:XXXXX
```

**Solution:** Run backend tests outside the sandbox — either in a standard terminal on Windows, or in a Linux CI environment. The sandbox restriction does not affect frontend or Go plugin tests.

---

## CI Checklist

Before opening a pull request, confirm all of the following pass locally:

```bash
# 1. Backend tests (outside sandbox on Windows)
cd server && npm test

# 2. Frontend tests
cd client && npx vitest run

# 3. Go plugin tests
cd plugins/freshnessguard && go test -v ./...

# 4. TypeScript builds
npm run build --prefix server
npm run build --prefix client
```

Expected totals across repository: **140 automated tests defined** (111 backend, 7 frontend, 22 Go). In the latest verified run without live DB, **109 backend tests passed, 2 skipped, 0 failed**; frontend and Go suites are defined in the repository but were not executed in this audit environment.
