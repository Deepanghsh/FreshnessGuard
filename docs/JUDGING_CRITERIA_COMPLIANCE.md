# FreshnessGuard — Official Judging Criteria Compliance

> **Geek Room AI Global Hackathon**  
> **Primary Problem Statement:** #4 — Open-Source Bifrost Gateway  
> **Specialized Problem Statement:** #6 — Build a Stale-Answer Detector for AI Applications (Tavily)  

This document presents explicit technical and empirical evidence for each of the six official hackathon evaluation criteria.

---

## 1. Innovation

### The Paradigm Shift: Temporal Freshness vs. Traditional Fact-Checking
- **The Status Quo**: Traditional fact-checkers and LLM guardrails ask: *"Was this statement factual?"* Semantic search and standard RAG retrieve text based purely on *semantic embedding distance*, regardless of whether the source was published yesterday or five years ago. Consequently, LLMs routinely regurgitate obsolete facts (e.g. citing 2022 prices or 2020 executive teams) with 100% syntactic confidence.
- **FreshnessGuard's Breakthrough**: FreshnessGuard is the first gateway-level extension designed specifically to answer: **"Is this claim still true today?"**
- **Gateway-Native Interception**: Instead of requiring developers to write bespoke client-side verification logic or prompt wrappers, FreshnessGuard operates directly at the gateway layer inside the open-source Bifrost LLM gateway via a native Go plugin. Every model, provider, and application connected to the gateway is automatically protected.
- **Non-Destructive Corrections**: FreshnessGuard does not silently rewrite or hallucinate over the original model output; it preserves model response integrity while providing color-coded inline visual diffs, verifiable primary web citations, and structured HTTP response headers.

---

## 2. Technical Execution

### Real Working Integrations (No Mocks, No Simulations)
- **Native Bifrost Go Plugin**:
  - Implemented in `plugins/freshnessguard/main.go` conforming to Bifrost's official `schemas.LLMPlugin` interface.
  - Intercepts requests via `PreLLMHook` (injecting `x-freshnessguard-bypass: true` to prevent recursive LLM loops) and `PostLLMHook`.
  - Implements strict **Fail-Open Semantics**: if the verification engine times out (> 2000ms) or fails, the gateway immediately returns the raw completion without dropping user traffic.
  - Injects gateway telemetry headers: `X-FreshnessGuard-Score`, `X-FreshnessGuard-Stale`, `X-FreshnessGuard-Latency-Ms`, `X-FreshnessGuard-Mode`, and `X-FreshnessGuard-Request-Id`.
- **Live Tavily Web Evidence Engine**:
  - Powered by the official `@tavily/core` SDK.
  - Employs **Entity-Attribute Query Synthesis**: strips stale claimed dollar amounts to eliminate historical search confirmation bias (e.g. searching `"Netflix Standard plan US price"` rather than bias-inducing `"$9.99"`).
  - Performs authoritative domain boosting (`.gov`, `.edu`, documentation subdomains) and publication recency time-decay scoring.
- **Production-Grade Reliability & Caching**:
  - Two-tier cache: Sub-10ms L1 in-memory cache (**7.5ms empirically measured**) and MongoDB Atlas L2 cache with domain-specific TTL policies (Pricing: 6h, Versions: 12h, Leadership: 24h, Laws: 72h).
  - Degraded mode operation: starts and functions smoothly even if MongoDB or external search APIs are momentarily unavailable.
- **Verified Code Quality**:
  - **9 Jest Test Suites / 124 tests passing (100% clean)**.
  - TypeScript strict compilation with zero errors on both server and client.

---

## 3. Problem and Potential Impact

### The Critical Danger of Stale AI Answers in Production
- **Commercial & API Pricing**:
  - *Risk*: Quoting outdated model rates (e.g. March 2023 GPT-4 pricing of $0.03/1K tokens instead of modern GPT-4o pricing of $2.50/1M tokens) breaks enterprise financial projections, pricing calculators, and automated purchasing agents.
  - *Impact*: FreshnessGuard flags superseded pricing and extracts current rates from official pricing pages.
- **Software Runtimes & Framework Versions**:
  - *Risk*: Recommending sunset runtimes (Python 2.7 EOL since 2020, Node 14 LTS) or outdated framework paradigms (Next.js 12 Pages Router instead of App Router) introduces critical CVE vulnerabilities and broken continuous integration builds.
  - *Impact*: FreshnessGuard checks active support lifecycles, returning `100.0% accuracy (10/10)` across software version test cases.
- **Corporate Leadership & Governance**:
  - *Risk*: Hallucinating former executives as current officers (e.g. Parag Agrawal at Twitter, Bob Chapek at Disney) impairs due diligence, automated financial research, and automated executive briefs.
  - *Impact*: FreshnessGuard detects executive turnover and maps succession events with `100.0% accuracy (5/5)`.
- **Legal & Regulatory Compliance**:
  - *Risk*: Advising businesses that the EU-US Privacy Shield remains a valid data transfer mechanism exposes cross-border data flows to severe GDPR penalties (invalidated under the CJEU Schrems II ruling).
  - *Impact*: FreshnessGuard detects regulatory invalidation and identifies modern frameworks with `100.0% accuracy (5/5)`.

---

## 4. Use of AI

### Synergistic Dual-Provider AI Architecture
FreshnessGuard uses AI models deliberately where reasoning and extraction are required, coupled with deterministic systems engineering for scoring:
1. **Google Gemini 3.1 Flash Lite (`gemini-3.1-flash-lite`)**:
   - **Structured Claim Extraction**: Prompts Gemini with JSON schema mode (`responseMimeType: "application/json"`) to parse complex natural language into atomic, time-sensitive factual assertions.
   - **Reasoning over Context**: Isolates the verbatim statement, category volatility, and discrete numerical/proper-noun values in sub-second inference time.
   - **AI Answer Generation**: Serves as the primary response generator in the interactive Playground.
2. **Tavily AI Search**:
   - Acts as the real-time knowledge grounding layer, crawling and filtering web ground truth dynamically.
3. **Deterministic Heuristic Safety Net**:
   - When external LLM inference times out or network limits are exceeded, an automated regex parser using `getEnclosingSentence` extracts claims deterministically with zero latency.
4. **Deterministic Mathematical Scoring**:
   - Rather than relying on a subjective secondary LLM prompt to grade freshness, FreshnessGuard calculates freshness mathematically using KaTeX-verifiable formulas based on source agreement, domain authority, and publication recency.

---

## 5. User Experience

### A Coherent, Professional Enterprise Workflow
The FreshnessGuard dashboard connects every stage of the verification lifecycle into an intuitive, accessible experience:
- **Interactive Playground (`/playground`)**:
  - **Dual Mode**: "Ask AI Question" (real-time Gemini inference through Bifrost) and "Paste AI Response" (arbitrary text evaluation).
  - **One-Click Presets**: 6 preloaded enterprise presets spanning pricing, versions, leadership, and regulations.
  - **Live Pipeline Tracker**: Visualizes stage progression: `Intercepted ➔ Claims Extracted ➔ Live Evidence Retrieved ➔ Freshness Scored`.
  - **Inline Visual Diff**: Instant toggle between Original and Corrected text with color-coded token replacements.
- **Deep-Dive Inspector (`/inspector`)**:
  - Displays sentence-by-sentence text breakdown.
  - Interactive claim cards showing confidence meters, domain authority scores, publication dates, verbatim search snippets, and clickable primary web links.
- **Command Center Overview (`/overview`)**:
  - High-level KPI summary cards, stale-vs-current distribution donut, hourly latency charts, and a real-time Server-Sent Events (SSE) transaction stream.
- **Empirical Benchmarks Matrix (`/benchmarks`)**:
  - Comprehensive 35-case ground-truth evaluation table with search, category filtering, pass/fail counters, and 1-click JSON/CSV export.
- **Visual Design & Accessibility**:
  - Professional Dark and Light themes with zero-latency pre-init script eliminating FOUC.
  - Frosted glass cards, high-contrast readable typography, and smooth micro-interactions.

---

## 6. Scalability and Potential

### Architectural Scalability & Future Viability
- **Sub-10ms L1 In-Memory Caching**:
  - Hot gateway requests hit memory cache with **7.5ms measured response time**, allowing the gateway to handle thousands of requests per second with negligible overhead.
- **Domain-Specific TTL Policies**:
  - Reduces redundant external search calls by up to 74.2% through category-specific TTL cache invalidation.
- **Bounded Request Execution**:
  - Strict 2000ms timeout budget enforced at the gateway plugin layer.
  - Controlled outbound concurrency (max 3 parallel search calls) with exponential backoff for rate-limit protection.
- **Multi-Tenant Enterprise Isolation**:
  - Isolated database schemas with user-level JWT authentication and per-tenant query history.
- **Future Commercial Potential**:
  - **Enterprise Intranet Allowlisting**: Extending domain boosting to corporate knowledge bases (Confluence, Notion, SharePoint).
  - **Automated Webhook & Slack Alerts**: Triggering security or finance alerts when stale claims spike in production traffic.
  - **RLHF Dataset Generation**: Exporting intercepted stale outputs to create fine-tuning datasets that teach models to acknowledge temporal boundaries.
