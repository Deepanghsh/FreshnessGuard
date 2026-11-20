# FreshnessGuard — 6-Minute Demo Video Script

> **Hackathon Submission Video Guide**  
> **Target Duration**: 06:00  
> **Speaker Role**: Senior Full-Stack Engineer / Product Lead  
> **Screen Setup**: Left half: VS Code & Terminal / Bifrost logs | Right half: FreshnessGuard React Dashboard (`http://localhost:5173`)

---

### [00:00 – 00:45] Chapter 1: The Problem & Pitch
- **Visual**: Slide 1 & 2 or clean terminal prompt.
- **Narrator**:
  > *"Every day, millions of users query LLMs for critical decisions—pricing, API versions, legal regulations, and company leadership. And every day, LLMs state outdated facts with 100% confidence.  
  > Fact-checkers ask if a claim was true. We ask: **is it still true today?**  
  > Introducing **FreshnessGuard**, a dual-track open-source solution for the Bifrost Gateway and the Tavily Stale-Answer Detector challenge."*

---

### [00:45 – 01:45] Chapter 2: The Architecture & Fail-Open Guarantee
- **Visual**: Show the Architecture page in the React dashboard (`/architecture`) with the interactive SVG diagram.
- **Narrator**:
  > *"FreshnessGuard operates at the network gateway level inside Bifrost as a Go `PostLLMHook` plugin. When an LLM generates a response, FreshnessGuard intercepts it.  
  > Crucially, we enforce a strict **Fail-Open invariant**: if our verification engine or downstream network times out or fails, the gateway immediately passes the original answer untouched with zero downtime.  
  > Behind the plugin, our Node.js and MongoDB service extracts claims, triages them by volatility category, checks per-category TTL caches, queries the Tavily search API, and computes a multi-factor freshness score."*

---

### [01:45 – 03:00] Chapter 3: Live Playground Demo (Before & After)
- **Visual**: Navigate to `/playground`.
- **Action**:
  1. Click **Demo 1: GPT-4 Pricing**.
  2. Input shows: *"GPT-4 costs $0.03 per 1K input tokens and $0.06 per 1K output tokens."*
  3. Click **"🛡️ Check Freshness"**.
  4. Watch the pipeline animation light up: `Extract ➔ Triage ➔ Cache ➔ Tavily ➔ Score`.
- **Narrator**:
  > *"Notice how the pipeline detects the pricing claim, flags it as high-volatility, searches Tavily with official domain boosting, and determines the claim is stale.  
  > On the right, the answer is rendered with clear visual annotations: the stale price is crossed out, the live value is displayed, and verified source citations are provided."*
- **Action**:
  5. Click **Demo 2: React Version**.
  6. Point out: React 18.2 is flagged stale with reference to modern releases.

---

### [03:00 – 04:15] Chapter 4: Live Gateway Feed & Response Inspector
- **Visual**: Navigate to `/overview` and click a stale response to open `/inspector/:id`.
- **Narrator**:
  > *"Here is the production Overview dashboard connected to the Bifrost gateway via real-time Server-Sent Events (SSE). Operators can view real-time throughput, overall freshness scores, and stale-vs-current ratios.  
  > Clicking into any transaction opens the full Response Inspector. Here we see:  
  > - Injected gateway headers: `X-FreshnessGuard-Score`, `X-FreshnessGuard-Stale`, `X-FreshnessGuard-Latency`.  
  > - Per-claim mathematical score breakdown based on evidence agreement, authority, and recency.  
  > - One-click re-verification button that busts the cache and re-queries live sources."*

---

### [04:15 – 05:00] Chapter 5: Code Walkthrough & Go Plugin
- **Visual**: Switch to VS Code.
- **Narrator**:
  > *"Let's take a quick look under the hood:  
  > In `plugins/freshnessguard/main.go`, we implement Bifrost's `LLMPlugin` interface. It includes both a zero-dependency local `basicMode` using regex extraction, and a high-accuracy `serviceMode` that connects to our verification server.  
  > Notice the fail-open fallback handlers and the HTTP header injection logic.  
  > In `server/src/services/scoring.ts`, our scoring formula weights evidence agreement at 40%, source authority at 30%, recency at 20%, and source count at 10%."*

---

### [05:00 – 05:30] Chapter 6: Evaluation Harness & Quality Metrics
- **Visual**: Run documented command `SERVER_URL=http://localhost:5000 npx -y tsx eval/run_eval.ts` in terminal or show the live Benchmarks matrix in the dashboard (`/benchmarks`).
- **Narrator**:
  > *"We don't just claim it works—we prove it. We built an automated 35-sample ground-truth evaluation dataset (`eval/eval_set.json`) spanning pricing, versions, leadership, dates, and laws.
  > Against our live cluster with real Tavily search and MongoDB Atlas, our evaluation harness achieved **91.4% overall accuracy** (32/35 correct), a perfect **100.0% precision** with zero false positive flags, and **81.3% recall** on stale answer interception, with L1 cache-hit response times under 10 milliseconds (7.5ms measured)."*

---

### [05:30 – 06:00] Chapter 7: One-Command Quickstart & Conclusion
- **Visual**: Show `docker-compose.yml` and root `README.md`.
- **Narrator**:
  > *"FreshnessGuard is completely open-source, reproducible in a single command with `docker-compose up`, and requires only your own API keys.  
  > By bringing together the open-source Bifrost Gateway and Tavily's live web intelligence, FreshnessGuard ensures that AI answers don't just sound confident—they stay fresh and true.  
  > Thank you!"*
