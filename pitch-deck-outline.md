# FreshnessGuard — Pitch Deck Outline

> **Geek Room Global AI Hackathon (Dual Track Submission)**  
> **Primary Problem Statement:** #4 — Open-Source Bifrost Gateway  
> **Specialized Problem Statement:** #6 — Build a Stale-Answer Detector for AI Applications (Tavily)  
> *"Fact-checkers ask if a claim is true. We ask if it's still true."*

---

### Slide 1: Title & Project Identity
- **Project Name**: FreshnessGuard 🛡️
- **Tagline**: Real-Time Temporal Freshness Intelligence & Stale-Answer Detection for LLM Gateways
- **One-Liner**: The missing gateway extension layer that intercepts LLM completions, verifies time-sensitive factual claims against live web intelligence, and prevents outdated facts from poisoning production AI applications.
- **Track Registration**: Primary Problem Statement #4 (Bifrost Gateway) + Specialized Problem Statement #6 (Tavily Stale-Answer Detector).
- **Presenter / Team**: Deepanghsh & Team
- **Core Technology Pillars**: Bifrost Go Plugin · Tavily AI Search SDK · Google Gemini API · MongoDB Atlas · React 18 / Vite.

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
- **Data Flow Diagram**:
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
        │        FreshnessGuard Core Engine (Port 5000)   │
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
        - Real-Time SSE Telemetry ───> React Dashboard (Port 5173)
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
- *Ground-truth labels (`eval/eval_set.json`) and baseline results (`eval/baselines/v0.1.0-baseline.json`) are permanently archived and unmodified.*

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
  - **100% Live Prototype Running** (Backend on `:5000`, Frontend on `:5173`).
- **Open-Source Repository**: Fully prepared for public submission with comprehensive documentation, reproduction scripts, and zero secret leaks.
