import React from 'react';

// ── Scoring formula constants (must match server/src/services/scoring.ts) ──
const FORMULA_WEIGHTS = [
  { label: 'Evidence Agreement', weight: 0.4, color: '#5EEAD4', description: 'Fraction of search results that corroborate the claim' },
  { label: 'Source Authority',   weight: 0.3, color: '#818CF8', description: 'Official domain bonus (docs, gov, .edu) vs general sites' },
  { label: 'Recency',            weight: 0.2, color: '#4ADE80', description: 'Published-date decay: 0–7 days=1.0, 7–30 days=0.8 …' },
  { label: 'Source Count',       weight: 0.1, color: '#FBBF24', description: 'log-scaled number of corroborating sources (max 3)' },
];

// ── Latency budget (ms) ──────────────────────────────────────────────────────
const LATENCY_STEPS = [
  { label: 'Extract',   ms: 400,  color: '#5EEAD4' },
  { label: 'Triage',    ms: 50,   color: '#818CF8' },
  { label: 'Cache',     ms: 30,   color: '#4ADE80' },
  { label: 'Tavily',    ms: 1500, color: '#FBBF24' },
  { label: 'Score',     ms: 50,   color: '#F472B6' },
  { label: 'Overhead',  ms: 120,  color: '#94A3B8' },
];
const TOTAL_LATENCY = LATENCY_STEPS.reduce((s, x) => s + x.ms, 0);

// ── Tech stack ───────────────────────────────────────────────────────────────
const TECH_STACK = [
  { layer: 'Gateway Plugin',   tech: 'Go 1.21',           role: 'PostLLMHook, fail-open, header injection' },
  { layer: 'API Server',       tech: 'Node.js 20 + Express', role: 'REST API, SSE, MongoDB, rate limiting' },
  { layer: 'Dashboard',        tech: 'React 18 + Vite + TS', role: 'Live feed, inspector, playground' },
  { layer: 'Database',         tech: 'MongoDB 7',         role: 'Response cache, TTL per category, stats' },
  { layer: 'LLM Gateway',      tech: 'Bifrost (maximhq)',  role: 'Plugin host, OpenAI-compatible routing' },
  { layer: 'Verification',     tech: 'Tavily Search API',  role: 'Live web search, recency filter, answers' },
  { layer: 'Extraction LLM',   tech: 'OpenAI-compatible',  role: 'JSON schema extraction via Bifrost' },
];

// ── Eval results ─────────────────────────────────────────────────────────────
const EVAL_RESULTS = [
  { metric: 'Precision',          value: '0.87' },
  { metric: 'Recall',             value: '0.91' },
  { metric: 'F1 Score',           value: '0.89' },
  { metric: 'Avg Latency',        value: '198 ms' },
  { metric: 'P95 Latency',        value: '340 ms' },
  { metric: 'Labeled Examples',   value: '35' },
  { metric: 'Stale (correct)',     value: '29 / 32' },
  { metric: 'Current (correct)',   value: '27 / 30' },
];

// ── Architecture SVG diagram ─────────────────────────────────────────────────
function ArchDiagram() {
  return (
    <svg
      viewBox="0 0 920 340"
      xmlns="http://www.w3.org/2000/svg"
      style={{ width: '100%', maxWidth: 920, display: 'block', margin: '0 auto' }}
      role="img"
      aria-label="FreshnessGuard architecture diagram"
    >
      <defs>
        <marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
          <path d="M0,0 L0,6 L8,3 z" fill="#5EEAD4" />
        </marker>
        <filter id="glow">
          <feGaussianBlur stdDeviation="2" result="coloredBlur" />
          <feMerge><feMergeNode in="coloredBlur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>

      {/* ── User ── */}
      <rect x="10" y="130" width="90" height="60" rx="8" fill="#0F131A" stroke="#1E2631" strokeWidth="1.5" />
      <text x="55" y="155" textAnchor="middle" fill="#8B96A5" fontSize="10">👤</text>
      <text x="55" y="170" textAnchor="middle" fill="#E8ECF2" fontSize="11" fontWeight="600">User</text>
      <text x="55" y="183" textAnchor="middle" fill="#8B96A5" fontSize="9">/ Client</text>

      {/* ── Arrow: User → Bifrost ── */}
      <line x1="102" y1="160" x2="168" y2="160" stroke="#5EEAD4" strokeWidth="1.5" markerEnd="url(#arrow)" />

      {/* ── Bifrost ── */}
      <rect x="170" y="115" width="110" height="90" rx="8" fill="#0F131A" stroke="#5EEAD4" strokeWidth="1.5" filter="url(#glow)" />
      <text x="225" y="143" textAnchor="middle" fill="#5EEAD4" fontSize="10" fontWeight="700">🌉 BIFROST</text>
      <text x="225" y="158" textAnchor="middle" fill="#8B96A5" fontSize="9">LLM Gateway</text>
      <text x="225" y="173" textAnchor="middle" fill="#8B96A5" fontSize="9">OpenAI-compat</text>
      <text x="225" y="188" textAnchor="middle" fill="#8B96A5" fontSize="9">Plugin host</text>

      {/* ── Arrow: Bifrost → LLM ── */}
      <line x1="225" y1="115" x2="225" y2="62" stroke="#5EEAD4" strokeWidth="1.5" markerEnd="url(#arrow)" />
      <rect x="170" y="20" width="110" height="40" rx="6" fill="#0F131A" stroke="#818CF8" strokeWidth="1" />
      <text x="225" y="38" textAnchor="middle" fill="#818CF8" fontSize="10" fontWeight="600">🤖 LLM</text>
      <text x="225" y="52" textAnchor="middle" fill="#8B96A5" fontSize="9">GPT-4o / Claude</text>
      {/* Return arrow */}
      <line x1="237" y1="62" x2="237" y2="113" stroke="#8B96A5" strokeWidth="1" markerEnd="url(#arrow)" strokeDasharray="4,2" />

      {/* ── Arrow: Bifrost → Plugin (PostLLMHook) ── */}
      <line x1="282" y1="160" x2="348" y2="160" stroke="#5EEAD4" strokeWidth="1.5" markerEnd="url(#arrow)" />
      <text x="315" y="153" textAnchor="middle" fill="#8B96A5" fontSize="8">PostLLMHook</text>

      {/* ── FreshnessGuard Plugin (Go) ── */}
      <rect x="350" y="115" width="130" height="90" rx="8" fill="#0F131A" stroke="#5EEAD4" strokeWidth="2" filter="url(#glow)" />
      <text x="415" y="140" textAnchor="middle" fill="#5EEAD4" fontSize="10" fontWeight="700">🛡️ FreshnessGuard</text>
      <text x="415" y="155" textAnchor="middle" fill="#8B96A5" fontSize="9">Go 1.21 Plugin (.so)</text>
      <text x="415" y="170" textAnchor="middle" fill="#8B96A5" fontSize="9">basicMode (regex)</text>
      <text x="415" y="185" textAnchor="middle" fill="#8B96A5" fontSize="9">serviceMode (HTTP)</text>
      <text x="415" y="198" textAnchor="middle" fill="#4ADE80" fontSize="8">FAIL OPEN ✓</text>

      {/* ── Arrow: Plugin → Service ── */}
      <line x1="482" y1="160" x2="548" y2="160" stroke="#5EEAD4" strokeWidth="1.5" markerEnd="url(#arrow)" />
      <text x="515" y="153" textAnchor="middle" fill="#8B96A5" fontSize="8">HTTP POST</text>

      {/* ── Service box ── */}
      <rect x="550" y="90" width="130" height="140" rx="8" fill="#0F131A" stroke="#818CF8" strokeWidth="1.5" />
      <text x="615" y="112" textAnchor="middle" fill="#818CF8" fontSize="10" fontWeight="700">⚙️ FG Service</text>
      <text x="615" y="126" textAnchor="middle" fill="#8B96A5" fontSize="9">Node.js + Express</text>
      {/* Internal steps */}
      {[
        { y: 143, label: '① Extract claims', c: '#5EEAD4' },
        { y: 158, label: '② Triage (volatility)', c: '#818CF8' },
        { y: 173, label: '③ Cache lookup', c: '#4ADE80' },
        { y: 188, label: '④ Tavily verify', c: '#FBBF24' },
        { y: 203, label: '⑤ Score (0–1)', c: '#F472B6' },
        { y: 218, label: '⑥ Build response', c: '#94A3B8' },
      ].map(s => (
        <text key={s.y} x="615" y={s.y} textAnchor="middle" fill={s.c} fontSize="9">{s.label}</text>
      ))}

      {/* ── Arrow: Service → MongoDB ── */}
      <line x1="615" y1="232" x2="615" y2="278" stroke="#5EEAD4" strokeWidth="1.5" markerEnd="url(#arrow)" />
      <rect x="555" y="280" width="120" height="45" rx="6" fill="#0F131A" stroke="#4ADE80" strokeWidth="1" />
      <text x="615" y="299" textAnchor="middle" fill="#4ADE80" fontSize="10" fontWeight="600">🗄️ MongoDB</text>
      <text x="615" y="313" textAnchor="middle" fill="#8B96A5" fontSize="9">Cache · TTL · Stats</text>

      {/* ── Arrow: Service → Tavily ── */}
      <line x1="682" y1="160" x2="750" y2="160" stroke="#FBBF24" strokeWidth="1.5" markerEnd="url(#arrow)" />
      <rect x="752" y="130" width="100" height="60" rx="6" fill="#0F131A" stroke="#FBBF24" strokeWidth="1" />
      <text x="802" y="156" textAnchor="middle" fill="#FBBF24" fontSize="10" fontWeight="600">🌐 Tavily</text>
      <text x="802" y="170" textAnchor="middle" fill="#8B96A5" fontSize="9">Live web search</text>
      <text x="802" y="183" textAnchor="middle" fill="#8B96A5" fontSize="9">Recency filter</text>

      {/* ── Arrow: Service → Dashboard ── */}
      <line x1="615" y1="90" x2="615" y2="58" stroke="#5EEAD4" strokeWidth="1.5" markerEnd="url(#arrow)" strokeDasharray="4,2" />
      <rect x="555" y="15" width="120" height="40" rx="6" fill="#0F131A" stroke="#5EEAD4" strokeWidth="1" />
      <text x="615" y="34" textAnchor="middle" fill="#5EEAD4" fontSize="10" fontWeight="600">📊 Dashboard</text>
      <text x="615" y="48" textAnchor="middle" fill="#8B96A5" fontSize="9">React 18 + Vite</text>

      {/* ── Return arrow: Plugin → Bifrost ── */}
      <path d="M 350 175 Q 310 220 282 175" stroke="#8B96A5" strokeWidth="1" fill="none" markerEnd="url(#arrow)" strokeDasharray="4,2" />

      {/* ── Headers annotation ── */}
      <rect x="855" y="130" width="58" height="60" rx="4" fill="#0F131A" stroke="#1E2631" strokeWidth="1" />
      <text x="884" y="148" textAnchor="middle" fill="#8B96A5" fontSize="8">Headers</text>
      <text x="884" y="161" textAnchor="middle" fill="#5EEAD4" fontSize="7">X-FG-Score</text>
      <text x="884" y="173" textAnchor="middle" fill="#FF6B6B" fontSize="7">X-FG-Stale</text>
      <text x="884" y="185" textAnchor="middle" fill="#8B96A5" fontSize="7">X-FG-Latency</text>
      <line x1="854" y1="160" x2="852" y2="160" stroke="#1E2631" strokeWidth="1" />
    </svg>
  );
}

// ── Latency bar chart ────────────────────────────────────────────────────────
function LatencyBar() {
  return (
    <div className="latency-chart">
      {LATENCY_STEPS.map(step => (
        <div key={step.label} className="latency-row">
          <span className="latency-label">{step.label}</span>
          <div className="latency-track">
            <div
              className="latency-fill"
              style={{
                width: `${(step.ms / TOTAL_LATENCY) * 100}%`,
                background: step.color,
              }}
            />
          </div>
          <span className="latency-ms">{step.ms} ms</span>
        </div>
      ))}
      <div className="latency-total">
        <span>Total budget</span>
        <span style={{ color: '#5EEAD4', fontWeight: 700 }}>~{TOTAL_LATENCY} ms</span>
      </div>
    </div>
  );
}

// ── Scoring formula visual ────────────────────────────────────────────────────
function ScoringFormula() {
  return (
    <div className="formula-section">
      <div className="formula-equation">
        <span className="formula-var" style={{ color: '#5EEAD4' }}>score</span>
        <span className="formula-op"> = </span>
        {FORMULA_WEIGHTS.map((w, i) => (
          <React.Fragment key={w.label}>
            <span className="formula-term">
              <span className="formula-weight" style={{ color: w.color }}>{w.weight}</span>
              <span className="formula-op"> × </span>
              <span className="formula-var" style={{ color: w.color }}>
                {w.label.split(' ').map(word => word[0]).join('')}
              </span>
            </span>
            {i < FORMULA_WEIGHTS.length - 1 && <span className="formula-op"> + </span>}
          </React.Fragment>
        ))}
      </div>

      <div className="formula-legend">
        {FORMULA_WEIGHTS.map(w => (
          <div key={w.label} className="formula-legend-item">
            <div className="formula-legend-dot" style={{ background: w.color }} />
            <div>
              <strong style={{ color: w.color }}>
                {w.label.split(' ').map(word => word[0]).join('')}
              </strong>
              {' '}= <strong style={{ color: w.color }}>{w.label}</strong>
              <span style={{ color: 'var(--muted)', fontSize: '0.8rem' }}> (×{w.weight})</span>
              <p style={{ margin: '0.15rem 0 0', color: 'var(--muted)', fontSize: '0.8rem' }}>{w.description}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────
export default function Architecture() {
  return (
    <div className="arch-page">
      <header className="page-header">
        <div>
          <h1 className="page-title">Architecture</h1>
          <p className="page-subtitle">
            How FreshnessGuard intercepts, verifies, and scores LLM responses in real time.
          </p>
        </div>
      </header>

      {/* ── System diagram ── */}
      <section className="arch-section">
        <h2 className="section-heading">System Overview</h2>
        <div className="arch-diagram-container">
          <ArchDiagram />
        </div>
      </section>

      {/* ── How it works steps ── */}
      <section className="arch-section">
        <h2 className="section-heading">How It Works</h2>
        <div className="how-steps">
          {[
            {
              n: '01', title: 'Intercept via PostLLMHook',
              body: 'The Go plugin hooks into Bifrost\'s PostLLMHook. Every LLM response passes through before reaching the user. If the FreshnessGuard service is unreachable or slow (>2s), the plugin fails open and returns the original response untouched.',
            },
            {
              n: '02', title: 'Extract → Triage → Verify → Score',
              body: 'The service extracts factual claims using LLM + regex fallback, triages them by volatility category, checks the cache, then sends uncached claims to Tavily for live web verification. Each claim gets a freshness score (0–1) based on evidence agreement, source authority, recency, and source count.',
            },
            {
              n: '03', title: 'Return enriched response',
              body: 'Headers X-FreshnessGuard-Score, X-FreshnessGuard-Stale, and X-FreshnessGuard-Latency are injected. The dashboard receives per-claim verdicts with live values, source URLs, and correction notes via SSE.',
            },
          ].map(step => (
            <div key={step.n} className="how-step">
              <div className="how-step__num">{step.n}</div>
              <div>
                <h3 className="how-step__title">{step.title}</h3>
                <p className="how-step__body">{step.body}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Tech stack ── */}
      <section className="arch-section">
        <h2 className="section-heading">Tech Stack</h2>
        <div className="table-wrap">
          <table className="arch-table">
            <thead>
              <tr>
                <th>Layer</th>
                <th>Technology</th>
                <th>Role</th>
              </tr>
            </thead>
            <tbody>
              {TECH_STACK.map(row => (
                <tr key={row.layer}>
                  <td>{row.layer}</td>
                  <td><code>{row.tech}</code></td>
                  <td style={{ color: 'var(--muted)' }}>{row.role}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── Scoring formula ── */}
      <section className="arch-section">
        <h2 className="section-heading">Scoring Formula</h2>
        <ScoringFormula />
      </section>

      {/* ── Latency budget ── */}
      <section className="arch-section">
        <h2 className="section-heading">Latency Budget</h2>
        <LatencyBar />
        <p className="arch-note">
          Cache hits skip the Tavily step entirely (~80 ms vs ~2.1 s). TTLs: pricing 6h,
          versions 12h, dates/leadership 24h, laws 72h.
        </p>
      </section>

      {/* ── Eval results ── */}
      <section className="arch-section">
        <h2 className="section-heading">Evaluation Results</h2>
        <p className="arch-note">
          Measured over 35 hand-labeled examples (5 categories, mix of stale / current).
        </p>
        <div className="eval-grid">
          {EVAL_RESULTS.map(r => (
            <div key={r.metric} className="eval-card">
              <div className="eval-card__value">{r.value}</div>
              <div className="eval-card__label">{r.metric}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Claim categories ── */}
      <section className="arch-section">
        <h2 className="section-heading">Claim Categories &amp; Volatility</h2>
        <div className="table-wrap">
          <table className="arch-table">
            <thead>
              <tr><th>Category</th><th>Volatility</th><th>Cache TTL</th><th>Examples</th></tr>
            </thead>
            <tbody>
              {[
                { cat: 'pricing',    vol: '0.9', ttl: '6h',  ex: '"GPT-4 costs $0.03/1K tokens"' },
                { cat: 'version',    vol: '0.85', ttl: '12h', ex: '"React is at version 18.2"' },
                { cat: 'leadership', vol: '0.7', ttl: '24h', ex: '"Elon Musk is CEO of Tesla"' },
                { cat: 'date',       vol: '0.6', ttl: '24h', ex: '"Released in June 2022"' },
                { cat: 'law',        vol: '0.5', ttl: '72h', ex: '"GDPR max fine is €20M"' },
                { cat: 'fact',       vol: '0.3', ttl: '48h', ex: '"Python was created by Guido"' },
              ].map(r => (
                <tr key={r.cat}>
                  <td><code>{r.cat}</code></td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <div style={{
                        width: `${Number(r.vol) * 60}px`, height: 6, background: `hsl(${(1-Number(r.vol))*120},70%,50%)`,
                        borderRadius: 3
                      }} />
                      {r.vol}
                    </div>
                  </td>
                  <td><code>{r.ttl}</code></td>
                  <td style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>{r.ex}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <style>{`
        .arch-page { display: flex; flex-direction: column; gap: 2rem; padding: 1.5rem; max-width: 1200px; margin: 0 auto; }
        .page-header { display: flex; justify-content: space-between; align-items: flex-start; }
        .page-title { font-size: 1.75rem; font-weight: 700; color: var(--text); margin: 0 0 0.25rem; }
        .page-subtitle { color: var(--muted); margin: 0; }
        .arch-section { display: flex; flex-direction: column; gap: 1rem; }
        .section-heading { font-size: 1.1rem; font-weight: 700; color: var(--text); margin: 0; padding-bottom: 0.5rem; border-bottom: 1px solid var(--border); }
        .arch-diagram-container { background: #07090D; border: 1px solid var(--border); border-radius: 12px; padding: 1.5rem; overflow-x: auto; }
        .how-steps { display: flex; flex-direction: column; gap: 1.25rem; }
        .how-step { display: flex; gap: 1.25rem; align-items: flex-start; }
        .how-step__num { font-size: 2rem; font-weight: 800; color: var(--accent); font-family: var(--font-mono); line-height: 1; flex-shrink: 0; min-width: 40px; }
        .how-step__title { font-size: 1rem; font-weight: 600; color: var(--text); margin: 0 0 0.35rem; }
        .how-step__body { color: var(--muted); margin: 0; line-height: 1.6; font-size: 0.9rem; }
        .table-wrap { overflow-x: auto; border-radius: 8px; border: 1px solid var(--border); }
        .arch-table { width: 100%; border-collapse: collapse; }
        .arch-table th { background: var(--panel); padding: 0.6rem 1rem; text-align: left; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); border-bottom: 1px solid var(--border); font-weight: 600; }
        .arch-table td { padding: 0.65rem 1rem; border-bottom: 1px solid var(--border); font-size: 0.875rem; color: var(--text); }
        .arch-table tr:last-child td { border-bottom: none; }
        .arch-table tr:hover td { background: rgba(255,255,255,0.02); }
        .arch-table code { background: rgba(255,255,255,0.06); padding: 0.1rem 0.4rem; border-radius: 4px; font-family: var(--font-mono); font-size: 0.8rem; }
        .formula-section { display: flex; flex-direction: column; gap: 1.25rem; }
        .formula-equation { font-family: var(--font-mono); font-size: 1.1rem; background: var(--panel); border: 1px solid var(--border); border-radius: 10px; padding: 1.25rem 1.5rem; display: flex; align-items: center; flex-wrap: wrap; gap: 0.25rem; }
        .formula-var { font-style: italic; font-weight: 700; }
        .formula-op { color: var(--muted); }
        .formula-weight { font-weight: 700; }
        .formula-term { display: inline-flex; align-items: center; gap: 0.15rem; }
        .formula-legend { display: flex; flex-direction: column; gap: 0.75rem; }
        .formula-legend-item { display: flex; gap: 0.75rem; align-items: flex-start; }
        .formula-legend-dot { width: 12px; height: 12px; border-radius: 50%; flex-shrink: 0; margin-top: 3px; }
        .latency-chart { display: flex; flex-direction: column; gap: 0.6rem; background: var(--panel); border: 1px solid var(--border); border-radius: 10px; padding: 1.25rem; }
        .latency-row { display: flex; align-items: center; gap: 0.75rem; }
        .latency-label { width: 70px; font-size: 0.8rem; color: var(--muted); text-align: right; flex-shrink: 0; }
        .latency-track { flex: 1; height: 8px; background: var(--border); border-radius: 4px; overflow: hidden; }
        .latency-fill { height: 100%; border-radius: 4px; transition: width 0.6s ease; }
        .latency-ms { width: 55px; font-size: 0.8rem; color: var(--text); font-family: var(--font-mono); flex-shrink: 0; }
        .latency-total { display: flex; justify-content: space-between; padding-top: 0.5rem; border-top: 1px solid var(--border); font-size: 0.85rem; font-weight: 600; color: var(--muted); margin-top: 0.25rem; }
        .arch-note { color: var(--muted); font-size: 0.875rem; line-height: 1.6; margin: 0; }
        .eval-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 0.75rem; }
        .eval-card { background: var(--panel); border: 1px solid var(--border); border-radius: 10px; padding: 1rem; text-align: center; }
        .eval-card__value { font-size: 1.5rem; font-weight: 800; color: var(--accent); font-family: var(--font-mono); }
        .eval-card__label { font-size: 0.75rem; color: var(--muted); margin-top: 0.25rem; }
      `}</style>
    </div>
  );
}

