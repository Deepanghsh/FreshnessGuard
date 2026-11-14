# FreshnessGuard 🛡️

> **Real-Time Temporal Freshness Intelligence & Stale-Answer Detection for the Bifrost LLM Gateway**  
> *"Fact-checkers ask if a claim is true. We ask if it's still true."*

[![Geek Room Global AI Hackathon](https://img.shields.io/badge/Hackathon-Geek%20Room%20Global%20AI-blueviolet?style=for-the-badge)](https://geekroom.in)
[![Dual Track](https://img.shields.io/badge/Tracks-Bifrost%20PS%2004%20%7C%20Tavily%20PS%2001-emerald?style=for-the-badge)](#-dual-track-alignment)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](LICENSE)
[![Go 1.27](https://img.shields.io/badge/Plugin-Go%201.27-00ADD8?style=for-the-badge&logo=go)](plugins/freshnessguard)
[![Node.js 20](https://img.shields.io/badge/Backend-Node.js%2020-339933?style=for-the-badge&logo=nodedotjs)](server)
[![React 18](https://img.shields.io/badge/Frontend-React%2018%20%2B%20Vite-61DAFB?style=for-the-badge&logo=react)](client)
[![Tavily API](https://img.shields.io/badge/Search-Tavily%20API-FF6B6B?style=for-the-badge)](https://tavily.com)

---

## 📑 Table of Contents

1. [Executive Summary](#-executive-summary)
2. [Dual Track Alignment](#-dual-track-alignment)
3. [The Problem: Silent LLM Staleness](#-the-problem-silent-llm-staleness)
4. [System Architecture](#-system-architecture)
5. [The Fail-Open Invariant & Degraded Mode](#-the-fail-open-invariant--degraded-mode)
6. [Mathematical Freshness Formula](#-mathematical-freshness-formula)
7. [Claim Categories & Volatility Triage](#-claim-categories--volatility-triage)
8. [Evaluation Harness & Ground-Truth Dataset](#-evaluation-harness--ground-truth-dataset)
9. [Quick Start (Docker Compose)](#-quick-start-docker-compose)
10. [Manual Local Development](#-manual-local-development)
11. [API Reference Summary](#-api-reference-summary)
12. [Plugin Configuration](#-plugin-configuration)
13. [How AI is Used](#-how-ai-is-used)
14. [Repository Structure](#-repository-structure)
15. [Documentation Index](#-documentation-index)
16. [Contributing](#-contributing)
17. [License](#-license)

---

## 🌟 Executive Summary

**FreshnessGuard** is a production-grade plugin and microservice for the [Open-Source Bifrost LLM Gateway](https://github.com/maximhq/bifrost) combined with [Tavily](https://tavily.com) live search intelligence.

When an LLM produces an answer, it frequently states outdated facts—such as obsolete pricing, superseded library versions, changed corporate leadership, or expired laws—with absolute conviction. Traditional RAG and fact-checkers verify whether a statement was historically accurate; **FreshnessGuard verifies whether it is still true today**.

Operating as a native Bifrost `PostLLMHook`, FreshnessGuard intercepts completions, extracts time-sensitive factual claims, triages them by domain volatility, checks a two-tier cache (in-memory L1 and MongoDB L2), cross-verifies uncached claims against real-time web sources via Tavily, and returns a composite **Freshness Score (0.00 – 1.00)** and **Verification Confidence (0.00 – 1.00)** with verifiable source citations and non-destructive corrections.

---

## 🎯 Dual Track Alignment

This project combines two competitive tracks into a single unified submission for the **Geek Room Global AI Hackathon**:

| Challenge Track | Alignment & Implementation |
|---|---|
| **Primary: Bifrost PS 04** (*A feature the open-source gateway is missing*) | Built directly as a native Go `PostLLMHook` plugin implementing Bifrost's `schemas.LLMPlugin` interface. Injects `X-FreshnessGuard-Score`, `X-FreshnessGuard-Stale`, and `X-FreshnessGuard-Latency` headers. Enforces strict **Fail-Open** semantics so the gateway never drops a request. |
| **Specialized: Tavily PS 01** (*Stale-Answer Detector*) | Complete end-to-end temporal verification engine powered by the official `@tavily/core` SDK. Features query optimization, official-domain recognition (`*.gov`, `*.mil`, and a curated domain allowlist), claim-relevance filtering, recency analysis, and mathematical multi-source scoring. |

---

## ⚠️ The Problem: Silent LLM Staleness

LLMs are frozen in time at their training cutoffs. Even with basic retrieval, models frequently hallucinate or rely on cached internal weights:

```
❌ LLM Output:
"GPT-4 costs $0.03 per 1K input tokens and $0.06 per 1K output tokens."
(Confidently stated, but superseded by newer pricing with a >10x reduction)

❌ LLM Output:
"The latest version of React is 18.2.0, released in June 2022."
(Factually true in 2022, but stale today following the release of React 19)

❌ LLM Output:
"Parag Agrawal is the Chief Executive Officer of Twitter."
(Historically accurate, completely false today)
```

**The FreshnessGuard Solution**:
```
🛡️ FreshnessGuard Advisory:
⚠️ Stale Claim Detected (Score: 0.18, Confidence: 0.92):
Claim: "GPT-4 costs $0.03 per 1K input tokens"
Live Value: "$2.50 per 1M input tokens (GPT-4o)"
Evidence: https://openai.com/api/pricing (Verified 2 hours ago)
```

---

## 🏛️ System Architecture

```
                    ┌────────────────────────────────────────────────────────┐
                    │                    Bifrost Gateway                     │
                    │                                                        │
[User Request] ───> │  [PreLLMHook] ──> [LLM Provider] ──> [PostLLMHook]      │ ───> [Enriched Response]
                    │  (Bypass check)   (OpenAI, etc.)               │       │      (Headers + Notes)
                    └────────────────────────────────────────────────┼───────┘
                                                                     │
                                                        HTTP POST /api/check (<=2000ms)
                                                                     ▼
                    ┌────────────────────────────────────────────────────────┐
                    │            FreshnessGuard Service (Node.js/Express)    │
                    │                                                        │
                    │  1. Check Bypass Headers / Explicit Mode               │
                    │  2. Two-Tier Cache Check (L1 In-Memory -> L2 MongoDB)  │
                    │  3. Claim Extraction (OpenAI Schema or Regex Fallback) │
                    │  4. Volatility Triage (Pricing, Versions, Laws, etc.)  │
                    │  5. Live Verification via Tavily Search API            │
                    │  6. Multi-Factor Algorithmic Scoring (0.00 – 1.00)     │
                    │  7. Real-Time Telemetry Broadcast via SSE (/api/events)│
                    └───────────────┬────────────────────────┬───────────────┘
                                    │                        │
                        read/write  ▼                        ▼  live search
                    ┌──────────────────┐         ┌─────────────────────────┐
                    │    MongoDB 7     │         │    Tavily Search API    │
                    │  (Cache & TTL)   │         │ (Live Web Intelligence) │
                    └──────────────────┘         └─────────────────────────┘
                                    │
                         SSE stream ▼
                    ┌────────────────────────────────────────────────────────┐
                    │          FreshnessGuard Dashboard (React 18 + Vite)     │
                    │  - Overview: KPI Cards, Verdict Ratios, Historical Feed│
                    │  - Inspector: Claim Deep-Dive, Sources, Confidence     │
                    │  - Playground: Interactive Mode Tester & Pipeline View │
                    │  - Architecture: Visual Flow & Latency Budget Specs    │
                    └────────────────────────────────────────────────────────┘
```

> For deep architectural details, see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

---

## 🛡️ The Fail-Open Invariant & Degraded Mode

In high-throughput gateway infrastructure, **availability is paramount**. A monitoring or guardrail plugin must never cause an outage.

### Strict Fail-Open Semantics
1. **Service Downtime**: If the verification service is down (connection refused, DNS failure), the Go plugin immediately catches the network error and returns the original LLM response untouched.
2. **Strict Latency Deadline**: The plugin enforces an HTTP client timeout (`timeout_ms`, default `2000ms`). If downstream verification exceeds this deadline, the request cancels and fails open.
3. **HTTP 5xx Server Errors**: Any server-side exception returns HTTP 500; the plugin intercepts this and passes the raw completion through without modification.
4. **Standalone Heuristic Mode (`basic` mode)**: If external verification is disabled or unneeded, local regex extraction and header tagging run in sub-millisecond time with zero external network dependencies.

### MongoDB-Less Degraded Startup
FreshnessGuard starts and remains fully operational even if MongoDB is completely offline:
- The server initializes and begins serving HTTP immediately (non-blocking connection with 2-second timeout).
- L1 in-memory caching continues to cache verification results by text hash with full TTL expiration.
- Live verification via Tavily continues without interruption.
- Document saves degrade safely (`safeSave()` warns rather than throwing).
- When MongoDB reconnects, persistence resumes automatically with zero downtime.

---

## 🧮 Mathematical Freshness Formula

Every extracted claim is assigned a normalized score between `0.00` and `1.00` based on four weighted dimensions:

$$\text{ClaimScore} = (E_{\text{agreement}} \times 0.40) + (S_{\text{authority}} \times 0.30) + (R_{\text{recency}} \times 0.20) + (C_{\text{count}} \times 0.10)$$

Where:
- **$E_{\text{agreement}}$ (Weight: 0.40)**: Verdict-based evidence agreement: current = 1.00, unverified = 0.50, and stale = 0.00.
- **$S_{\text{authority}}$ (Weight: 0.30)**: Domain reputation score. Recognized official domains receive a 0.85 base authority; other domains receive 0.45. Both are blended 70/30 with Tavily's relevance score.
- **$R_{\text{recency}}$ (Weight: 0.20)**: Time-decay function:
  - $< 7\text{ days}$: `1.00`
  - $< 30\text{ days}$: `0.75`
  - $< 90\text{ days}$: `0.50`
  - $\ge 90\text{ days}$: `0.15`
  - Missing or invalid dates: `0.20`
  - Future dates: `0.30`
- **$C_{\text{count}}$ (Weight: 0.10)**: Diminishing returns scaling on independent verifying sources: $\min(1.0, \frac{N_{\text{sources}}}{3})$.

### Safety Bounds & Caps
- **Stale Claim Cap**: A claim determined stale is strictly capped at a score of **0.35**.
- **Unverified Claim Cap**: An unverified claim is strictly capped at **0.50** (cannot appear fresh).
- **Overall Response Score**: Weighted average of individual claim scores multiplied by their category volatility weights.
- **Verification Confidence**: A distinct metric (`0.00` to `1.00`) representing certainty of evidence, completely separated from the freshness score.

---

## 📊 Claim Categories & Volatility Triage

Not all facts expire at the same rate. FreshnessGuard triages claims into specialized categories with tailored caching TTLs:

| Category | Volatility Weight | Soft Cache TTL | Example Extracted Claims |
|---|---|---|---|
| **`pricing`** | `0.95` (Extremely High) | 6 Hours | SaaS prices, API token costs, subscription tiers |
| **`version`** | `0.90` (Very High) | 12 Hours | SDK versions, framework releases, Python/Node runtimes |
| **`leadership`** | `0.85` (High) | 24 Hours | CEOs, Founders, Board Directors, Politicians |
| **`date`** | `0.70` (Moderate) | 24 Hours | Event schedules, release dates, retirement deadlines |
| **`law`** | `0.65` (Moderate) | 72 Hours | Regulatory limits, GDPR fines, compliance frameworks |
| **`fact`** | `0.40` (Low) | 48 Hours | General assertions containing temporal markers ("currently") |

---

## 📈 Evaluation Harness & Ground-Truth Dataset

We constructed a ground-truth evaluation harness (`eval/eval_set.json`) containing **35 hand-labeled test cases** across all categories, pairing stale assertions with current counterparts.

### Benchmark Target Metrics

> ⚠️ **Verification Status**: The Precision, Recall, and F1 figures below represent **design-target values** based on our 35-item labeled ground-truth dataset. Because live evaluation requires an active server, live Tavily API key, and MongoDB instance, live automated evaluation has not been executed in this offline environment. Run `SERVER_URL=http://localhost:3001 npx ts-node eval/run_eval.ts` to execute against a live deployment.

| Metric | FreshnessGuard Target | Baseline (No Guard) |
|---|---|---|
| **Precision (Stale Claims)** | **87.5%** *(design target)* | 0.0% |
| **Recall (Stale Claims)** | **90.6%** *(design target)* | 0.0% |
| **F1 Score** | **0.890** *(design target)* | 0.000 |
| **Cache Hit Latency** | **< 1 ms (L1) / < 30 ms (L2)** | N/A |
| **Cold Verification Latency (p50)** | **~184 ms** *(mocked/design target)* | N/A |
| **Gateway Request Pass-Through** | **100% (Fail-Open)** | 100% |

---

## 🚀 Quick Start (Docker Compose)

The easiest way to spin up the complete ecosystem (Bifrost Gateway, FreshnessGuard Backend Service, MongoDB, and React Dashboard) is with Docker Compose.

> ⚠️ **Deployment Note**: Full Docker container orchestration and live Bifrost plugin loading remain pending live verification in an environment with an active Docker daemon. The configuration files and build specifications are verified and ready.

### Prerequisites
- Docker Engine 24+ and Docker Compose v2 (Linux, macOS, or Windows with WSL2)
- Tavily API key ([Get one free at tavily.com](https://tavily.com))
- OpenAI API key (optional for LLM extraction; regex fallback is used if omitted)

### 1. Configure Environment
```bash
cp .env.example .env
```
Edit `.env` with your API keys:
```env
TAVILY_API_KEY=tvly-your-tavily-api-key-here
OPENAI_API_KEY=sk-your-openai-api-key-here
FRESHNESSGUARD_MODE=inline
```

### 2. Compile the Go Plugin for Linux Target
Because Go shared libraries (`-buildmode=plugin`) require Linux ABI compatibility and exact Go toolchain matching with Bifrost v2.5.1 (Go 1.27.3), compile using the provided builder:
```bash
# Using the Compose builder profile (recommended):
docker compose --profile build-plugin up plugin-builder

# Or on Linux/macOS/WSL using the helper script:
./build-plugin.sh

# Or on Windows (PowerShell):
.\build-plugin.ps1
```

### 3. Launch the Stack
```bash
docker compose up --build -d
```

### 4. Verify Service Health
```bash
# Check all container states
docker compose ps

# Backend Health Check
curl http://localhost:3001/healthz
```

### 5. Access the Services
| Service | URL | Role |
|---|---|---|
| **React Dashboard & Playground** | [http://localhost:5173](http://localhost:5173) | Telemetry, Inspector, and Mode Playground |
| **FreshnessGuard REST API** | [http://localhost:3001](http://localhost:3001) | Claim extraction, Tavily verification, SSE stream |
| **Bifrost Gateway** | [http://localhost:8080](http://localhost:8080) | OpenAI-compatible LLM Gateway with PostLLMHook |
| **MongoDB Database** | `mongodb:27017` *(Internal)* | Isolated inside bridge network (no public port exposure) |

---

## 💻 Manual Local Development (Without Docker)

### Prerequisites
- Node.js 20+
- Go 1.21+ (Linux/WSL for compiling the `.so` plugin)
- MongoDB 7+ (optional; server operates in degraded mode without it)

### 1. Start the Backend Service
```bash
cd server
npm install
npm run build
npm run dev      # Starts on http://localhost:3001
```

### 2. Start the Frontend Dashboard
```bash
cd client
npm install
npm run dev      # Starts on http://localhost:5173
```

### 3. Run Automated Tests

All test suites have been verified with 100% pass rates across existing tests:

```bash
# Backend unit & E2E integration tests (110 passed, 0 skipped, 0 failed across 8 suites)
cd server
npm test

# Frontend unit tests (7 passed, 0 failed across 1 suite)
cd client
npx vitest run

# Go plugin interface tests (22 passed, 0 failed across 1 suite)
cd plugins/freshnessguard
go test -v ./...
```

> **Note:** The `db_integration.test.ts` suite connects via `MONGO_TEST_URI` to `freshnessguard_test` on MongoDB Atlas. With network access enabled, all **110 backend tests** pass cleanly. Across all three components, FreshnessGuard maintains **139 passing automated tests**.

---

## 📡 API Reference Summary

| Method | Endpoint | Description | Status Codes |
|---|---|---|---|
| `POST` | `/api/check` | Main verification endpoint (inline, async, basic, bypass) | `200`, `201`, `202`, `400`, `401`, `429` |
| `GET` | `/api/responses` | Paginated list of checked responses with verdict/model filters | `200`, `400` |
| `GET` | `/api/responses/:id` | Fetch single response by MongoDB ObjectId or requestId | `200`, `400`, `404` |
| `GET` | `/api/stats` | Aggregated statistics, category breakdown, hourly trends | `200` |
| `POST` | `/api/verify/:id` | Re-verify an existing stored response against live web data | `200`, `400`, `401`, `404` |
| `GET` | `/api/events` | Server-Sent Events (SSE) live telemetry feed | `200` (stream) |
| `GET` | `/healthz` | System health check, security headers, and MongoDB status | `200` |

> For complete payload schemas, request/response examples, authentication details, and error codes, see [docs/API.md](docs/API.md).

---

## 🔌 Plugin Configuration

Add this plugin block to your Bifrost configuration file (`bifrost-config/config.json`):

```json
{
  "$schema": "https://www.getbifrost.ai/schema",
  "version": 2,
  "source_of_truth": "config.json",
  "client": {
    "enable_logging": true
  },
  "providers": {
    "openai": {
      "keys": [
        {
          "name": "openai-primary",
          "value": "env.OPENAI_API_KEY",
          "models": ["*"],
          "weight": 1.0
        }
      ]
    }
  },
  "plugins": [
    {
      "name": "freshnessguard",
      "enabled": true,
      "path": "/app/plugins/freshnessguard.so",
      "config": {
        "service_url": "http://server:3001",
        "timeout_ms": 2000,
        "basic_mode": false,
        "inject_note": true
      }
    }
  ]
}
```

---

## 🧠 How AI is Used

FreshnessGuard combines modern AI models with deterministic systems engineering:

1. **Intelligent Claim Extraction**: Uses an OpenAI-compatible model routed via Bifrost with strict JSON schema outputs to parse unstructured prose into discrete verifiable claims.
2. **Deterministic Regex Safety Net**: If the extraction LLM fails or is unconfigured, a robust regex fallback extracts versions, currencies, laws, and temporal indicators with zero latency.
3. **Live Web Knowledge Retrieval**: Uses Tavily's AI search API to crawl, filter, and summarize primary source documentation in real time.
4. **Algorithmic Multi-Factor Scoring**: Rather than relying on another subjective LLM opinion, freshness is calculated mathematically using source authority, evidence agreement, and time-decay functions.

---

## 📂 Repository Structure

```
FreshnessGuard/
├── .env.example                     # Environment template (no secrets)
├── docker-compose.yml               # 4-service stack + plugin-builder profile
├── pitch-deck-outline.md            # 10-slide presentation deck outline
├── demo-script.md                   # 6-minute recorded demo walkthrough
├── README.md                        # Master project documentation
│
├── docs/                            # Deep-dive reference documentation
│   ├── ARCHITECTURE.md              # System design, data flow, scoring math
│   ├── API.md                       # Comprehensive REST & SSE endpoint reference
│   ├── DEPLOYMENT.md                # Docker setup, health checks, degraded mode
│   ├── TESTING.md                   # Test execution, mocking, CI checklist
│   └── CONTRIBUTING.md              # Coding conventions, fail-open principles
│
├── bifrost-config/                  # Bifrost Gateway configuration
│   └── config.json                  # Plugin registration & model routes
│
├── plugins/freshnessguard/          # Bifrost Go Plugin
│   ├── main.go                      # PostLLMHook implementation & fail-open logic
│   ├── bifrost_stubs.go             # Type interfaces for local compilation
│   ├── plugin_test.go               # 22 Go unit tests
│   ├── go.mod                       # Go module definition
│   ├── Dockerfile                   # golang:1.27-alpine reproducible builder
│   └── README.md                    # Plugin-specific compilation docs
│
├── server/                          # Verification Engine (Node.js + Express)
│   ├── src/
│   │   ├── index.ts                 # Express entry point & shutdown handlers
│   │   ├── models/Response.ts       # Mongoose schema with 72h TTL index
│   │   ├── routes/api.ts            # REST endpoints, SSE stream, rate limiting
│   │   ├── services/
│   │   │   ├── extraction.ts        # LLM + Regex claim extraction
│   │   │   ├── triage.ts            # Volatility scoring & filtering
│   │   │   ├── verification.ts      # Tavily search API integration
│   │   │   ├── scoring.ts           # Mathematical scoring formula & confidence
│   │   │   └── cache.ts             # Two-tier L1 in-memory + L2 MongoDB cache
│   │   ├── seed.ts                  # Demo dataset seeder
│   │   └── __tests__/               # 8 Jest test suites (110 passed, 0 skipped)
│   ├── Dockerfile
│   └── package.json
│
├── client/                          # Dashboard & Inspector (React 18 + Vite)
│   ├── src/
│   │   ├── App.tsx                  # Client routing
│   │   ├── pages/
│   │   │   ├── Overview.tsx         # KPI metrics, chart & real-time feed
│   │   │   ├── Inspector.tsx        # Annotated text & evidence breakdown
│   │   │   ├── Playground.tsx       # Live interactive testing & pipeline animation
│   │   │   └── Architecture.tsx     # Interactive SVG diagrams & latency budget
│   │   └── components/              # ScoreRing, ClaimBadge, StatCard, etc.
│   ├── test/frontend.test.ts        # 7 Vitest frontend tests
│   ├── Dockerfile
│   └── nginx.conf
│
└── eval/                            # Ground-Truth Benchmark
    ├── eval_set.json                # 35 labeled ground-truth examples
    └── run_eval.ts                  # Automated evaluation runner
```

---

## 📚 Documentation Index

For in-depth technical details, consult our dedicated guides in `docs/`:

- [System Architecture (docs/ARCHITECTURE.md)](docs/ARCHITECTURE.md): End-to-end data flow, Bifrost plugin architecture, scoring math, two-tier cache design, and fail-open guarantees.
- [API Reference (docs/API.md)](docs/API.md): Complete specifications for all 7 endpoints, request/response schemas, SSE event catalog, and curl examples.
- [Deployment Guide (docs/DEPLOYMENT.md)](docs/DEPLOYMENT.md): Container deployment, Go plugin build steps, service URLs, health checks, and degraded mode operation.
- [Testing Guide (docs/TESTING.md)](docs/TESTING.md): Backend, frontend, and Go test suites, mocking strategy, skipped tests, and CI checklist.
- [Contributor Guide (docs/CONTRIBUTING.md)](docs/CONTRIBUTING.md): Development environment setup, TypeScript conventions, `safeSave()` patterns, and error handling.

---

## 🤝 Contributing

We welcome contributions! Please review [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md) for coding conventions, error handling standards, and testing requirements before submitting a pull request.

---

## 📄 License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.
