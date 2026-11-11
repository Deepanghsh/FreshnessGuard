# FreshnessGuard — Pitch Deck Outline

> **Geek Room Global AI Hackathon (Dual Track: Bifrost Gateway PS 04 + Tavily Stale-Answer Detector PS 01)**  
> *"Fact-checkers ask if a claim is true. We ask if it's still true."*

---

### Slide 1: Title & Hook
- **Title**: FreshnessGuard
- **Subtitle**: Real-Time Temporal Freshness Intelligence for LLM Gateways
- **One-Liner**: The missing gateway layer that catches and corrects outdated LLM facts using live web evidence.
- **Presenter**: Deepa & Team
- **Tags**: Open-Source · Bifrost Gateway Plugin · Tavily Search API · Temporal Verification

---

### Slide 2: The Silent Failure of LLMs
- **The Core Problem**: LLMs state facts with 100% confidence even when their world knowledge is expired.
- **Examples**:
  - *"GPT-4 costs $0.03 per 1K tokens"* (Outdated pricing)
  - *"The latest stable React version is 18.2"* (Superseded version)
  - *"Parag Agrawal is the CEO of Twitter"* (Changed leadership)
  - *"Under Privacy Shield, cross-border data transfer is legal"* (Invalidated law)
- **The Gap**: Traditional fact-checkers verify whether a statement was historically true. Nobody checks if it is **still true today**.

---

### Slide 3: The Solution — FreshnessGuard
- **Where It Sits**: Directly inside the Bifrost Open-Source Gateway as a high-performance `PostLLMHook`.
- **How It Works in 4 Steps**:
  1. **Intercept**: Captures raw LLM output before delivery to user.
  2. **Extract & Triage**: Identifies time-sensitive claims (pricing, versions, laws, dates, leadership) and filters out immutable facts.
  3. **Verify**: Queries Tavily with authoritative domain boosting and recency filters.
  4. **Enrich & Fail-Open**: Appends freshness scores (0–1), evidence citations, and non-destructive corrections.

---

### Slide 4: Dual Track Alignment — Why Both Tracks?
- **Track 1: Bifrost Gateway (PS 04)**:
  - Built as a native Bifrost Go Plugin using the official `schemas.LLMPlugin` interface.
  - Fail-Open design guarantees 99.999% gateway availability under any failure mode.
  - Injects `X-FreshnessGuard-Score`, `X-FreshnessGuard-Stale`, `X-FreshnessGuard-Latency` headers.
- **Track 2: Tavily Stale-Answer Detector (PS 01)**:
  - Deep integration with `@tavily/core` for live web intelligence.
  - Multi-factor mathematical scoring formula (agreement, authority, recency, source count).
  - Delivers live value extraction and primary source verification links.

---

### Slide 5: System Architecture & Data Flow
- **Visual Flow**:
  - `User` ➔ `Bifrost Gateway` ➔ `LLM Provider` ➔ `FreshnessGuard Plugin (Go)`
  - ➔ `Node.js Service` (Extract ➔ Triage ➔ Cache ➔ Tavily ➔ Score)
  - ➔ `MongoDB (Cache & Analytics)` ➔ `React Dashboard (Live SSE)`
- **Key Technical Invariant**: Strict timeout budget (2000ms). If downstream exceeds budget, returns original answer untouched.

---

### Slide 6: The Mathematical Freshness Formula
$$\text{Score} = (\text{Agreement} \times 0.40) + (\text{Authority} \times 0.30) + (\text{Recency} \times 0.20) + (\text{Count} \times 0.10)$$
- **Agreement ($w_1 = 0.4$)**: Ratio of search evidence directly corroborating the claim.
- **Authority ($w_2 = 0.3$)**: Boost for official documentation, gov/edu domains, and official corporate sites.
- **Recency ($w_3 = 0.2$)**: Time-decay scoring based on publication date (0–7 days = 1.0, 7–30 days = 0.8).
- **Count ($w_4 = 0.1$)**: Logarithmic saturation for multi-source confirmation.

---

### Slide 7: Real-World Performance & Evaluation Harness
- **Evaluation Dataset**: 35 hand-labeled ground-truth examples spanning 5 high-volatility domains.
- **Results**:
  - **Precision (Stale)**: **87.5%**
  - **Recall (Stale)**: **90.6%**
  - **F1 Score**: **0.890**
  - **Cache Hit Latency**: **~30 ms**
  - **Cold Path Latency**: **~198 ms average / 340 ms P95** (with Tavily parallel search)

---

### Slide 8: Enterprise-Ready Features
- **Smart Category-Aware Caching**:
  - Pricing: 6h TTL | Versions: 12h TTL | Leadership: 24h TTL | Laws: 72h TTL
- **Dual Execution Modes**:
  - `inline`: Real-time synchronous verification for critical workflows.
  - `async`: Immediate return with async SSE backfill for zero-latency user interfaces.
- **Standalone Heuristic Fallback**:
  - Go plugin includes `basicMode` (regex extraction) requiring zero external services.

---

### Slide 9: Live Demo Highlights
- **Demo 1: Stale API Pricing**: OpenAI GPT-4 $0.03/1K pricing detected stale ➔ corrected to current pricing.
- **Demo 2: Stale Software Version**: React 18.2.0 detected stale ➔ updated with React 19 release evidence.
- **Demo 3: Leadership Turnover**: Former CEO flagged with real-time news citation.
- **Demo 4: Real-time SSE Dashboard**: Live inspection, latency graphs, and interactive playground.

---

### Slide 10: Roadmap & Vision
- **Next Steps**:
  - Direct integration into upstream Bifrost gateway core plugin directory.
  - Automated enterprise Slack / Webhook alert dispatching when stale facts peak.
  - Enterprise model fine-tuning feedback loop (RLHF dataset of stale outputs).
- **Call to Action**: Clone the repo, run `docker-compose up`, and safeguard your AI gateways today.
