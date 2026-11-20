# FreshnessGuard 🛡️

> **Real-Time Temporal Freshness Intelligence & Stale-Answer Detection for the Bifrost LLM Gateway**  
> *"Fact-checkers ask if a claim is true. We ask if it's still true."*

[![Geek Room Global AI Hackathon](https://img.shields.io/badge/Hackathon-Geek%20Room%20Global%20AI-blueviolet?style=for-the-badge)](https://geekroom.in)
[![Dual Track](https://img.shields.io/badge/Tracks-Bifrost%20PS%2004%20%7C%20Tavily%20PS%2006-emerald?style=for-the-badge)](#2-problem-statement--hackathon-challenge-alignment)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](LICENSE)
[![Go 1.27](https://img.shields.io/badge/Plugin-Go%201.27-00ADD8?style=for-the-badge&logo=go)](plugins/freshnessguard)
[![Node.js 20](https://img.shields.io/badge/Backend-Node.js%2020-339933?style=for-the-badge&logo=nodedotjs)](server)
[![React 18](https://img.shields.io/badge/Frontend-React%2018%20%2B%20Vite-61DAFB?style=for-the-badge&logo=react)](client)
[![Tavily API](https://img.shields.io/badge/Search-Tavily%20API-FF6B6B?style=for-the-badge)](https://tavily.com)
[![Google Gemini](https://img.shields.io/badge/AI-Google%20Gemini%203.1-4285F4?style=for-the-badge&logo=google)](https://ai.google.dev)

---

## 📑 Table of Contents

1. [Project Name and Tagline](#1-project-name-and-tagline)
2. [Problem Statement & Hackathon Challenge Alignment](#2-problem-statement--hackathon-challenge-alignment)
3. [The Problem & Proposed Solution](#3-the-problem--proposed-solution)
4. [Key Features](#4-key-features)
5. [Architecture Diagram](#5-architecture-diagram)
6. [Bifrost Gateway Integration](#6-bifrost-gateway-integration)
7. [Tavily Live Search Integration](#7-tavily-live-search-integration)
8. [Google Gemini Integration](#8-google-gemini-integration)
9. [Technology Stack](#9-technology-stack)
10. [Installation Instructions](#10-installation-instructions)
11. [Environment Configuration (Safe Placeholders)](#11-environment-configuration-safe-placeholders)
12. [Local Development Instructions](#12-local-development-instructions)
13. [Testing Instructions](#13-testing-instructions)
14. [Benchmark Reproduction Instructions](#14-benchmark-reproduction-instructions)
15. [Deployment Instructions](#15-deployment-instructions)
16. [Visual Interface & Screenshots](#16-visual-interface--screenshots)
17. [Demo Video & Walkthrough Script](#17-demo-video--walkthrough-script)
18. [Known Technical Limitations](#18-known-technical-limitations)
19. [Responsible AI & Privacy Considerations](#19-responsible-ai--privacy-considerations)
20. [Credits & Third-Party Acknowledgements](#20-credits--third-party-acknowledgements)

---

## 1. Project Name and Tagline

**FreshnessGuard** 🛡️  
*Real-Time Temporal Freshness Intelligence & Stale-Answer Detection for the Bifrost LLM Gateway.*  
**Core Motto**: *"Fact-checkers ask if a claim is true. We ask if it's still true."*

---

## 2. Problem Statement & Hackathon Challenge Alignment

FreshnessGuard is a merged dual-track submission for the **Geek Room Global AI Hackathon**:

| Hackathon Track | Designation | Concrete Technical Contribution |
|---|:---:|---|
| **Primary Problem Statement #4** | **Open-Source Bifrost Gateway** | Implemented as a native Go `PostLLMHook` extension plugin conforming to Bifrost's `schemas.LLMPlugin` interface. Enforces strict **Fail-Open availability semantics** (never drops user requests), injects standard HTTP telemetry headers (`X-FreshnessGuard-Score`, `X-FreshnessGuard-Stale`, `X-FreshnessGuard-Latency-Ms`), provides recursion prevention via `PreLLMHook`, and includes an embedded zero-dependency local regex heuristic mode. |
| **Specialized Problem Statement #6** | **Build a Stale-Answer Detector for AI Applications** | Complete end-to-end temporal verification engine powered by the official `@tavily/core` SDK. Automatically parses natural-language text into atomic claims, triages them by domain volatility, queries Tavily using entity-attribute queries, boosts authoritative domains (`.gov`, `.edu`, documentation allowlists), applies publication recency time-decay functions, and computes mathematical multi-source Freshness Scores and Verification Confidence metrics. |

---

## 3. The Problem & Proposed Solution

### The Problem: Silent LLM Knowledge Staleness
Large Language Models are frozen at their training cutoff dates. When asked about time-sensitive facts, they hallucinate or cite expired knowledge with complete syntactic confidence:
- **Commercial API & Cloud Pricing**: Stating that GPT-4 costs `$0.03 per 1K tokens` (superseded by modern models with >10x lower rates) leads to distorted financial forecasting.
- **Software Runtimes & Frameworks**: Recommending Python 2.7, Node 14 LTS, or Next.js 12 Pages Router introduces security vulnerabilities and broken build pipelines.
- **Executive & Corporate Leadership**: Confidently claiming Bob Chapek is Disney CEO or Parag Agrawal is Twitter CEO damages market research and automated reporting.
- **Laws & International Regulations**: Citing the EU-US Privacy Shield (invalidated under Schrems II) exposes companies to severe GDPR regulatory fines.
- **Why RAG Fails Here**: Traditional RAG retrieves documents based on *semantic similarity*, not *temporal recency*. If a vector database contains a 2022 article, the LLM recites it as current fact.

### The FreshnessGuard Solution
FreshnessGuard intercepts LLM completions at the gateway before they reach end users. It extracts time-sensitive factual claims, checks an ultra-fast two-tier cache (L1 in-memory sub-10ms, L2 MongoDB Atlas TTL), verifies uncached claims against live web ground truth via Tavily, and returns a verified answer enriched with non-destructive footnotes, live source citations, and HTTP verification headers.

---

## 4. Key Features

- ⚡ **Native Bifrost Gateway Extension**: Native Go plugin implementing `schemas.LLMPlugin` with `PostLLMHook` interception and `PreLLMHook` recursion guard.
- 🛡️ **Guaranteed Fail-Open Invariant**: Strict 2000ms latency budget. If downstream verification times out or fails, the gateway immediately returns the original LLM answer untouched. Gateway availability is 100% preserved.
- 🧮 **Mathematical Multi-Factor Freshness Formula**: Calculates continuous Freshness Scores (`0.00` to `1.00`) based on evidence agreement ($40\%$), domain authority ($30\%$), publication recency ($20\%$), and independent source saturation ($10\%$).
- 🔍 **Confidence & Freshness Separation**: Distinct Freshness Score (temporal validity) and Verification Confidence (evidence certainty). A proven stale claim has a low freshness score ($0.18$) and high confidence ($0.95$).
- 🏷️ **4-Tier Claim Verdicts**: `current` (verified fresh), `stale` (superseded/deprecated/hiked), `unverified` (insufficient evidence), and `conflicting` (disputed across sources).
- 🗄️ **Two-Tier Smart Caching**: Sub-10ms in-memory L1 cache (`7.5ms` empirically measured) + MongoDB Atlas L2 cache with domain-specific TTL policies (Pricing: 6h, Versions: 12h, Leadership: 24h, Laws: 72h).
- 🔄 **Dual Execution Modes**: `inline` (synchronous verification for high-assurance pipelines) and `async` (immediate 202 return with real-time Server-Sent Events backfill).
- 🎨 **Modern Interactive UI**: Dual-input Playground (Ask AI via Gemini vs Paste AI Response), Inline Visual Diff switcher, deep-dive Inspector with live source cards, and a 35-case Benchmarks matrix with JSON/CSV export.
- 🔒 **Enterprise Multi-Tenant Security**: User authentication (bcrypt + JWT), role-based policies, and tenant-isolated response history.

---

## 5. Architecture Diagram

```mermaid
flowchart TD
    subgraph ClientLayer ["Client Applications & Dashboard"]
        ClientApp["Client Application / SDK"]
        Dashboard["FreshnessGuard UI (React 18 + Vite :5173)"]
    end

    subgraph GatewayLayer ["Bifrost LLM Gateway (:8080)"]
        PreHook["PreLLMHook\n(Recursion & Bypass Guard)"]
        LLMInference["Google Gemini\n(Sole LLM Provider)"]
        PostHook["PostLLMHook Plugin\n(plugins/freshnessguard.so)"]
    end

    subgraph ServiceLayer ["FreshnessGuard Core Engine (:5000)"]
        L1Cache["L1 Memory Cache\n(< 10ms Hit Return)"]
        GeminiExt["Gemini 3.1 Flash Lite\n(Structured JSON Claim Extraction)"]
        RegexFallback["Deterministic Regex Engine\n(Context-Preserving Fallback)"]
        Triage["Domain Volatility Triage\n(Pricing | Version | Leadership | Law | Date)"]
        TavilyEngine["Tavily Search API Engine\n(Domain Boosting & Recency Analysis)"]
        Scorer["Mathematical Scoring Formula\n(Agreement + Authority + Recency + Count)"]
    end

    subgraph StorageLayer ["Persistence & External Services"]
        Atlas["MongoDB Atlas\n(L2 TTL Cache & Response Store)"]
        TavilyAPI["Tavily Live Web Index"]
    end

    ClientApp -->|1. LLM Request| PreHook
    PreHook -->|2. Forward Prompt| LLMInference
    LLMInference -->|3. Raw Completion| PostHook
    PostHook -->|4. HTTP POST /api/check <=2000ms| L1Cache

    L1Cache -->|Cache Miss| GeminiExt
    GeminiExt -.->|Fallback on Timeout| RegexFallback
    GeminiExt -->|Extracted Claims| Triage
    RegexFallback -->|Extracted Claims| Triage
    Triage -->|Synthesized Queries| TavilyEngine
    TavilyEngine -->|Live Query| TavilyAPI
    TavilyAPI -->|Authoritative Snippets| TavilyEngine
    TavilyEngine -->|Evidence Matrix| Scorer
    Scorer -->|Enriched Result| Atlas

    L1Cache -->|Cache Hit < 10ms| PostHook
    Scorer -->|Verification Payload| PostHook
    PostHook -->|5. Injected Headers + Footnote Note| ClientApp

    Atlas -.->|SSE Live Telemetry /api/events| Dashboard
    Dashboard -->|Interactive Playground & Benchmarks| ServiceLayer
```

---

## 6. Bifrost Gateway Integration

FreshnessGuard is engineered natively for the [Open-Source Bifrost LLM Gateway](https://github.com/maximhq/bifrost):

### Extension Points & Go Plugin Implementation
- **Location**: `plugins/freshnessguard/main.go`
- **Interface**: Conforms to Bifrost's official Go plugin interface (`schemas.LLMPlugin`).
- **`PreLLMHook`**: Inspects inbound request headers. If internal verification is occurring, injects `x-freshnessguard-bypass: true` to prevent recursive LLM calls.
- **`PostLLMHook`**: Intercepts the generated `ChatResponse`. Extracts the assistant message text, invokes `POST /api/check` within a strict `TimeoutMs` deadline, and transparently annotates the response.

### HTTP Gateway Header Injection
Every response routed through the FreshnessGuard plugin receives standard metadata headers:
- `X-FreshnessGuard-Score`: Normalized freshness score (`0.00` to `1.00`).
- `X-FreshnessGuard-Stale`: Boolean flag (`true` if stale claims were detected).
- `X-FreshnessGuard-Latency-Ms`: Round-trip verification latency in milliseconds.
- `X-FreshnessGuard-Mode`: Operating mode (`inline`, `async`, `basic`, `bypass`).
- `X-FreshnessGuard-Request-Id`: Unique request hash for audit traceability.

### Non-Destructive Advisory Footnote
Rather than corrupting or discarding the original model generation, FreshnessGuard appends a non-destructive advisory note when stale claims are identified:
```markdown
---
**[FreshnessGuard Verified]** ⚠️ 1 of 1 claim flagged as stale (Score: 30%, Confidence: 92%).
• Stale Claim: `Netflix Standard plan in the US is $9.99 per month.`
• Current Reality: `$15.49`
• Authoritative Source: https://help.netflix.com/en/node/24926 (Verified 1 hour ago)
```

---

## 7. Tavily Live Search Integration

FreshnessGuard leverages the official `@tavily/core` SDK to ground temporal evaluations in authoritative real-time web facts:

### Entity-Attribute Query Synthesis
Traditional search queries like `"Netflix Standard plan in the US is $9.99 per month price"` cause search engines to retrieve 2015 historical articles confirming the `$9.99` rate. FreshnessGuard strips historical prices/numbers, searching for `"Netflix Standard plan US current official price subscription cost 2026"`. This directs Tavily directly to the current pricing landscape.

### Domain Authority Boosting
Domains are scored according to an institutional hierarchy:
- **Official Domains ($S_{\text{authority}} = 0.85$)**: Recognized documentation subdomains (`docs.*`, `developer.*`), official vendor portals (`help.netflix.com`, `openai.com/api/pricing`), `.gov`, and `.edu` sites.
- **Secondary Web Domains ($S_{\text{authority}} = 0.45$)**: Blogs, forums, and secondary aggregators.

### Recency Time-Decay Function
Each source's `publishedDate` is evaluated against a step function:
- $< 7\text{ days}$: `1.00`
- $< 30\text{ days}$: `0.75`
- $< 90\text{ days}$: `0.50`
- $\ge 90\text{ days}$: `0.15`
- Missing date: `0.20`

---

## 8. Google Gemini Integration

FreshnessGuard utilizes Google Gemini for dual operational responsibilities:

1. **AI Response Generation**: In the interactive Playground, questions are sent to Google Gemini (`gemini-3.1-flash-lite` / `gemini-1.5-flash`) through the Bifrost Gateway or direct API, streaming completions into the verification pipeline.
2. **Structured Claim Extraction**: Natural language contains complex mixed assertions. FreshnessGuard prompts Gemini 3.1 Flash Lite with JSON schema enforcement (`responseMimeType: "application/json"`) to isolate time-sensitive assertions into discrete objects:
   ```json
   {
     "claims": [
       {
         "text": "Netflix Standard plan in the US is $9.99 per month.",
         "category": "pricing",
         "extractedValue": "$9.99",
         "likelihood": 0.95
       }
     ]
   }
   ```
3. **Context-Preserving Regex Fallback**: If external LLM extraction times out, a deterministic regex parser using `getEnclosingSentence` extracts claims with full sentence context and zero external network calls.

---

## 9. Technology Stack

- **Gateway Layer**: Go 1.27, Bifrost v2.5.1 Go Plugin SDK (`schemas.LLMPlugin`).
- **Core Backend Engine**: Node.js 20, TypeScript 5.9, Express 4, Zod schema validation.
- **AI & Retrieval**: Google Gemini API (`@google/genai` / REST v1beta), Tavily Search SDK (`@tavily/core`).
- **Persistence & Caching**: MongoDB Atlas (Mongoose 8 with 72-hour TTL indices), In-Memory L1 LRU Cache.
- **Frontend Dashboard**: React 18, Vite 5.4, Tailwind CSS, Lucide React, Recharts, EventSource (SSE).
- **Containerization**: Docker 24+, Docker Compose v2, multi-stage Alpine builders.

---

## 10. Installation Instructions

### Prerequisites
- Node.js 20+ (LTS) & npm 9+
- Docker Engine 24+ and Docker Compose v2 (optional for containerized run)
- Tavily Search API key ([Free signup at tavily.com](https://tavily.com))
- Google Gemini API key ([Free signup at ai.google.dev](https://ai.google.dev))

### Step 1: Clone the Repository
```bash
git clone https://github.com/deepanghsh/FreshnessGuard.git
cd FreshnessGuard
```

### Step 2: Install Server Dependencies
```bash
cd server
npm install
npm run build
cd ..
```

### Step 3: Install Client Dependencies
```bash
cd client
npm install
npm run build
cd ..
```

---

## 11. Environment Configuration (Safe Placeholders)

Create `.env` in the root directory and in `server/.env` using the provided template:

```bash
cp .env.example .env
cp server/.env.example server/.env
```

Populate the variables with your own credentials (never commit secrets to version control):

```env
# ─── FreshnessGuard Core Environment ─────────────────────────────────────────
PORT=5000
NODE_ENV=development
FRESHNESSGUARD_MODE=inline

# ─── API Providers ───────────────────────────────────────────────────────────
TAVILY_API_KEY=tvly-your_tavily_api_key_here
GEMINI_API_KEY=your_google_gemini_api_key_here

# ─── Database & Caching ──────────────────────────────────────────────────────
MONGODB_URI=mongodb+srv://username:password@cluster0.example.mongodb.net/freshnessguard?retryWrites=true&w=majority

# ─── Bifrost Gateway ─────────────────────────────────────────────────────────
BIFROST_URL=http://localhost:8080

# ─── Security & Authentication ───────────────────────────────────────────────
JWT_SECRET=generate_a_random_32_character_secret_here
```

---

## 12. Local Development Instructions

Start both services concurrently in development mode:

### Terminal 1: Start Backend Engine (Port 5000)
```bash
cd server
npm run dev
```
*Console verifies:*
```
[FreshnessGuard] MongoDB connected & verified: mongodb+srv://...
[FreshnessGuard] Server listening on http://localhost:5000
```

### Terminal 2: Start Frontend Dashboard (Port 5173)
```bash
cd client
npm run dev
```
*Console verifies:*
```
VITE v5.4.21 ready in 406 ms
➜ Local: http://localhost:5173/
```

Access the application in your browser at **`http://localhost:5173`**.

---

## 13. Testing Instructions

### Run Backend Unit & Integration Tests (100% Passing)
The server test suite includes 9 Jest suites covering API schemas, JWT auth, L1 caching, MongoDB operations, E2E pipelines, extraction fallbacks, and mathematical scoring:
```bash
cd server
npm test
```
*Verified output:*
```
Test Suites: 9 passed, 9 total
Tests:       124 passed, 124 total
Snapshots:   0 total
Time:        56.315 s
```

### Run Client Frontend Tests
```bash
cd client
npx vitest run
```

### Run Bifrost Go Plugin Interface Tests
```bash
cd plugins/freshnessguard
go test -v ./...
```

---

## 14. Benchmark Reproduction Instructions

We evaluated FreshnessGuard against the unmodified 35 labeled test cases in `eval/eval_set.json` spanning 5 high-volatility domains.

### Execute Automated Evaluation Harness
With the backend running on `http://localhost:5000`, run:
```bash
SERVER_URL=http://localhost:5000 npx -y tsx eval/run_eval.ts
```

### Empirical Measured Results (v1.0.0 Production Release)

| Metric | v0.1.0 Baseline | v1.0.0 Production | Net Gain | Evaluation Note |
|---|:---:|:---:|:---:|---|
| **Ground Truth Accuracy** | 60.0% (21/35) | **91.4% (32/35)** | **+31.4%** | Measured against live cluster |
| **Precision (Stale Claims)** | 58.3% | **100.0%** | **+41.7%** | **Zero False Positives** |
| **Recall (Stale Claims)** | 43.8% | **81.3%** | **+37.5%** | High interception rate |
| **F1 Score** | 0.500 | **0.897** | **+0.397** | Balanced performance |
| **L1 Cache Latency** | < 25 ms | **7.5 ms** | Sub-10ms | Instant cache return |
| **Fail-Open Pass-Through** | 100% | **100%** | 0 Drops | Guaranteed availability |

### Domain Breakdown
- **Software Versions (`version`)**: **100.0% (10/10 PASS)** — Next.js 14/15, Python 2.7 EOL, Node LTS, Angular 2 rewrite, React 19.
- **Leadership & Executives (`leadership`)**: **100.0% (5/5 PASS)** — Disney (Chapek → Iger), Twitter (Agrawal → Yaccarino), Amazon (Bezos → Jassy), Microsoft (Nadella).
- **Laws & Regulations (`law`)**: **100.0% (5/5 PASS)** — Schrems II / Privacy Shield invalidation, Section 230, GDPR.
- **Dates & Milestones (`date`)**: **100.0% (5/5 PASS)** — Paris Olympics, Windows 10 EOL, JWST, past-as-future assertions.
- **Commercial Pricing (`pricing`)**: **70.0% (7/10 PASS)** — GPT-4o, Claude 3 Opus, Spotify, Copilot, Vercel, Amazon Prime, Netflix, Twitter API.

*Detailed execution results are saved to `eval/results.json` and mirrored in the dashboard at `/benchmarks`.*

---

## 15. Deployment Instructions

### Docker Compose Quickstart
To launch the complete containerized stack:
```bash
docker compose up --build -d
```

### Services Map
| Service | Internal Port | Host Port | Purpose |
|---|:---:|:---:|---|
| `freshnessguard-client` | 80 | **5173** | React Production Dashboard (Nginx) |
| `freshnessguard-server` | 5000 | **5000** | Core Node.js Verification API |
| `bifrost-gateway` | 8080 | **8080** | Bifrost Gateway with Go Plugin |
| `mongodb` | 27017 | Internal | Bridge Network Database |

### Health Check Endpoint
Query the service health check to confirm operational status:
```bash
curl http://localhost:5000/healthz
```
*Expected response:*
```json
{
  "status": "ok",
  "service": "freshnessguard",
  "version": "1.0.0",
  "mongodb": "connected",
  "storageMode": "mongodb_atlas",
  "tavily": "configured",
  "bifrost": "connected",
  "gemini": "configured"
}
```

---

## 16. Visual Interface & Screenshots

The FreshnessGuard platform includes an intuitive, accessible visual dashboard with responsive Dark and Light themes:

| View | Screenshot Preview | Description |
|---|:---:|---|
| **Overview Command Center** | ![Overview](docs/screenshots/overview-dark.png) | Real-time KPI counters, hourly latency charts, stale-vs-current distribution ring, and live Server-Sent Events transaction stream. |
| **Interactive Playground** | ![Playground](docs/screenshots/playground-dark.png) | Dual tabs ("Ask AI Question" vs "Paste AI Response"), 6 industry presets, 4-stage pipeline animation, and Inline Visual Diff token replacement. |
| **Deep-Dive Inspector** | ![Inspector](docs/screenshots/inspector-verified.png) | Sentence-by-sentence text annotation, domain authority ratings, publication dates, verbatim search snippets, and direct source links. |
| **System Architecture** | ![Architecture](docs/screenshots/architecture-dark.png) | Interactive component topology, latency budget breakdown, and mathematical formula inspector. |
| **Secure Authentication** | ![Login](docs/screenshots/login-dark.png) | Frosted glass interface with high-contrast typography, multi-tenant isolation, and zero-latency theme synchronization. |

---

## 17. Demo Video & Walkthrough Script

- **Demo Video Link**: [Watch the 6-Minute FreshnessGuard Walkthrough](https://youtu.be/freshnessguard-demo) *(or follow local script)*
- **Demo Script**: Follow the complete minute-by-minute presentation walkthrough documented in [demo-script.md](demo-script.md).

---

## 18. Known Technical Limitations

In the spirit of scientific transparency and open-source integrity, the following limitations are documented:
1. **Search API Rate Limits**: Under heavy un-cached load, third-party search APIs may return HTTP 429. FreshnessGuard implements exponential backoff retry and fails open gracefully.
2. **Cold-Path Latency**: Un-cached claims requiring live Tavily search exhibit ~1.5s–2.5s cold latency. For user-facing interfaces, the `async` mode returns immediately and streams results via SSE.
3. **Language Scope**: Current regex heuristics and domain allowlists are optimized for English-language claims.
4. **Subjective Assertions**: FreshnessGuard verifies discrete temporal facts (versions, prices, executives, dates, laws). It explicitly skips subjective commentary or philosophical opinions.

---

## 19. Responsible AI & Privacy Considerations

- **Non-Destructive Integrity**: FreshnessGuard never deletes or silently alters original LLM generations. It appends transparent footnotes and returns diff annotations.
- **Evidence Traceability**: Every claim verdict is backed by traceable, clickable web citations with domain authority metrics.
- **Zero PII Retention**: Gateway requests are evaluated in memory; sensitive tokens or credentials are never stored in cache indexes.
- **Fail-Open Safety**: In safety-critical enterprise systems, unavailability is catastrophic. FreshnessGuard’s fail-open design guarantees the gateway never crashes.

---

## 20. Credits & Third-Party Acknowledgements

- **Geek Room AI Global Hackathon**: For organizing this dual-track innovation challenge.
- **Bifrost Team (Maxim AI)**: For the open-source [Bifrost Gateway](https://github.com/maximhq/bifrost) architecture and Go plugin ecosystem.
- **Tavily AI**: For the high-speed, search-optimized [Tavily API](https://tavily.com) providing real-time factual ground truth.
- **Google DeepMind**: For the Google Gemini API (`gemini-3.1-flash-lite`) powering fast structured claim extraction.
- **MongoDB**: For MongoDB Atlas real-time persistence and automatic TTL index expiration.

---

## 📄 License
This project is open-source and licensed under the [MIT License](LICENSE).
