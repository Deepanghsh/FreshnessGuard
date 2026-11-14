# FreshnessGuard System Architecture

## 1. System Overview

FreshnessGuard is an end-to-end temporal freshness intelligence layer for LLM gateways. It intercepts model completions, detects time-sensitive factual assertions, verifies them against live web sources, and enriches responses with actionable freshness telemetry and corrections.

```
                              ┌────────────────────────────────────────────────────────┐
                              │                    Bifrost Gateway                     │
                              │                                                        │
[Client Request] ───────────> │  [PreLLMHook] ───> [LLM Provider] ───> [PostLLMHook]   │ ───> [Enriched Response]
                              │  (Bypass check)   (OpenAI, Anthropic)        │         │      (Headers + Notes)
                              └──────────────────────────────────────────────┼─────────┘
                                                                             │
                                                                HTTP POST /api/check (<=2000ms)
                                                                             ▼
                              ┌────────────────────────────────────────────────────────┐
                              │            FreshnessGuard Service (Node.js/Express)    │
                              │                                                        │
                              │  1. Check Bypass Headers / Explicit Mode               │
                              │  2. Two-Tier Cache Lookup (L1 In-Memory -> L2 MongoDB) │
                              │  3. Claim Extraction (OpenAI Schema or Regex Fallback) │
                              │  4. Volatility Triage (Pricing, Versions, Dates, etc.) │
                              │  5. Real-Time Verification via Tavily Search API       │
                              │  6. Multi-Factor Algorithmic Scoring (0.00 - 1.00)     │
                              │  7. Real-Time Telemetry Broadcast via SSE (/api/events)│
                              └────────────────┬───────────────────────┬───────────────┘
                                               │                       │
                                   read/write  ▼                       ▼  live search
                              ┌───────────────────┐        ┌─────────────────────────┐
                              │     MongoDB 7     │        │    Tavily Search API    │
                              │  (Cache & TTL)    │        │ (Live Web Intelligence) │
                              └───────────────────┘        └─────────────────────────┘
                                               │
                                    SSE stream ▼
                              ┌────────────────────────────────────────────────────────┐
                              │          FreshnessGuard Dashboard (React 18 + Vite)    │
                              │  - Overview: KPI Cards, Verdict Ratios, Historical Feed│
                              │  - Inspector: Claim Deep-Dive, Sources, Confidence     │
                              │  - Playground: Interactive Mode Tester & Pipeline View │
                              │  - Architecture: Visual Flow & Latency Budget Specs    │
                              └────────────────────────────────────────────────────────┘
```

---

## 2. Gateway Integration & Go Plugin

### 2.1 Bifrost Plugin Architecture
Bifrost (v2.5.1) loads native Go plugins compiled as Linux shared objects (`.so`) using Go's dynamic plugin loader (`plugin.Open`). FreshnessGuard implements canonical exported lifecycle symbols:

| Symbol | Signature | Execution Stage |
|---|---|---|
| `Init` | `func Init(config any) error` | Called on gateway bootstrap with plugin config map. |
| `GetName` | `func GetName() string` | Returns `"freshnessguard"`. |
| `Cleanup` | `func Cleanup() error` | Called on graceful gateway termination. |
| `PreRequestHook` | `func PreRequestHook(ctx *BifrostContext, req *BifrostRequest) error` | Pre-routing hook. |
| `PreLLMHook` | `func PreLLMHook(ctx *BifrostContext, req *BifrostRequest) (*BifrostRequest, *LLMPluginShortCircuit, error)` | Intercepts request before provider dispatch; injects bypass headers. |
| `PostLLMHook` | `func PostLLMHook(ctx *BifrostContext, resp *BifrostResponse, e *BifrostError) (*BifrostResponse, *BifrostError, error)` | Primary hook: extracts text, queries service, injects headers & correction notes. |

### 2.2 Injected Response Headers
Every completion processed by the plugin receives telemetry headers:
- `X-FreshnessGuard-Score`: Normalized freshness score (`0.00` to `1.00`).
- `X-FreshnessGuard-Stale`: Boolean string (`true` if stale claims exist, otherwise `false`).
- `X-FreshnessGuard-Latency`: Verification overhead in milliseconds.

### 2.3 Strict Fail-Open Guarantee
Gateway availability is strictly protected:
1. **Network Failure**: If the backend service is unreachable or DNS fails, the plugin catches the error and returns the original LLM completion intact.
2. **Timeout Deadline**: If verification exceeds `timeout_ms` (default 2000ms), the HTTP context cancels and the response passes through untouched.
3. **HTTP 5xx**: Server errors return standard HTTP 500; the plugin intercepts this and passes through the completion without modifications.
4. **Streaming / Non-Standard Choice**: Streams and partial chunks bypass claim extraction to prevent buffer corruption.

---

## 3. Request Lifecycle & Operating Modes

FreshnessGuard supports four distinct operating modes:

```
[Incoming Request]
         │
         ├── Mode = "bypass" OR Bypass Header Present?
         │         └── YES ──> Return 200 immediately (no processing)
         │
         ├── Mode = "basic"?
         │         └── YES ──> Regex Extraction + Heuristic Volatility Score (201 Created)
         │
         ├── Mode = "async"?
         │         └── YES ──> Initial "unverified" response (202 Accepted)
         │                     Background worker executes Tavily + pushes SSE update
         │
         └── Mode = "inline" (Default)
                   └───> Check L1/L2 Cache
                         ├── Cache Hit ──> Return Cached Response (200 OK, fromCache=true)
                         └── Cache Miss ─> Extract Claims (LLM or Regex Fallback)
                                           └── Volatility Triage
                                               └── Tavily Live Verification
                                                   └── Multi-Factor Scoring
                                                       └── Save Cache/DB + SSE (201 Created)
```

### 3.1 Mode Comparison

| Mode | HTTP Status | Concurrency / Blocking | Verification Mechanism | Ideal Use Case |
|---|---|---|---|---|
| `inline` | `201 Created` | Blocking (subject to timeout) | LLM/Regex + Tavily API | High-accuracy synchronous gateway inspection |
| `async` | `202 Accepted` | Non-blocking (background worker) | Background Tavily + SSE broadcast | Latency-critical pipelines & conversational chat |
| `basic` | `201 Created` | Fast (<10ms) | Regex heuristics only (no Tavily) | Offline / resource-constrained environments |
| `bypass` | `200 OK` | Zero-overhead pass-through | None | Internal LLM calls & recursion prevention |

---

## 4. Claim Extraction & Volatility Triage

### 4.1 Hybrid Extraction
1. **Primary (LLM Structured Output)**: When `OPENAI_API_KEY` is provided, requests route to `gpt-4o-mini` with strict JSON schema definitions extracting:
   - Claim text
   - Category (`pricing`, `version`, `date`, `law`, `leadership`, `fact`)
   - Extracted value (e.g. `"$0.03 per 1K"`, `"18.2.0"`)
   - Staleness likelihood (`0.0` - `1.0`)
2. **Fallback (Deterministic Regex)**: If the LLM provider fails, returns HTTP 429 (quota exhausted), or is unconfigured, extraction falls back instantly to regex engines detecting semantic patterns:
   - `VERSION_RE`: Semantic versioning strings (`v?18.2.0`, `v5.1`)
   - `PRICE_RE`: Currency patterns (`$0.03 per token`, `$20/month`)
   - `DATE_RE`: Explicit temporal references (`2020` - `2039`)
   - `LAW_RE`: Regulations (`GDPR`, `CCPA`, `HIPAA`, `SOX`, `MiFID`)
   - `CEO_RE`: Executive titles (`CEO`, `CTO`, `Founder`, `President`)
   - `STALE_RE`: Epistemic markers (`currently`, `as of`, `latest`, `today`)

### 4.2 Volatility Triage Matrix
Not all claims decay equally. Extracted claims are triaged by decay volatility:

| Category | Volatility Weight | Soft Cache TTL | Description |
|---|---|---|---|
| `pricing` | `0.95` | 6 Hours | Token rates, SaaS subscription costs, GPU cloud pricing |
| `version` | `0.90` | 12 Hours | Framework versions, language runtimes, package releases |
| `leadership` | `0.85` | 24 Hours | C-suite personnel, board directors, political leaders |
| `date` | `0.70` | 24 Hours | Product releases, deprecation dates, conferences |
| `law` | `0.65` | 72 Hours | Compliance mandates, regulatory fines, statutory rules |
| `fact` | `0.40` | 48 Hours | General assertions carrying temporal indicators |

Claims with likelihood < 0.30 or duplicate claims in the same category are pruned before invoking Tavily search.

---

## 5. Live Verification & Mathematical Scoring

### 5.1 Tavily Search Integration
For triaged claims, search queries are constructed targeting official domains:
- Query optimization appends temporal anchors (e.g. `"React latest version current release 2026"`).
- Official domain boosting gives precedence to `docs.*`, `*.gov`, `*.edu`, and canonical documentation sites.
- Results return title, URL, snippet content, published date, and Tavily relevance scores.

### 5.2 Four-Factor Freshness Score Formula
Every claim receives a composite score from `0.00` (completely stale) to `1.00` (confirmed fresh):

$$\text{ClaimScore} = (E_{\text{agreement}} \times 0.40) + (S_{\text{authority}} \times 0.30) + (R_{\text{recency}} \times 0.20) + (C_{\text{count}} \times 0.10)$$

Where:
- **$E_{\text{agreement}}$ (0.40 weight)**: Proportion of retrieved snippets corroborating the extracted claim (`1.0` for current, `0.0` for stale, `0.5` for ambiguous/unverified).
- **$S_{\text{authority}}$ (0.30 weight)**: Domain trustworthiness blended with Tavily snippet relevance. Official domains receive a 0.85 base multiplier; general domains receive 0.45.
- **$R_{\text{recency}}$ (0.20 weight)**: Time-decay step function based on publication date:
  - $\le 7\text{ days}$: `1.00`
  - $\le 30\text{ days}$: `0.80`
  - $\le 90\text{ days}$: `0.60`
  - $> 90\text{ days}$ or undated: `0.40`
- **$C_{\text{count}}$ (0.10 weight)**: Source consensus scale: $\min(1.0, \frac{N_{\text{sources}}}{3})$.

### 5.3 Safety Bounds & Caps
- **Stale Claim Cap**: Any claim confirmed stale is capped at a maximum score of `0.35`.
- **Unverified Claim Cap**: Any claim that cannot be verified is capped at `0.50` (cannot pass as fresh).
- **Overall Score**: Weighted average of all claim scores multiplied by their category volatility weights.

### 5.4 Confidence vs Freshness Score
Freshness score measures **temporal validity** (is the statement true today?). Confidence measures **certainty of verdict** (how authoritative and unambiguous is the evidence?):
- A stale claim verified by 3 official sources within 24 hours has **low freshness** (`0.15`) but **high confidence** (`0.92`).
- An unverified claim with no search results has **neutral freshness** (`0.50`) and **low confidence** (`0.20`).

---

## 6. Two-Tier Caching & Persistence Safety

### 6.1 Architecture
1. **Bounded L1 In-Memory LRU Cache**: Node.js `Map` indexed by the 32-character SHA-256 hash of normalized request text. Capped at `MAX_MEM_CACHE_SIZE = 1000` entries (configurable). When hits occur, keys are promoted to the MRU position. When capacity is reached, expired entries are pruned and the least recently accessed keys are evicted.
2. **L2 MongoDB Persistence**: MongoDB `Response` collection indexed by `requestId` (unique hash lookup), `checkedAt: 1` with 72-hour TTL expiration, `checkedAt: -1` for pagination sorting, and compound `{ 'claims.verdict': 1, checkedAt: -1 }` for verdict filtering.
3. **Promotion**: On an L2 cache hit, data is automatically promoted to L1 in-memory storage.

### 6.2 Degraded Operation (MongoDB-Less Resiliency)
FreshnessGuard provides graceful degradation when MongoDB is unavailable:
- Startup wraps `mongoose.connect()` in non-blocking error handlers; the server listens immediately.
- The `safeSave()` helper checks `mongoose.connection.readyState === 1` before writing. If disconnected, it logs a warning without throwing.
- L1 in-memory caching continues to function normally.
- Read routes (`GET /api/responses`, `GET /api/stats`) return empty lists or zero counters rather than hanging or triggering timeouts.
- When MongoDB recovers, connection is restored automatically without server restarts.

---

## 7. Real-Time Telemetry & SSE

The Express service maintains an active Server-Sent Events (SSE) registry at `GET /api/events`:
- **Heartbeat**: Emits `: heartbeat\n\n` every 30 seconds using an unreferenced timer (`hb.unref()`) to maintain HTTP keep-alive across proxies and cloud load balancers without blocking process shutdown.
- **Connection Cleanup**: Listeners attached to `req.close`, `res.finish`, and `res.error` immediately purge disconnected sockets from memory.
- **Events**:
  - `connected`: Broadcast on initial client handshake.
  - `new_response`: Broadcast when an inline or basic verification completes.
  - `response_updated`: Broadcast when an async background worker finishes.
  - `cache_hit`: Broadcast on L1/L2 cache hits.
  - `reverify`: Broadcast when a stored response is re-evaluated.

---

## 8. Security & Operational Boundaries

1. **Defensive HTTP Headers**: Express sets `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `X-XSS-Protection: 0`, `Referrer-Policy: strict-origin-when-cross-origin`, and explicitly disables `X-Powered-By`.
2. **CORS Origin Validation**: Verifies browser requests against `CORS_ORIGINS`, rejecting unauthorized web origins with HTTP 403.
3. **Authentication Boundary (`apiKeyAuth`)**: Mutating endpoints (`POST /api/check`, `POST /api/verify/:id`) support optional Bearer or `X-FreshnessGuard-Key` authorization via `FRESHNESSGUARD_API_KEY`.
4. **TokenBucket Rate Limiter**:
   - Single-instance Node.js process token bucket enforces a 10 requests/min cap on outbound Tavily calls.
   - For horizontally scaled multi-replica deployments (Kubernetes, ECS), this token bucket is designed to evolve into a shared Redis-backed atomic Lua rate limiter.

