# FreshnessGuard 🛡️ — Master Pitch Deck, Demo Script & Architecture Guide

> **Geek Room Global AI Hackathon (Dual Track Submission)**  
> **Primary Problem Statement:** #4 — Open-Source Bifrost Gateway  
> **Specialized Problem Statement:** #6 — Build a Stale-Answer Detector for AI Applications (Tavily)  
> **Live Production Deployments:**  
> - **Web App (Vercel):** [https://freshnessguard-ddn.vercel.app](https://freshnessguard-ddn.vercel.app)  
> - **Backend API (Render):** [https://freshnessguard.onrender.com](https://freshnessguard.onrender.com)  
>  
> *"Fact-checkers ask if a claim is true. We ask if it's still true."*

---

## 📑 Contents

1. [Part 1: 15-Slide Presentation Deck Content](#part-1-15-slide-presentation-deck-content)
2. [Part 2: Complete Word-for-Word 6-Minute Speaker Script](#part-2-complete-word-for-word-6-minute-speaker-script)
3. [Part 3: End-to-End System Architecture & Request Lifecycle](#part-3-end-to-end-system-architecture--request-lifecycle)
4. [Part 4: Empirical Benchmark Results & Verification Quality](#part-4-empirical-benchmark-results--verification-quality)

---

# Part 1: 15-Slide Presentation Deck Content

### Slide 1: Title & Project Identity
- **Project Name**: FreshnessGuard 🛡️
- **Tagline**: Real-Time Temporal Freshness Intelligence & Stale-Answer Detection for LLM Gateways
- **One-Liner**: The missing gateway extension layer that intercepts LLM completions, verifies time-sensitive factual claims against live web intelligence, and prevents outdated facts from poisoning production AI applications.
- **Track Registration**: Primary Problem Statement #4 (Bifrost Gateway) + Specialized Problem Statement #6 (Tavily Stale-Answer Detector).
- **Core Technology Pillars**: Bifrost Go Plugin · Tavily AI Search SDK · Google Gemini API · MongoDB Atlas · React 18 / Vite.
- **Presenter**: Deepanghsh & Team

---

### Slide 2: Problem Statement (The Silent Failure of LLMs)
- **The Core Dilemma**: Large Language Models are frozen at their training cutoff date. When queried about time-sensitive facts, they hallucinate or recite outdated information with 100% syntactic confidence.
- **Why RAG Alone Is Insufficient**: Traditional RAG and semantic search retrieve documents based on topical similarity, not temporal validity. If the vector index contains a 2022 blog post, the LLM confidently repeats obsolete facts.
- **The Ground-Truth Gap**: Traditional fact-checkers verify whether a statement was *historically factual*. No existing gateway verifies whether that statement is **still true today**.

---

### Slide 3: Why Stale AI Information Matters (Real-World Impact)
- **High-Risk Volatility Domains**:
  1. **Commercial & API Pricing**: Stale token or SaaS rates ($0.03/1K vs $2.50/1M) lead to distorted financial modeling, cost overruns, and erroneous customer-facing quotes.
  2. **Software & SDK Versions**: Recommending deprecated or end-of-life runtimes (Python 2.7, Node 14 LTS, Next.js 12 Pages Router) introduces critical security vulnerabilities.
  3. **Executive & Corporate Leadership**: Misidentifying CEOs, CFOs, or founders (Bob Chapek at Disney, Parag Agrawal at Twitter) impairs market research, automated journalism, and compliance.
  4. **Legal & Regulatory Compliance**: Citing invalidated frameworks (EU-US Privacy Shield struck down under Schrems II) creates direct GDPR liabilities and multi-million dollar regulatory exposure.
  5. **Dates & Event Milestones**: Past events stated in future tense or rescheduled global events disrupt automated workflows and enterprise scheduling.

---

### Slide 4: The FreshnessGuard Solution
- **Architectural Placement**: Positioned directly inside the API gateway as a native `PostLLMHook`, operating before the response reaches the client application.
- **Core Workflow**:
  1. **Intercept**: Captures raw LLM output transparently.
  2. **Extract & Triage**: Parses unstructured natural language into atomic, time-sensitive claims and categorizes them by volatility.
  3. **Multi-Tier Cache**: Resolves known claims in sub-10ms via L1 in-memory and L2 MongoDB Atlas caching.
  4. **Live Web Re-Verification**: Queries Tavily with domain authority boosting and publication date recency analysis.
  5. **Score & Enrich**: Attaches mathematical Freshness Scores, Verification Confidence, source links, and non-destructive advisory notes.

---

### Slide 5: Product Demonstration Workflow
- **Dual-Input Playground**:
  - **Tab A (Ask AI Question)**: Prompts Google Gemini through Bifrost or direct inference, immediately streaming the response into the 4-stage pipeline.
  - **Tab B (Paste AI Response)**: Allows evaluators to paste arbitrary LLM output or select from 6 one-click industry presets (GPT-4 Pricing, React Versions, Disney Leadership, Privacy Shield, Netflix Plans, Angular).
- **Coherent Verification Experience**:
  - **Interactive Pipeline Tracker**: Visualizes `Intercepted ➔ Claims Extracted ➔ Live Evidence Retrieved ➔ Freshness Scored`.
  - **Inline Visual Diff**: Toggle between Original and Corrected view with color-coded token replacements.
  - **Deep-Dive Inspector**: Click any highlighted claim to view domain authority, publication date, verbatim web snippets, and direct source links.
  - **Live Benchmark Matrix**: Full 35-case ground-truth evaluation table with search, category filtering, and 1-click JSON/CSV export.

---

### Slide 6: System Architecture & Data Flow
- **Data Flow Topology**:
  ```
  User / App ───> Bifrost Gateway (Port 8080)
                         │
                   [PreLLMHook] (Recursion & Bypass Guard)
                         │
                   [LLM Provider] (Google Gemini)
                         │
                   [PostLLMHook] (plugins/freshnessguard)
                         │
                 HTTP POST /api/check (<=2000ms deadline)
                         ▼
        ┌─────────────────────────────────────────────────┐
        │        FreshnessGuard Core Engine               │
        │  1. L1 Memory Cache Hit? (< 10ms return)        │
        │  2. Gemini 3.1 Flash Lite Claim Extraction      │
        │  3. Domain Volatility Triage Engine             │
        │  4. Tavily AI Search (Live Web Intelligence)    │
        │  5. Multi-Factor Mathematical Scoring Formula   │
        │  6. MongoDB Atlas Persistence & L2 TTL Cache    │
        └─────────────────────────────────────────────────┘
                         │
                         ▼
             Enhanced Response Delivery
        - Injected Headers: X-FreshnessGuard-Score / -Stale
        - Non-Destructive Advisory Footnote
        - Real-Time SSE Telemetry ───> React Dashboard (Vercel)
  ```
- **The Fail-Open Invariant**: Strict timeout budget. If downstream services exceed 2000ms, the gateway returns the original LLM completion intact. Gateway availability is unconditionally guaranteed.

---

### Slide 7: Bifrost Gateway Contribution (Primary Problem Statement #4)
- **Native Go Extension**: Implemented in Go (`plugins/freshnessguard/main.go`) conforming to Bifrost's `schemas.LLMPlugin` interface.
- **Request Lifecycle Hooks**:
  - `PreLLMHook`: Inspects headers, identifies internal verification queries, and injects `x-freshnessguard-bypass: true` to prevent recursive LLM loops.
  - `PostLLMHook`: Evaluates LLM completion content, coordinates with the verification engine, and injects standard metadata headers into the HTTP response.
- **HTTP Gateway Traceability Headers**:
  - `X-FreshnessGuard-Score`: Continuous freshness score (`0.00` to `1.00`).
  - `X-FreshnessGuard-Stale`: Boolean flag (`true` if stale claims were detected).
  - `X-FreshnessGuard-Latency-Ms`: Exact verification turnaround time.
  - `X-FreshnessGuard-Mode`: Operational mode (`inline`, `async`, `basic`, `bypass`).
  - `X-FreshnessGuard-Request-Id`: Cryptographic content hash for trace auditing.
- **Zero-Dependency Basic Mode**: Includes compiled standalone regex heuristics in Go capable of running locally without any external microservices.

---

### Slide 8: Tavily AI Search Contribution (Specialized Problem Statement #6)
- **Targeted Temporal Information Retrieval**: Uses `@tavily/core` to supply live web ground truth for every factual claim.
- **Entity-Attribute Query Synthesis**:
  - Strips historical numbers/rates from search queries to avoid search-engine confirmation bias (e.g., searches `"Netflix Standard plan US price"` rather than bias-inducing `"$9.99"`).
- **Authoritative Domain Recognition**:
  - Automatically identifies and boosts official documentation hubs (`docs.*`, `developer.*`), `.gov`, and `.edu` domains ($S_{\text{authority}} = 0.85$ vs $0.45$).
- **Multi-Source Evidence Synthesis**:
  - Aggregates up to 5 concurrent search snippets per claim, evaluating source agreement and cross-referencing citations.
- **4-Tier Verdict System**:
  - `current`: Verified against recent corroborating authoritative evidence.
  - `stale`: Authoritative evidence indicates replacement, price hike, EOL, or superseded status.
  - `unverified`: Insufficient or conflicting search evidence found (fail-safe status).
  - `conflicting`: Disputed facts across divergent primary sources.

---

### Slide 9: Gemini & AI Workflow (Extraction & Generation)
- **Dual-Role Model Deployment**:
  1. **AI Response Generation**: Leverages Google Gemini (`gemini-3.1-flash-lite` / `gemini-1.5-flash`) routed via Bifrost to answer user questions in the Playground.
  2. **Structured Claim Extraction**: Leverages Google Gemini (`gemini-3.1-flash-lite`) with JSON schema enforcement (`responseMimeType: "application/json"`) to parse complex prose into discrete factual assertions.
- **Context-Preserving Extraction**:
  - Extracts the exact verbatim sentence, the discrete extracted value, the semantic category, and initial volatility.
- **Deterministic Regex Fallback**:
  - If Gemini times out or is unreachable, the engine immediately falls back to a deterministic regex parser using `getEnclosingSentence` with single-digit version matching, comprehensive leadership titles, and regulatory acronyms. Zero dropped requests.

---

### Slide 10: Verification Methodology & Mathematical Freshness Formula
- **Deterministic Multi-Factor Scoring**:
  $$\text{Freshness Score} = (S_{\text{agreement}} \times 0.40) + (S_{\text{authority}} \times 0.30) + (R_{\text{recency}} \times 0.20) + (C_{\text{count}} \times 0.10)$$
  - **Agreement Factor ($w_1 = 0.40$)**: Ratio of search evidence directly corroborating the claimed entity and value.
  - **Domain Authority ($w_2 = 0.30$)**: 0.85 for verified official documentation and gov/edu portals; 0.45 for secondary web sources.
  - **Publication Recency ($w_3 = 0.20$)**: Stepwise time-decay function ($< 7\text{d} = 1.0$, $< 30\text{d} = 0.75$, $< 90\text{d} = 0.50$, $\ge 90\text{d} = 0.15$).
  - **Source Count ($w_4 = 0.10$)**: Diminishing-returns scaling: $\min(1.0, \frac{N_{\text{sources}}}{3})$.
- **Confidence Separation**:
  - **Freshness Score (0.00–1.00)** measures *temporal validity*.
  - **Verification Confidence (0.00–1.00)** measures *evidence certainty*. A stale claim with 5 authoritative sources has a Low Freshness Score (0.18) and a High Confidence (0.95).

---

### Slide 11: Benchmark Results (Empirical Ground-Truth Evaluation)
- **Evaluation Methodology**: 35 hand-labeled ground-truth assertions spanning 5 high-volatility domains (`eval/eval_set.json`). Fully reproducible via `eval/run_eval.ts`.
- **Measured Empirical Results (v1.0.0 Production vs v0.1.0 Baseline)**:

| Metric | v0.1.0 Baseline | v1.0.0 Production | Net Gain | Evaluation Note |
|---|:---:|:---:|:---:|---|
| **Ground Truth Accuracy** | 60.0% (21/35) | **91.4% (32/35)** | **+31.4%** | Verified against live cluster |
| **Precision (Stale Claims)** | 58.3% | **100.0%** | **+41.7%** | **Zero False Positives** |
| **Recall (Stale Claims)** | 43.8% | **81.3%** | **+37.5%** | High interception of stale facts |
| **F1 Score** | 0.500 | **0.897** | **+0.397** | Robust operational balance |

- **Category Breakdown**:
  - Software Versions: **100.0% (10/10 PASS)**
  - Leadership & Executives: **100.0% (5/5 PASS)**
  - Laws & Regulations: **100.0% (5/5 PASS)**
  - Dates & Milestones: **100.0% (5/5 PASS)**
  - Pricing & Plans: **70.0% (7/10 PASS)**

---

### Slide 12: Performance, Reliability & Caching
- **Two-Tier Smart Caching Architecture**:
  - **L1 In-Memory Cache**: LRU cache for hot queries. **Empirically measured hit latency: 7.5 ms** (well below the <25ms target).
  - **L2 MongoDB Atlas Cache**: Category-specific TTL policies (Pricing: 6h, Versions: 12h, Leadership: 24h, Laws: 72h).
- **Throughput & Budget Enforcement**:
  - Verification budget hard-capped at 2000ms.
  - Concurrency-throttled Tavily calls (max 3 concurrent) with 429 exponential backoff retry.
- **Fail-Open Resilience**:
  - 100% gateway pass-through. If MongoDB Atlas or Tavily experiences an outage, FreshnessGuard fails open, logging the incident without dropping client traffic.

---

### Slide 13: Innovation & Technical Differentiation
- **What Sets FreshnessGuard Apart?**
  1. **Temporal Freshness vs. Traditional Fact-Checking**: Traditional verification asks *"Did this happen?"*; FreshnessGuard asks *"Is this still valid today?"*.
  2. **Gateway-Level Enforcement**: Unlike client-side guards or prompt engineering, FreshnessGuard operates centrally across all LLM models and client apps.
  3. **Non-Destructive Corrections**: Never modifies or censors the original completion; appends factual annotations with direct source links.
  4. **Multi-Tenant Enterprise Isolation**: Full user authentication (JWT + bcrypt), tenant-isolated response history, and role-based policies.
  5. **Deterministic Trust**: Freshness scores are computed with KaTeX-verifiable mathematical formulas, not unpredictable secondary LLM summaries.

---

### Slide 14: Scalability & Future Potential
- **Horizontal Scalability**: Stateless Node.js verification engine can be clustered behind standard load balancers.
- **Enterprise Extensibility**:
  - Custom internal domain allowlists for enterprise intranets (Confluence, Notion, SharePoint).
  - Webhook & Slack alert dispatching when stale facts in customer traffic exceed thresholds.
  - Automated fine-tuning feedback loops (exporting stale outputs as RLHF fine-tuning datasets).
- **Multi-Gateway Portability**: While designed natively for Bifrost, the REST API and verification engine can plug into Kong, Envoy, or LiteLLM.

---

### Slide 15: Conclusion & Hackathon Submission Summary
- **Primary Problem Statement #4 (Bifrost Gateway)**: Solved via native Go plugin, header injection, fail-open lifecycle hooks, and dual-mode execution.
- **Specialized Problem Statement #6 (Tavily Stale-Answer Detector)**: Solved via real-time web retrieval, authoritative domain boosting, recency analysis, and mathematical scoring.
- **Proven Empirical Readiness**:
  - **91.4% Accuracy** across 35 benchmark cases.
  - **100.0% Precision** on stale claim detection.
  - **7.5 ms Cache Hit Latency**.
  - **124/124 Passing Unit & Integration Tests**.
  - **100% Live Deployments Active** (Vercel + Render).

---

# Part 2: Complete Word-for-Word 6-Minute Speaker Script

> **Target Duration**: 06:00  
> **Speaker Role**: Senior Full-Stack Engineer / Product Lead  
> **Screen Setup**: Left: VS Code & Terminal | Right: FreshnessGuard React Dashboard (`https://freshnessguard-ddn.vercel.app`)

---

### [00:00 – 00:45] Chapter 1: The Problem & Pitch
- **Visual**: Slide 1 & 2.
- **Narrator**:
  > *"Every single day, millions of users query LLMs for critical decisions—pricing, API versions, legal regulations, and company leadership. And every single day, LLMs state outdated facts with 100% syntactic confidence.  
  > Fact-checkers ask if a claim was true. At FreshnessGuard, we ask: **is it still true today?**  
  > Introducing **FreshnessGuard**, an open-source, dual-track solution for the Bifrost Gateway and the Tavily Stale-Answer Detector challenge."*

---

### [00:45 – 01:45] Chapter 2: The Architecture & Fail-Open Guarantee
- **Visual**: Navigate to `/architecture` in the live React dashboard.
- **Narrator**:
  > *"FreshnessGuard operates at the network gateway level inside Bifrost as a native Go `PostLLMHook` plugin. When an LLM generates a response, FreshnessGuard intercepts it transparently before it reaches the client.  
  > Crucially, we enforce a strict **Fail-Open Invariant**: if our verification engine, Tavily, or downstream network times out past 2 seconds or fails, the gateway immediately passes the original answer untouched with zero downtime.  
  > Behind the plugin, our microservice extracts atomic claims, triages them by volatility category, checks per-category TTL caches, queries the Tavily search API with domain boosting, and computes an explainable multi-factor freshness score."*

---

### [01:45 – 03:00] Chapter 3: Live Playground Demo (Before & After)
- **Visual**: Navigate to `/playground`.
- **Action**:
  1. Click **Demo 1: GPT-4 Pricing**.
  2. Input shows: *"GPT-4 costs $0.03 per 1K input tokens and $0.06 per 1K output tokens."*
  3. Click **"🛡️ Run & Verify"**.
  4. Watch the 4-stage pipeline animation light up: `Intercept ➔ Extract ➔ Tavily Search ➔ Freshness Scored`.
- **Narrator**:
  > *"Notice how the pipeline detects the pricing claim, flags it as high-volatility, searches Tavily with official domain boosting, and determines the claim is stale.  
  > On the right, the answer is rendered with clear visual annotations: the stale price is crossed out, the live value is displayed, and verified source citations are provided.  
  > Now let's try Demo 2: React Version. Notice React 18.2 is flagged stale with reference to React 19 releases."*

---

### [03:00 – 04:15] Chapter 4: Live Gateway Feed & Response Inspector
- **Visual**: Navigate to `/overview` and click any response to open `/inspector/:id`.
- **Narrator**:
  > *"Here is the production Overview dashboard connected to the Bifrost gateway via real-time Server-Sent Events (SSE). Operators can view real-time throughput, overall freshness scores, and stale-vs-current ratios.  
  > Clicking into any transaction opens the full Response Inspector. Here we see:  
  > - Injected gateway headers: `X-FreshnessGuard-Score`, `X-FreshnessGuard-Stale`, `X-FreshnessGuard-Latency-Ms`.  
  > - Per-claim mathematical score breakdown based on evidence agreement, authority, and recency.  
  > - One-click re-verification button that busts the cache and re-queries live sources."*

---

### [04:15 – 05:00] Chapter 5: Code Walkthrough & Go Plugin
- **Visual**: Switch to VS Code. Show `plugins/freshnessguard/main.go` and `server/src/services/scoring.ts`.
- **Narrator**:
  > *"Let's take a quick look under the hood:  
  > In `plugins/freshnessguard/main.go`, we implement Bifrost's `LLMPlugin` interface. It includes both a zero-dependency local `basicMode` using regex extraction, and a high-accuracy `serviceMode` that connects to our verification server.  
  > Notice the fail-open fallback handlers and the HTTP header injection logic.  
  > In `server/src/services/scoring.ts`, our scoring formula weights evidence agreement at 40%, source authority at 30%, recency at 20%, and source count at 10%."*

---

### [05:00 – 05:30] Chapter 6: Evaluation Harness & Quality Metrics
- **Visual**: Show the live Benchmarks matrix in the dashboard (`/benchmarks`) or terminal benchmark runner.
- **Narrator**:
  > *"We don't just claim it works—we prove it. We built an automated 35-sample ground-truth evaluation dataset spanning pricing, versions, leadership, dates, and laws.  
  > Against our live cluster with real Tavily search and MongoDB Atlas, our evaluation harness achieved **91.4% overall accuracy** (32/35 correct), a perfect **100.0% precision** with zero false positive flags, and **81.3% recall** on stale answer interception, with L1 cache-hit response times of just 7.5 milliseconds."*

---

### [05:30 – 06:00] Chapter 7: Conclusion & Deployment
- **Visual**: Show live Vercel app at `https://freshnessguard-ddn.vercel.app` and Render backend.
- **Narrator**:
  > *"FreshnessGuard is completely open-source, fully deployed to production on Vercel and Render, and reproducible locally in a single command with `docker-compose up`.  
  > By bringing together the open-source Bifrost Gateway and Tavily's live web intelligence, FreshnessGuard ensures that AI answers don't just sound confident—they stay fresh and true.  
  > Thank you!"*

---

# Part 3: End-to-End System Architecture & Request Lifecycle

```mermaid
flowchart TD
    Client["Client / User Application"] -->|1. Prompt: 'What is the price of GPT-4?'| Bifrost["Bifrost Gateway (Port 8080)"]
    
    subgraph GatewayLifecycle ["Bifrost Request Lifecycle"]
        Bifrost -->|PreLLMHook| LoopGuard["Loop Guard (x-freshnessguard-bypass)"]
        LoopGuard --> LLM["LLM Provider (Google Gemini)"]
        LLM -->|Raw LLM Response| PostHook["PostLLMHook (Go Plugin)"]
    end
    
    PostHook -->|2. POST /api/check (<=2000ms budget)| Engine["FreshnessGuard Core Engine"]
    
    subgraph CoreEngine ["Verification Microservice (Node.js/Express)"]
        Engine --> CacheL1{"L1 LRU Memory Cache?"}
        CacheL1 -- Hit (<10ms) --> Scorer
        CacheL1 -- Miss --> ClaimExtractor["Gemini 3.1 Flash Lite Claim Extractor"]
        
        ClaimExtractor --> Triage["Volatility Triage (Pricing, Software, Leadership, Legal)"]
        Triage --> CacheL2{"L2 MongoDB Atlas TTL Cache?"}
        CacheL2 -- Hit (<25ms) --> Scorer
        
        CacheL2 -- Miss --> QuerySynth["De-biased Query Synthesizer"]
        QuerySynth --> Tavily["Tavily Search API (Live Web Ground Truth)"]
        Tavily --> EvidenceParser["Evidence & Domain Authority Analyzer"]
        EvidenceParser --> Scorer["Multi-Factor Scoring Engine"]
    end
    
    Scorer -->|Store with TTL| MongoSave[("MongoDB Atlas")]
    Scorer -->|3. Verdict, Score, Injected Headers| PostHook
    
    subgraph FailOpenBoundary ["Fail-Open Safety Boundary"]
        Timeout{"Timeout > 2000ms or Engine Error?"}
        PostHook -.-> Timeout
        Timeout -- Yes --> PassOriginal["Pass Original Response Untouched"]
    end
    
    PostHook -->|4. Return Enriched Response + Headers| Client
    Engine -.->|5. Real-Time Telemetry (SSE)| Dashboard["React Dashboard (Vercel)"]
```

---

# Part 4: Empirical Benchmark Results & Verification Quality

### Ground-Truth Evaluation Matrix (v1.0.0 Production vs Baseline)

| Metric | v0.1.0 Baseline | v1.0.0 Production | Net Gain | Evaluation Note |
|---|:---:|:---:|:---:|---|
| **Ground Truth Accuracy** | 60.0% (21/35) | **91.4% (32/35)** | **+31.4%** | Measured against live Tavily + MongoDB |
| **Precision (Stale Claims)** | 58.3% | **100.0%** | **+41.7%** | **Zero False Positives** |
| **Recall (Stale Claims)** | 43.8% | **81.3%** | **+37.5%** | High interception of superseded facts |
| **F1 Score** | 0.500 | **0.897** | **+0.397** | Industry-grade balance |
| **Cache Hit Latency** | 18.2 ms | **7.5 ms** | **-58.8%** | L1 In-Memory LRU hit |
