# FreshnessGuard API Reference

## Base URL

All API endpoints are served from the FreshnessGuard server. By default this is:

```
http://localhost:3001
```

Adjust the host/port according to your deployment (`PORT` env var).

---

## Authentication

By default, authentication is disabled to allow zero-friction local exploration, test suite execution, and demo workflows.

When deploying to production, configure `FRESHNESSGUARD_API_KEY` in `server/.env`. The server then enforces an authentication boundary on all mutating endpoints (`POST /api/check` and `POST /api/verify/:id`):

- **Supported Headers**:
  - `Authorization: Bearer <key>`
  - `X-FreshnessGuard-Key: <key>`
- **Behavior**: Missing or invalid keys return **HTTP 401 Unauthorized** with `{ "error": "Unauthorized: Invalid or missing API key" }`.
- **Bifrost Plugin Integration**: In `bifrost-config/config.json`, the Go plugin's `api_key` setting automatically injects the matching `Authorization: Bearer <key>` header on all plugin-to-service calls.

---

## Security Headers

All HTTP responses automatically include standard defensive headers:

| Header | Value | Purpose |
|---|---|---|
| `X-Content-Type-Options` | `nosniff` | Prevents MIME-type confusion attacks |
| `X-Frame-Options` | `DENY` | Disallows iframe framing to prevent clickjacking |
| `X-XSS-Protection` | `0` | Modern standard disabling legacy reflected XSS auditors |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Protects query parameters and credentials in referrers |
| `Permissions-Policy` | `geolocation=(), microphone=(), camera=()` | Disables access to sensitive browser device APIs |
| `X-Powered-By` | *(omitted)* | Server fingerprint header explicitly disabled |

---

## Rate Limiting

| Scope | Limit | Window | Header / Behavior |
|-------|-------|--------|-------------------|
| All `/api/*` routes | 100 requests | 60,000 ms (1 min) | `RateLimit-*` headers, HTTP 429 on breach |
| `POST /api/check` | 60 requests | 60,000 ms (1 min) | Dedicated verification tier limiter |
| Tavily Search (internal) | 10 requests/min | 60,000 ms (1 min) | Process-level token bucket to avoid API tier limits |

When a rate limit is exceeded, the server returns **HTTP 429 Too Many Requests**.

---

## Common Error Responses

### 400 Validation Error

Returned when request payloads fail Zod schema validation:

```json
{
  "error": "Validation error",
  "details": [ /* Zod error array */ ]
}
```

### 400 Invalid Identifier Format

Returned when path parameter `:id` is malformed (e.g. contains special characters outside `/^[a-zA-Z0-9_.-]{1,128}$/` or invalid URI encoding):

```json
{
  "error": "Invalid identifier format"
}
```

### 401 Unauthorized

Returned when `FRESHNESSGUARD_API_KEY` is configured and a mutating request lacks valid credentials:

```json
{
  "error": "Unauthorized: Invalid or missing API key"
}
```

### 403 CORS Forbidden

Returned when a browser request's `Origin` is not included in `CORS_ORIGINS`:

```json
{
  "error": "CORS forbidden: Origin not allowed"
}
```

### 404 Response Not Found

Returned when the requested response ID does not exist in MongoDB:

```json
{
  "error": "Response not found"
}
```

### 500 Internal Server Error

Returned upon unhandled server exceptions. In `NODE_ENV=production`, the error message is sanitized to prevent leaking internal stack traces:

```json
{
  "error": "Internal server error"
}
```

---

## Data Schemas

### ResponseDoc

| Field | Type | Description |
|-------|------|-------------|
| `_id` | `string` | MongoDB ObjectId |
| `requestId` | `string` | SHA-256 hash of the submitted text (first 32 chars) |
| `model` | `string` | LLM model identifier used |
| `provider` | `string?` | LLM provider name (optional) |
| `originalText` | `string` | The submitted text |
| `correctedAnswer` | `string?` | Rewritten text with stale claims fixed (inline/async only, present only when stale claims found) |
| `checkedAt` | `Date` | Timestamp of the check |
| `claims` | `ScoredClaim[]` | Array of extracted and verified claims |
| `overallScore` | `number` | Aggregate freshness score, 0.0–1.0 |
| `overallConfidence` | `number?` | Aggregate verification certainty, 0.0–1.0 |
| `summaryStatus` | `string?` | One of `no_claims`, `all_fresh`, `stale_detected`, `unverified`, `bypassed` |
| `summaryMessage` | `string?` | Human-readable summary |
| `staleCount` | `number` | Number of stale claims detected |
| `totalClaims` | `number` | Total number of claims extracted |
| `fromCache` | `boolean` | Whether the result was served from L1 cache |
| `cacheHitAt` | `Date?` | Timestamp of cache hit (if applicable) |
| `processingMs` | `number` | Total processing time in milliseconds |
| `mode` | `string` | One of `inline`, `async`, `basic`, `bypass` |
| `fromLLM` | `boolean` | Whether an LLM was used for extraction (vs. regex fallback) |

### ScoredClaim

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Unique claim identifier |
| `text` | `string` | Full text of the claim |
| `category` | `string` | One of `pricing`, `version`, `date`, `law`, `leadership`, `fact` |
| `extractedValue` | `string` | The specific value extracted from the claim |
| `likelihood` | `number` | Probability this claim is factually checkable, 0.0–1.0 |
| `verdict` | `string?` | One of `current`, `stale`, `unverified` |
| `liveValue` | `string?` | Current real-world value (from Tavily verification) |
| `sources` | `Source[]?` | Evidence sources |
| `score` | `number?` | **Freshness score** (not confidence), 0.0–1.0 |
| `confidence` | `number?` | **Verification certainty** (not freshness), 0.0–1.0 |
| `checkedAt` | `Date?` | When this claim was verified |
| `correctedText` | `string?` | Corrected version of the claim text |

> **Important:** `score` = freshness (how fresh the claim is); `confidence` = certainty of the verification. These are distinct fields.

### Source

| Field | Type | Description |
|-------|------|-------------|
| `url` | `string` | Source URL |
| `title` | `string` | Page title |
| `publishedDate` | `string?` | Publication date |
| `domain` | `string?` | Domain name |
| `isOfficial` | `boolean?` | Whether this is an official/authoritative source |
| `content` | `string?` | Relevant content snippet |
| `score` | `number?` | Tavily relevance score |

---

## Endpoints

---

### POST /api/check

Submit text for freshness checking. Extracts factual claims and verifies them against live sources.

#### Request Body

```json
{
  "text": "string (required, 1–60000 chars)",
  "requestId": "string (optional)",
  "model": "string (optional)",
  "mode": "inline | async | basic | bypass (optional)",
  "provider": "string (optional)"
}
```

| Field | Required | Constraints | Description |
|-------|----------|-------------|-------------|
| `text` | ✅ | trimmed, min 1, max 60 000 chars | The AI-generated text to check |
| `requestId` | ❌ | — | Client-supplied correlation ID |
| `model` | ❌ | — | Override the LLM model |
| `mode` | ❌ | `inline`\|`async`\|`basic`\|`bypass` | Processing mode (defaults to `FRESHNESSGUARD_MODE` env var) |
| `provider` | ❌ | — | Override the LLM provider |

#### Processing Modes

| Mode | Description |
|------|-------------|
| `inline` | Fully synchronous — waits for extraction + verification, returns corrected text if stale |
| `async` | Returns immediately with `202`; verification runs in the background, result pushed via SSE |
| `basic` | Runs extraction only (no Tavily verification) |
| `bypass` | Skips all processing, returns `200` immediately |

#### Bypass Headers

The following request headers trigger `bypass` mode regardless of the body `mode` field:

| Header | Accepted Values |
|--------|----------------|
| `x-freshnessguard-bypass` | `"true"` or `"1"` |
| `x-bf-eh-freshnessguard-bypass` | `"true"` or `"1"` |

#### Response Status Codes

| Code | Condition |
|------|-----------|
| `200` | Bypass mode — no processing performed |
| `201` | Inline/basic mode completed, or no claims found |
| `202` | Async mode — processing continues in background |
| `400` | Validation error (see error schema above) |
| `500` | Internal server error |

#### Response Body

Returns a **ResponseDoc** object (see schema above).

#### Examples

```bash
# Basic check (inline mode)
curl -X POST http://localhost:3001/api/check \
  -H "Content-Type: application/json" \
  -d '{"text": "GPT-4 was released in March 2023 and costs $0.03 per 1K tokens."}'

# Async mode
curl -X POST http://localhost:3001/api/check \
  -H "Content-Type: application/json" \
  -d '{"text": "Python 3.12 is the latest stable version.", "mode": "async"}'

# Bypass via header
curl -X POST http://localhost:3001/api/check \
  -H "Content-Type: application/json" \
  -H "x-freshnessguard-bypass: true" \
  -d '{"text": "Any text here."}'

# Basic mode (extraction only, no Tavily)
curl -X POST http://localhost:3001/api/check \
  -H "Content-Type: application/json" \
  -d '{"text": "Node.js 20 is the current LTS.", "mode": "basic"}'
```

---

### GET /api/responses

List stored response documents with filtering and pagination.

#### Query Parameters

| Parameter | Type | Default | Constraints | Description |
|-----------|------|---------|-------------|-------------|
| `page` | `number` | `1` | — | Page number (1-indexed) |
| `limit` | `number` | `20` | 1–100 | Results per page |
| `verdict` | `string` | — | `current`\|`stale`\|`unverified` | Filter by overall verdict |
| `model` | `string` | — | Regex pattern | Filter by model name (regex match) |

#### Response Body

```json
{
  "data": [ /* ResponseDoc[] */ ],
  "total": 150,
  "page": 1,
  "limit": 20,
  "pages": 8
}
```

> **Note:** Returns `{ "data": [], "total": 0, ... }` if MongoDB is disconnected (degraded mode).

#### Status Codes

| Code | Condition |
|------|-----------|
| `200` | Success (including degraded/empty result) |

#### Examples

```bash
# List first page (default)
curl "http://localhost:3001/api/responses"

# Filter stale responses, page 2
curl "http://localhost:3001/api/responses?verdict=stale&page=2&limit=10"

# Filter by model name
curl "http://localhost:3001/api/responses?model=gemini-3.1-flash-lite"
```

---

### GET /api/responses/:id

Retrieve a single stored response by either its **24-character hex MongoDB ObjectId** or its **requestId** (e.g. `demo-001` or SHA-256 textHash).

#### Path Parameters

| Parameter | Type | Constraints | Description |
|-----------|------|-------------|-------------|
| `id` | `string` | Regex `/^[a-zA-Z0-9_.-]{1,128}$/` | MongoDB `ObjectId` or application `requestId` |

#### Lookup Logic

1. If `id` matches a valid 24-character hex string, the service queries `findById(id)`.
2. If not found or if `id` is a `requestId` string, the service queries `findOne({ requestId: id })`.
3. If neither matches, returns **HTTP 404 Not Found**.
4. If `id` contains invalid characters or malformed percent-encoding, returns **HTTP 400 Bad Request**.

#### Response Body

Returns a full **ResponseDoc** object.

#### Status Codes

| Code | Condition |
|------|-----------|
| `200` | Record found and returned |
| `400` | Malformed identifier format (failed regex or URIError) |
| `404` | Not found, or MongoDB disconnected |

#### Examples

```bash
# Retrieve by 24-character hex MongoDB ObjectId
curl "http://localhost:3001/api/responses/6af71294b6d969bea0e0f220"

# Retrieve by requestId string
curl "http://localhost:3001/api/responses/demo-001"
```

---

### GET /api/stats

Returns aggregate statistics for all processed responses.

#### Response Body

```json
{
  "totalScanned": 1024,
  "totalClaims": 4891,
  "totalStale": 312,
  "totalCurrent": 3987,
  "totalUnverified": 592,
  "cacheHitRate": 0.34,
  "cacheHits": 348,
  "cacheMisses": 676,
  "avgProcessingMs": 1420,
  "p95ProcessingMs": 3800,
  "p99ProcessingMs": 6200,
  "claimsPerCategory": {
    "pricing": 540,
    "version": 1200,
    "date": 980,
    "law": 120,
    "leadership": 310,
    "fact": 1741
  },
  "hourlyHistory": [ /* last 24h hourly buckets */ ]
}
```

> **Note:** Returns zeros for all fields (except in-memory cache metrics) if MongoDB is disconnected.

#### Status Codes

| Code | Condition |
|------|-----------|
| `200` | Always (zeros returned in degraded mode) |

#### Example

```bash
curl "http://localhost:3001/api/stats"
```

---

### POST /api/verify/:id

Re-runs Tavily verification on all claims in a previously stored response. Useful when you want to refresh outdated verification results.

#### Path Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | `string` | MongoDB ObjectId of the response to re-verify |

#### Behavior

- Re-fetches live data from Tavily for every claim in the document
- Updates the stored document in MongoDB
- Broadcasts a `reverify` SSE event to all connected clients

#### Response Body

Returns the updated **ResponseDoc** object.

#### Status Codes

| Code | Condition |
|------|-----------|
| `200` | Re-verification complete, updated document returned |
| `404` | Response not found, or MongoDB disconnected |

#### Example

```bash
curl -X POST "http://localhost:3001/api/verify/64f1a2b3c4d5e6f7a8b9c0d1"
```

---

### GET /api/events

Server-Sent Events (SSE) stream for real-time updates.

#### Headers

```
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
```

#### Heartbeat

A comment heartbeat is sent every 30 seconds to keep the connection alive:

```
: heartbeat
```

#### Event Catalog

| Event Type | Trigger | Description |
|------------|---------|-------------|
| `connected` | On connect | Confirms SSE connection established |
| `new_response` | New check completed | A new ResponseDoc has been stored |
| `response_updated` | Async check finished | An async response's verification has completed |
| `cache_hit` | Cache hit on `/api/check` | A cached result was returned |
| `reverify` | `POST /api/verify/:id` called | A document was re-verified |

#### Example Event Payloads

```
event: connected
data: {"message":"Connected to FreshnessGuard SSE"}

event: new_response
data: {"_id":"64f1...","summaryStatus":"stale_detected","staleCount":2,"totalClaims":5}

event: response_updated
data: {"_id":"64f1...","summaryStatus":"all_fresh","staleCount":0,"totalClaims":3}

event: cache_hit
data: {"requestId":"abc123...","fromCache":true}

event: reverify
data: {"_id":"64f1...","summaryStatus":"stale_detected","staleCount":1}
```

#### Example (curl)

```bash
curl -N -H "Accept: text/event-stream" "http://localhost:3001/api/events"
```

#### Example (JavaScript)

```js
const es = new EventSource('http://localhost:3001/api/events');
es.addEventListener('new_response', (e) => {
  const data = JSON.parse(e.data);
  console.log('New response:', data);
});
```

---

### GET /healthz  ·  GET /api/healthz

Health check endpoint. Both paths return the same response.

#### Response Body

```json
{
  "status": "ok",
  "service": "freshnessguard",
  "version": "1.0.0",
  "mongodb": "connected",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "sseClients": 3
}
```

| Field | Values | Description |
|-------|--------|-------------|
| `status` | `"ok"` | Always `"ok"` (server is running) |
| `mongodb` | `"connected"` \| `"disconnected"` | Current MongoDB connection state |
| `sseClients` | `number` | Number of active SSE connections |

#### Status Codes

| Code | Condition |
|------|-----------|
| `200` | Always (server is alive) |

#### Example

```bash
curl "http://localhost:3001/healthz"
# or
curl "http://localhost:3001/api/healthz"
```
