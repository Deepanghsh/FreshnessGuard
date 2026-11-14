import React, { useState, useRef, useCallback, useEffect } from 'react';
import { api } from '../api/client';
import { useSSE } from '../hooks/useSSE';
import { useClipboard } from '../hooks/useClipboard';
import type { ResponseDoc, Mode, SSEEvent } from '../types';
import ScoreRing from '../components/ScoreRing';
import ClaimBadge from '../components/ClaimBadge';
import SummaryBadge from '../components/SummaryBadge';
import LoadingSpinner from '../components/LoadingSpinner';
import {
  ExternalLink, Copy, Check, Play, RefreshCw, AlertCircle,
  HelpCircle, ShieldCheck, Zap, Radio
} from 'lucide-react';

// ── Demo prompts with actual factual verification test cases ─────────────────
const DEMO_PROMPTS = [
  {
    label: '💰 GPT-4 Pricing (Stale vs Live)',
    text: 'GPT-4 API pricing is $0.03 per 1K input tokens and $0.06 per 1K output tokens. It was released in March 2023.',
  },
  {
    label: '📦 React Version (Stale 18.2 vs 19)',
    text: 'The latest stable version of React is 18.2.0, released in June 2022. React hooks were introduced in 16.8.',
  },
  {
    label: '👔 Twitter / X CEO (Stale vs Live)',
    text: 'Elon Musk is the current CEO of Twitter (now X). The company was founded in 2006.',
  },
  {
    label: '⚖️ GDPR Fine (Current Law)',
    text: 'Under GDPR, the maximum fine is €20 million or 4% of annual global turnover, whichever is higher.',
  },
  {
    label: '✅ Fully Fresh Fact',
    text: 'Python 3.12 was released in October 2023. Python was created by Guido van Rossum in 1991.',
  },
];

const MODES: Array<{ id: Mode; label: string; desc: string }> = [
  { id: 'inline',  label: 'Inline',  desc: 'Blocks until claims are verified via Tavily (default gateway behavior)' },
  { id: 'async',   label: 'Async',   desc: 'Returns 202 immediately; verification streams live via SSE' },
  { id: 'basic',   label: 'Basic',   desc: 'Fast local heuristic & regex scoring (zero external network calls)' },
  { id: 'bypass',  label: 'Bypass',  desc: 'Completely skips FreshnessGuard processing (score 1.0)' },
];

export default function Playground() {
  const [inputText, setInputText]     = useState('');
  const [model, setModel]             = useState('gpt-4o-mini');
  const [mode, setMode]               = useState<Mode>('inline');
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState<string | null>(null);
  const [result, setResult]           = useState<ResponseDoc | null>(null);
  const [isAsyncWaiting, setIsAsyncWaiting] = useState(false);
  const { copied, copy }              = useClipboard();

  // Listen to SSE updates for async verification completion
  const { connected } = useSSE(useCallback((event: SSEEvent) => {
    if (event.type === 'response_updated' && result) {
      if (event._id === result._id || event.requestId === result.requestId) {
        setIsAsyncWaiting(false);
        // Refresh this document from backend
        api.getResponse(result._id).then(updated => {
          setResult(updated);
        }).catch(() => {});
      }
    }
  }, [result]));

  const handleCheck = useCallback(async () => {
    if (!inputText.trim()) return;
    setError(null);
    setResult(null);
    setLoading(true);
    setIsAsyncWaiting(false);

    try {
      const data = await api.postCheck(inputText.trim(), model, mode);
      setResult(data);
      if (mode === 'async') {
        setIsAsyncWaiting(true);
      }
    } catch (e: unknown) {
      if (e instanceof Error) {
        setError(e.message || 'Something went wrong');
      } else {
        setError('An unexpected error occurred');
      }
    } finally {
      setLoading(false);
    }
  }, [inputText, model, mode]);

  const handleDemo = (promptText: string) => {
    setInputText(promptText);
    setResult(null);
    setError(null);
    setIsAsyncWaiting(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') handleCheck();
  };

  const staleClaims      = result?.claims.filter(c => c.verdict === 'stale')      ?? [];
  const currentClaims    = result?.claims.filter(c => c.verdict === 'current')    ?? [];
  const unverifiedClaims = result?.claims.filter(c => c.verdict === 'unverified') ?? [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', maxWidth: 1200 }} className="animate-fade-in">
      {/* ── Header ── */}
      <div>
        <h1 style={{ marginBottom: 4 }}>Playground</h1>
        <p style={{ fontSize: '0.875rem', color: 'var(--muted)', margin: 0 }}>
          Test any AI response across Inline, Async, Basic, and Bypass modes with live Tavily verification.
        </p>
      </div>

      {/* ── Demo Prompts ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: '0.75rem', color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          Load Test Prompt:
        </span>
        {DEMO_PROMPTS.map(d => (
          <button
            key={d.label}
            className="btn btn-secondary"
            style={{ fontSize: '0.75rem', padding: '4px 10px' }}
            onClick={() => handleDemo(d.text)}
          >
            {d.label}
          </button>
        ))}
      </div>

      {/* ── Main Input & Controls Panel ── */}
      <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem' }}>
          {/* Mode Selector */}
          <div>
            <label htmlFor="pg-mode" style={{ fontWeight: 600 }}>Verification Mode</label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 6, marginTop: 4 }}>
              {MODES.map(m => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setMode(m.id)}
                  style={{
                    padding: '8px 10px',
                    borderRadius: 6,
                    border: `1px solid ${mode === m.id ? 'var(--accent)' : 'var(--border)'}`,
                    background: mode === m.id ? 'var(--accent-dim)' : 'transparent',
                    color: mode === m.id ? 'var(--accent)' : 'var(--muted)',
                    textAlign: 'left',
                    fontSize: '0.8125rem',
                    fontWeight: mode === m.id ? 700 : 500,
                  }}
                  title={m.desc}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span>{m.label}</span>
                    {mode === m.id && <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)' }} />}
                  </div>
                </button>
              ))}
            </div>
            <p style={{ fontSize: '0.75rem', color: 'var(--muted)', marginTop: 6, marginBottom: 0 }}>
              {MODES.find(m => m.id === mode)?.desc}
            </p>
          </div>

          {/* Model Selector */}
          <div>
            <label htmlFor="pg-model" style={{ fontWeight: 600 }}>Model Attribution</label>
            <select
              id="pg-model"
              value={model}
              onChange={e => setModel(e.target.value)}
              disabled={loading}
              style={{ marginTop: 4 }}
            >
              <option value="gpt-4o-mini">gpt-4o-mini (OpenAI)</option>
              <option value="gpt-4o">gpt-4o (OpenAI)</option>
              <option value="claude-3-5-sonnet">claude-3-5-sonnet (Anthropic)</option>
              <option value="gemini-1.5-pro">gemini-1.5-pro (Google)</option>
              <option value="llama-3.1-70b">llama-3.1-70b (Meta)</option>
            </select>
            <p style={{ fontSize: '0.75rem', color: 'var(--muted)', marginTop: 6, marginBottom: 0 }}>
              Simulates model tag passed by Bifrost Gateway request context.
            </p>
          </div>
        </div>

        {/* Text Area */}
        <div>
          <label htmlFor="pg-input" style={{ fontWeight: 600 }}>AI Response Text to Verify</label>
          <textarea
            id="pg-input"
            rows={5}
            placeholder="Paste any AI-generated response containing prices, versions, leadership, dates, or factual claims…"
            value={inputText}
            onChange={e => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={loading}
            style={{ width: '100%', resize: 'vertical', marginTop: 4 }}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>
              Tip: Press <kbd style={{ background: 'var(--border)', padding: '1px 5px', borderRadius: 3 }}>Ctrl</kbd> + <kbd style={{ background: 'var(--border)', padding: '1px 5px', borderRadius: 3 }}>Enter</kbd> to run
            </span>
            <button
              className="btn btn-primary"
              onClick={handleCheck}
              disabled={loading || !inputText.trim()}
              style={{ padding: '8px 20px', fontSize: '0.9375rem' }}
            >
              {loading ? (
                <><LoadingSpinner size={16} /> Verifying…</>
              ) : (
                <><Play size={15} fill="currentColor" /> Check Freshness</>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* ── Error Banner ── */}
      {error && (
        <div
          style={{
            background: 'var(--stale-dim)',
            border: '1px solid var(--stale)',
            borderRadius: 6,
            padding: '12px 16px',
            color: 'var(--text)',
            fontSize: '0.875rem',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}
          role="alert"
        >
          <AlertCircle size={18} color="var(--stale)" />
          <span><strong>Verification Error:</strong> {error}</span>
        </div>
      )}

      {/* ── Async Waiting Banner ── */}
      {isAsyncWaiting && (
        <div
          style={{
            background: 'rgba(251, 191, 36, 0.1)',
            border: '1px solid var(--unverified)',
            borderRadius: 6,
            padding: '12px 16px',
            color: 'var(--text)',
            fontSize: '0.875rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Radio size={16} color="var(--unverified)" style={{ animation: 'pulse 1.5s infinite' }} />
            <span>
              <strong>Async Mode Active:</strong> Response accepted (HTTP 202). Background verification is streaming results via SSE...
            </span>
          </div>
          <span className="badge badge-unverified">Processing</span>
        </div>
      )}

      {/* ── Results View ── */}
      {result && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }} className="animate-fade-in">

          {/* Results Summary Bar */}
          <div className="panel" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <ScoreRing score={result.overallScore} size={70} strokeWidth={5.5} />
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <h2 style={{ fontSize: '1.25rem', margin: 0 }}>
                    {Math.round(result.overallScore * 100)}% Freshness Score
                  </h2>
                  <SummaryBadge
                    status={result.summaryStatus ?? (result.totalClaims === 0 ? 'no_claims' : result.staleCount > 0 ? 'stale_detected' : 'all_fresh')}
                    message={result.summaryMessage}
                  />
                </div>
                <div style={{ fontSize: '0.8125rem', color: 'var(--muted)' }}>
                  {result.totalClaims === 0 ? (
                    'No claims requiring verification were extracted from this response.'
                  ) : (
                    <span>
                      Detected <strong>{result.totalClaims}</strong> time-sensitive claim{result.totalClaims > 1 ? 's' : ''} (
                      <span style={{ color: 'var(--stale)' }}>{staleClaims.length} stale</span>,{' '}
                      <span style={{ color: 'var(--current)' }}>{currentClaims.length} current</span>,{' '}
                      <span style={{ color: 'var(--unverified)' }}>{unverifiedClaims.length} unverified</span>)
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 12 }}>
              {result.overallConfidence !== undefined && (
                <div style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 12px', textAlign: 'center' }}>
                  <div style={{ fontSize: '0.625rem', color: 'var(--muted)', textTransform: 'uppercase' }}>Confidence</div>
                  <div style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}>
                    {(result.overallConfidence * 100).toFixed(0)}%
                  </div>
                </div>
              )}
              <div style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 12px', textAlign: 'center' }}>
                <div style={{ fontSize: '0.625rem', color: 'var(--muted)', textTransform: 'uppercase' }}>Latency</div>
                <div style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>
                  {result.processingMs}ms
                </div>
              </div>
            </div>
          </div>

          {/* Corrected Answer Box (if stale claims exist) */}
          {result.correctedAnswer && (
            <div className="panel" style={{ borderLeft: '3px solid var(--current)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <h3 style={{ fontSize: '0.9375rem', color: 'var(--current)', margin: 0 }}>
                  🛡️ Live Corrected AI Response
                </h3>
                <button
                  className="btn btn-secondary"
                  onClick={() => copy(result.correctedAnswer!)}
                  style={{ padding: '3px 8px', fontSize: '0.75rem' }}
                >
                  {copied ? <Check size={12} /> : <Copy size={12} />}
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
              <p style={{ margin: 0, whiteSpace: 'pre-wrap', lineHeight: 1.6, fontSize: '0.9375rem' }}>
                {result.correctedAnswer}
              </p>
            </div>
          )}

          {/* Extracted Claims Evidence List */}
          <div>
            <h3 style={{ fontSize: '1rem', marginBottom: 12 }}>
              Extracted Claims &amp; Evidence ({result.claims.length})
            </h3>
            {result.claims.length === 0 ? (
              <div className="panel" style={{ textAlign: 'center', padding: '1.5rem', color: 'var(--muted)' }}>
                No time-sensitive claims extracted.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {result.claims.map((claim, idx) => (
                  <div
                    key={claim.id || idx}
                    className="panel panel-sm"
                    style={{
                      borderLeft: `3px solid ${
                        claim.verdict === 'current'
                          ? 'var(--current)'
                          : claim.verdict === 'stale'
                          ? 'var(--stale)'
                          : 'var(--unverified)'
                      }`,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 8,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span className="badge badge-muted">{claim.category}</span>
                        <ClaimBadge verdict={claim.verdict ?? 'unverified'} />
                        <span style={{ fontSize: '0.875rem', fontWeight: 600 }}>{claim.text}</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        {claim.confidence !== undefined && (
                          <span style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>
                            conf: <strong style={{ color: 'var(--accent)' }}>{(claim.confidence * 100).toFixed(0)}%</strong>
                          </span>
                        )}
                        {claim.score !== undefined && (
                          <span style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>
                            freshness: <strong>{(claim.score * 100).toFixed(0)}%</strong>
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Stale Replacement */}
                    {claim.verdict === 'stale' && claim.liveValue && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.8125rem' }}>
                        <span style={{ color: 'var(--muted)' }}>Stale Value:</span>
                        <s style={{ color: 'var(--stale)' }}>{claim.extractedValue}</s>
                        <span>→</span>
                        <strong style={{ color: 'var(--current)' }}>{claim.liveValue}</strong>
                      </div>
                    )}

                    {/* Sources */}
                    {claim.sources && claim.sources.length > 0 && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
                        {claim.sources.map((s, sIdx) => (
                          <div key={sIdx} style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>
                            <a
                              href={s.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{ color: 'var(--accent)', textDecoration: 'none', fontWeight: 500 }}
                            >
                              🔗 {s.title || s.domain || s.url}
                            </a>
                            {s.publishedDate && <span style={{ marginLeft: 6 }}>({new Date(s.publishedDate).toLocaleDateString()})</span>}
                            {s.content && <p style={{ margin: '2px 0 0', fontStyle: 'italic', color: 'var(--dim)' }}>"{s.content}"</p>}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
