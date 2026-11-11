import React, { useState, useRef, useCallback } from 'react';
import { api } from '../api/client';
import type { ResponseDoc } from '../types';
import ScoreRing from '../components/ScoreRing';
import ClaimBadge from '../components/ClaimBadge';
import LoadingSpinner from '../components/LoadingSpinner';

// ── Pipeline step animation ──────────────────────────────────────────────────
const PIPELINE_STEPS = [
  { id: 'extract',  label: 'Extract',  icon: '🔍', durationMs: 500 },
  { id: 'triage',   label: 'Triage',   icon: '⚖️',  durationMs: 150 },
  { id: 'cache',    label: 'Cache',    icon: '💾',  durationMs: 80  },
  { id: 'tavily',   label: 'Tavily',   icon: '🌐',  durationMs: 2500 },
  { id: 'score',    label: 'Score',    icon: '📊',  durationMs: 150 },
];

type StepState = 'idle' | 'active' | 'done' | 'error';
type PipelineState = Record<string, StepState>;

// ── Annotated text with inline claim highlights ──────────────────────────────
function AnnotatedText({ text, claims }: { text: string; claims: ResponseDoc['claims'] }) {
  if (!claims || claims.length === 0) return <p className="playground-raw-text">{text}</p>;

  const parts: { text: string; claimIdx?: number }[] = [];
  let remaining = text;
  const sorted = [...claims].sort((a, b) =>
    remaining.indexOf(a.text) - remaining.indexOf(b.text)
  );

  for (const [i, claim] of sorted.entries()) {
    const idx = remaining.indexOf(claim.text);
    if (idx === -1) continue;
    if (idx > 0) parts.push({ text: remaining.slice(0, idx) });
    parts.push({ text: claim.text, claimIdx: i });
    remaining = remaining.slice(idx + claim.text.length);
  }
  if (remaining) parts.push({ text: remaining });

  return (
    <p className="playground-raw-text">
      {parts.map((p, i) =>
        p.claimIdx !== undefined ? (
          <mark
            key={i}
            className={`claim-highlight claim-highlight--${claims[p.claimIdx].verdict}`}
            title={claims[p.claimIdx].verdict}
          >
            {p.text}
            <sup className={`verdict-sup verdict-sup--${claims[p.claimIdx].verdict}`}>
              {p.claimIdx + 1}
            </sup>
          </mark>
        ) : (
          <span key={i}>{p.text}</span>
        )
      )}
    </p>
  );
}

// ── Evidence card per claim ──────────────────────────────────────────────────
function EvidenceCard({ claim, index }: { claim: ResponseDoc['claims'][0]; index: number }) {
  const isStale = claim.verdict === 'stale';
  const isCurrent = claim.verdict === 'current';

  return (
    <div className={`evidence-card evidence-card--${claim.verdict}`}>
      <div className="evidence-card__header">
        <span className="evidence-card__num">{index + 1}</span>
        <span className={`verdict-badge verdict-badge--${claim.verdict}`}>
          {isStale ? '⚠️ Stale' : isCurrent ? '✅ Current' : '❓ Unverified'}
        </span>
        <span className="evidence-card__category">{claim.category}</span>
        <ScoreRing score={claim.score ?? 0} size={40} />
      </div>

      <div className="evidence-card__claim">
        {isStale ? (
          <>
            <span className="evidence-card__stale-text">{claim.text}</span>
            {claim.liveValue && (
              <span className="evidence-card__live-value">→ {claim.liveValue}</span>
            )}
          </>
        ) : (
          <span>{claim.text}</span>
        )}
      </div>

      {claim.sources && claim.sources.length > 0 && (
        <div className="evidence-card__sources">
          {claim.sources.slice(0, 2).map((src, i) => (
            <a key={i} href={src.url} target="_blank" rel="noopener noreferrer" className="source-link">
              🔗 {src.title || new URL(src.url).hostname}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Demo prompts ─────────────────────────────────────────────────────────────
const DEMO_PROMPTS = [
  {
    label: '💰 GPT-4 Pricing',
    text: 'GPT-4 costs $0.03 per 1K input tokens and $0.06 per 1K output tokens. It was released in March 2023.',
  },
  {
    label: '📦 React Version',
    text: 'The latest stable version of React is 18.2.0, released in June 2022. React hooks were introduced in 16.8.',
  },
  {
    label: '👔 Tesla CEO',
    text: 'Elon Musk is the CEO of Tesla and SpaceX. Tesla was founded in 2003 and went public in 2010.',
  },
  {
    label: '⚖️ GDPR Fine',
    text: 'Under GDPR, the maximum fine is €20 million or 4% of annual global turnover, whichever is higher.',
  },
];

// ── Main Playground page ─────────────────────────────────────────────────────
export default function Playground() {
  const [inputText, setInputText]     = useState('');
  const [model, setModel]             = useState('gpt-4o-mini');
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState<string | null>(null);
  const [result, setResult]           = useState<ResponseDoc | null>(null);
  const [pipeline, setPipeline]       = useState<PipelineState>({});
  const [activeStep, setActiveStep]   = useState<string | null>(null);
  const abortRef                      = useRef<AbortController | null>(null);

  // Animate pipeline steps while the real request runs
  const animatePipeline = useCallback(() => {
    const initial: PipelineState = {};
    for (const s of PIPELINE_STEPS) initial[s.id] = 'idle';
    setPipeline(initial);

    let offset = 0;
    for (const step of PIPELINE_STEPS) {
      const stepId = step.id;
      const delay  = offset;
      setTimeout(() => {
        setActiveStep(stepId);
        setPipeline(prev => ({ ...prev, [stepId]: 'active' }));
      }, delay);
      setTimeout(() => {
        setPipeline(prev => ({ ...prev, [stepId]: 'done' }));
      }, delay + step.durationMs);
      offset += step.durationMs;
    }
  }, []);

  const handleCheck = useCallback(async () => {
    if (!inputText.trim()) return;
    setError(null);
    setResult(null);
    setLoading(true);
    animatePipeline();

    abortRef.current = new AbortController();
    try {
      const data = await api.postCheck(inputText.trim(), model);
      setResult(data);
    } catch (e: unknown) {
      if (e instanceof Error && e.name !== 'AbortError') {
        setError(e.message || 'Something went wrong');
      }
    } finally {
      setLoading(false);
      setActiveStep(null);
    }
  }, [inputText, model, animatePipeline]);

  const handleDemo = (prompt: string) => {
    setInputText(prompt);
    setResult(null);
    setError(null);
    setPipeline({});
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') handleCheck();
  };

  const staleClaims    = result?.claims.filter(c => c.verdict === 'stale')    ?? [];
  const currentClaims  = result?.claims.filter(c => c.verdict === 'current')  ?? [];
  const unverifiedClaims = result?.claims.filter(c => c.verdict === 'unverified') ?? [];

  return (
    <div className="playground-page">
      {/* ── Header ── */}
      <header className="page-header">
        <div>
          <h1 className="page-title">Playground</h1>
          <p className="page-subtitle">
            Paste any LLM response and watch FreshnessGuard check every claim live.
          </p>
        </div>
      </header>

      {/* ── Demo prompts ── */}
      <section className="demo-prompts">
        <span className="demo-prompts__label">Try a demo:</span>
        {DEMO_PROMPTS.map(d => (
          <button key={d.label} className="btn btn--ghost btn--sm" onClick={() => handleDemo(d.text)}>
            {d.label}
          </button>
        ))}
      </section>

      {/* ── Input + Controls ── */}
      <div className="playground-input-row">
        <div className="playground-textarea-wrap">
          <label htmlFor="pg-input" className="sr-only">LLM response text</label>
          <textarea
            id="pg-input"
            className="playground-textarea"
            rows={8}
            placeholder="Paste any LLM response here… e.g. &quot;GPT-4 costs $0.03 per 1K tokens…&quot;"
            value={inputText}
            onChange={e => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={loading}
          />
          <span className="playground-textarea__hint">Ctrl+Enter to run</span>
        </div>

        <div className="playground-controls">
          <label htmlFor="pg-model" className="form-label">Model</label>
          <select
            id="pg-model"
            className="form-select"
            value={model}
            onChange={e => setModel(e.target.value)}
            disabled={loading}
          >
            <option value="gpt-4o-mini">GPT-4o mini</option>
            <option value="gpt-4o">GPT-4o</option>
            <option value="claude-3-5-sonnet">Claude 3.5 Sonnet</option>
            <option value="claude-3-haiku">Claude 3 Haiku</option>
            <option value="gemini-1.5-flash">Gemini 1.5 Flash</option>
          </select>

          <button
            className="btn btn--primary btn--lg playground-run-btn"
            onClick={handleCheck}
            disabled={loading || !inputText.trim()}
          >
            {loading ? (
              <><LoadingSpinner size={16} /> Checking…</>
            ) : (
              <>🛡️ Check Freshness</>
            )}
          </button>

          {result && (
            <div className="playground-score-summary">
              <ScoreRing score={result.overallScore} size={72} />
              <div>
                <div className="score-summary__label">Overall Score</div>
                <div className="score-summary__detail">
                  <span style={{ color: 'var(--stale)' }}>{staleClaims.length} stale</span>
                  {' · '}
                  <span style={{ color: 'var(--current)' }}>{currentClaims.length} current</span>
                  {' · '}
                  <span style={{ color: 'var(--unverified)' }}>{unverifiedClaims.length} unverified</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Pipeline animation ── */}
      {Object.keys(pipeline).length > 0 && (
        <div className="pipeline-track">
          {PIPELINE_STEPS.map((step, i) => (
            <React.Fragment key={step.id}>
              <div className={`pipeline-step pipeline-step--${pipeline[step.id] ?? 'idle'}`}>
                <span className="pipeline-step__icon">{step.icon}</span>
                <span className="pipeline-step__label">{step.label}</span>
                {pipeline[step.id] === 'active' && <span className="pipeline-step__spinner" />}
                {pipeline[step.id] === 'done'   && <span className="pipeline-step__check">✓</span>}
              </div>
              {i < PIPELINE_STEPS.length - 1 && (
                <div className={`pipeline-connector ${
                  pipeline[PIPELINE_STEPS[i + 1].id] !== 'idle' ? 'pipeline-connector--lit' : ''
                }`} />
              )}
            </React.Fragment>
          ))}
        </div>
      )}

      {/* ── Error ── */}
      {error && (
        <div className="alert alert--error" role="alert">
          <span>⚠️</span>
          <div>
            <strong>Check failed</strong>
            <p>{error}</p>
          </div>
        </div>
      )}

      {/* ── Results: two-panel layout ── */}
      {result && (
        <div className="playground-results">
          {/* Left: Raw + annotated */}
          <div className="playground-panel">
            <div className="panel-header">
              <span>Raw Answer</span>
              <span className="badge badge--muted">{result.claims.length} claims found</span>
            </div>
            <div className="panel-body">
              <AnnotatedText text={result.originalText} claims={result.claims} />
            </div>
          </div>

          {/* Right: Corrected answer */}
          <div className="playground-panel">
            <div className="panel-header">
              <span>✅ Checked Answer</span>
              {result.staleCount > 0 && (
                <span className="badge badge--stale">Contains stale claims</span>
              )}
            </div>
            <div className="panel-body">
              <AnnotatedText text={result.correctedAnswer || result.originalText} claims={result.claims} />
            </div>
          </div>
        </div>
      )}

      {/* ── Evidence cards ── */}
      {result && result.claims.length > 0 && (
        <section className="evidence-section">
          <h2 className="section-title">
            Claim Evidence
            <span className="badge badge--muted">{result.claims.length} claims</span>
          </h2>
          <div className="evidence-grid">
            {result.claims.map((claim, i) => (
              <EvidenceCard key={i} claim={claim} index={i} />
            ))}
          </div>
        </section>
      )}

      {/* ── Claim type legend ── */}
      {result && (
        <div className="playground-legend">
          <div className="legend-item">
            <span className="legend-dot legend-dot--stale" />
            <span>Stale</span>
          </div>
          <div className="legend-item">
            <span className="legend-dot legend-dot--current" />
            <span>Current</span>
          </div>
          <div className="legend-item">
            <span className="legend-dot legend-dot--unverified" />
            <span>Unverified</span>
          </div>
        </div>
      )}

      <style>{`
        .playground-page { display: flex; flex-direction: column; gap: 1.5rem; padding: 1.5rem; max-width: 1400px; margin: 0 auto; }
        .page-header { display: flex; justify-content: space-between; align-items: flex-start; }
        .page-title { font-size: 1.75rem; font-weight: 700; color: var(--text); margin: 0 0 0.25rem; }
        .page-subtitle { color: var(--muted); margin: 0; }
        .demo-prompts { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
        .demo-prompts__label { color: var(--muted); font-size: 0.85rem; }
        .btn--sm { padding: 0.3rem 0.75rem; font-size: 0.8rem; }
        .btn--ghost { background: transparent; border: 1px solid var(--border); color: var(--text); border-radius: 6px; cursor: pointer; transition: all 0.15s; }
        .btn--ghost:hover { border-color: var(--accent); color: var(--accent); }
        .playground-input-row { display: grid; grid-template-columns: 1fr 220px; gap: 1rem; align-items: start; }
        .playground-textarea-wrap { position: relative; }
        .playground-textarea { width: 100%; background: var(--panel); border: 1px solid var(--border); border-radius: 8px; color: var(--text); font-family: var(--font-mono); font-size: 0.875rem; padding: 0.875rem; resize: vertical; min-height: 180px; outline: none; transition: border-color 0.15s; box-sizing: border-box; }
        .playground-textarea:focus { border-color: var(--accent); }
        .playground-textarea:disabled { opacity: 0.6; }
        .playground-textarea__hint { position: absolute; bottom: 0.5rem; right: 0.75rem; font-size: 0.7rem; color: var(--muted); pointer-events: none; }
        .playground-controls { display: flex; flex-direction: column; gap: 0.75rem; }
        .form-label { font-size: 0.8rem; color: var(--muted); font-weight: 500; }
        .form-select { background: var(--panel); border: 1px solid var(--border); border-radius: 6px; color: var(--text); padding: 0.5rem 0.75rem; font-size: 0.875rem; width: 100%; outline: none; cursor: pointer; }
        .form-select:focus { border-color: var(--accent); }
        .btn--lg { padding: 0.75rem 1.25rem; font-size: 1rem; }
        .playground-run-btn { display: flex; align-items: center; gap: 0.5rem; justify-content: center; }
        .playground-score-summary { display: flex; align-items: center; gap: 0.75rem; padding: 0.75rem; background: var(--panel); border: 1px solid var(--border); border-radius: 8px; }
        .score-summary__label { font-size: 0.75rem; color: var(--muted); }
        .score-summary__detail { font-size: 0.8rem; }
        .pipeline-track { display: flex; align-items: center; gap: 0; background: var(--panel); border: 1px solid var(--border); border-radius: 10px; padding: 1rem 1.5rem; overflow-x: auto; }
        .pipeline-step { display: flex; flex-direction: column; align-items: center; gap: 0.25rem; min-width: 70px; position: relative; transition: all 0.3s; }
        .pipeline-step__icon { font-size: 1.25rem; }
        .pipeline-step__label { font-size: 0.7rem; color: var(--muted); font-weight: 500; letter-spacing: 0.05em; text-transform: uppercase; }
        .pipeline-step--active .pipeline-step__icon { filter: drop-shadow(0 0 6px var(--accent)); }
        .pipeline-step--active .pipeline-step__label { color: var(--accent); }
        .pipeline-step--done .pipeline-step__label { color: var(--current); }
        .pipeline-step__check { position: absolute; top: -6px; right: 4px; font-size: 0.65rem; color: var(--current); }
        .pipeline-step__spinner { width: 6px; height: 6px; border-radius: 50%; background: var(--accent); animation: pulse 0.8s ease-in-out infinite; }
        .pipeline-connector { flex: 1; height: 2px; background: var(--border); min-width: 20px; transition: background 0.3s; }
        .pipeline-connector--lit { background: var(--accent); }
        .alert { display: flex; gap: 0.75rem; align-items: flex-start; padding: 1rem; border-radius: 8px; }
        .alert--error { background: rgba(255, 107, 107, 0.1); border: 1px solid var(--stale); color: var(--stale); }
        .playground-results { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
        .playground-panel { background: var(--panel); border: 1px solid var(--border); border-radius: 10px; overflow: hidden; }
        .panel-header { display: flex; justify-content: space-between; align-items: center; padding: 0.75rem 1rem; border-bottom: 1px solid var(--border); font-size: 0.85rem; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: 0.05em; }
        .panel-body { padding: 1rem; max-height: 400px; overflow-y: auto; }
        .playground-raw-text { margin: 0; line-height: 1.7; color: var(--text); font-size: 0.9rem; white-space: pre-wrap; word-break: break-word; }
        .claim-highlight { border-radius: 3px; padding: 0 2px; cursor: help; }
        .claim-highlight--stale { background: rgba(255, 107, 107, 0.2); border-bottom: 2px solid var(--stale); }
        .claim-highlight--current { background: rgba(74, 222, 128, 0.15); border-bottom: 2px solid var(--current); }
        .claim-highlight--unverified { background: rgba(251, 191, 36, 0.15); border-bottom: 2px solid var(--unverified); }
        .verdict-sup { font-size: 0.6rem; vertical-align: super; margin-left: 1px; font-weight: 700; }
        .verdict-sup--stale { color: var(--stale); }
        .verdict-sup--current { color: var(--current); }
        .verdict-sup--unverified { color: var(--unverified); }
        .evidence-section { display: flex; flex-direction: column; gap: 1rem; }
        .section-title { font-size: 1rem; font-weight: 600; display: flex; align-items: center; gap: 0.75rem; margin: 0; }
        .evidence-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 0.75rem; }
        .evidence-card { border-radius: 10px; overflow: hidden; border: 1px solid var(--border); }
        .evidence-card--stale { border-color: rgba(255, 107, 107, 0.4); }
        .evidence-card--current { border-color: rgba(74, 222, 128, 0.3); }
        .evidence-card--unverified { border-color: rgba(251, 191, 36, 0.3); }
        .evidence-card__header { display: flex; align-items: center; gap: 0.5rem; padding: 0.75rem 1rem; background: var(--panel); border-bottom: 1px solid var(--border); }
        .evidence-card__num { width: 20px; height: 20px; border-radius: 50%; background: var(--border); display: flex; align-items: center; justify-content: center; font-size: 0.65rem; font-weight: 700; flex-shrink: 0; }
        .evidence-card__category { margin-left: auto; font-size: 0.7rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.05em; }
        .evidence-card__claim { padding: 0.75rem 1rem; font-size: 0.875rem; line-height: 1.5; }
        .evidence-card__stale-text { text-decoration: line-through; color: var(--stale); opacity: 0.8; }
        .evidence-card__live-value { margin-left: 0.5rem; color: var(--current); font-weight: 600; }
        .evidence-card__sources { padding: 0 1rem 0.75rem; display: flex; flex-direction: column; gap: 0.25rem; }
        .source-link { font-size: 0.75rem; color: var(--accent); text-decoration: none; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: block; }
        .source-link:hover { text-decoration: underline; }
        .verdict-badge { font-size: 0.7rem; font-weight: 600; padding: 0.2rem 0.5rem; border-radius: 999px; }
        .verdict-badge--stale { background: rgba(255, 107, 107, 0.2); color: var(--stale); }
        .verdict-badge--current { background: rgba(74, 222, 128, 0.15); color: var(--current); }
        .verdict-badge--unverified { background: rgba(251, 191, 36, 0.15); color: var(--unverified); }
        .playground-legend { display: flex; gap: 1.5rem; align-items: center; padding: 0.5rem 0; }
        .legend-item { display: flex; align-items: center; gap: 0.4rem; font-size: 0.8rem; color: var(--muted); }
        .legend-dot { width: 10px; height: 10px; border-radius: 50%; }
        .legend-dot--stale { background: var(--stale); }
        .legend-dot--current { background: var(--current); }
        .legend-dot--unverified { background: var(--unverified); }
        .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); border: 0; }
        @media (max-width: 900px) {
          .playground-input-row { grid-template-columns: 1fr; }
          .playground-results { grid-template-columns: 1fr; }
        }
        @keyframes pulse { 0%,100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.5; transform: scale(0.8); } }
      `}</style>
    </div>
  );
}

