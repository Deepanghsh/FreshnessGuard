import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Copy, Check, RefreshCw, ExternalLink, Clock, Database, Cpu } from 'lucide-react';
import { api } from '../api/client';
import { useClipboard } from '../hooks/useClipboard';
import { useToast } from '../components/Layout';
import ScoreRing from '../components/ScoreRing';
import ClaimBadge from '../components/ClaimBadge';
import LoadingSpinner from '../components/LoadingSpinner';
import type { ResponseDoc, Claim, Verdict } from '../types';

// ─── Verdict colors ───────────────────────────────────────────────────────────
const VERDICT_COLOR: Record<Verdict, string> = {
  current:    'var(--current)',
  stale:      'var(--stale)',
  unverified: 'var(--unverified)',
};

// ─── Annotate plain text with claim superscripts ──────────────────────────────
function AnnotatedText({ text, claims }: { text: string; claims: Claim[] }) {
  // Sort claims by position in text
  interface Span { start: number; end: number; claimIdx: number; verdict: Verdict; }
  const spans: Span[] = [];

  claims.forEach((c, idx) => {
    if (!c.text || !c.verdict) return;
    const pos = text.indexOf(c.text);
    if (pos !== -1) {
      spans.push({ start: pos, end: pos + c.text.length, claimIdx: idx + 1, verdict: c.verdict });
    }
  });
  spans.sort((a, b) => a.start - b.start);

  const parts: React.ReactNode[] = [];
  let cursor = 0;
  spans.forEach((s, i) => {
    if (s.start > cursor) parts.push(<span key={`t${i}`}>{text.slice(cursor, s.start)}</span>);
    parts.push(
      <mark
        key={`m${i}`}
        style={{
          background: `${VERDICT_COLOR[s.verdict]}22`,
          borderBottom: `1.5px solid ${VERDICT_COLOR[s.verdict]}`,
          color: 'inherit',
          borderRadius: 2,
          padding: '0 1px',
        }}
        title={`Claim ${s.claimIdx}: ${s.verdict}`}
      >
        {text.slice(s.start, s.end)}
        <sup style={{ fontSize: '0.6em', color: VERDICT_COLOR[s.verdict], marginLeft: 1, fontWeight: 700 }}>
          {s.claimIdx}
        </sup>
      </mark>
    );
    cursor = s.end;
  });
  if (cursor < text.length) parts.push(<span key="last">{text.slice(cursor)}</span>);

  return (
    <p style={{
      lineHeight: 1.8, fontSize: '0.9375rem',
      fontFamily: 'var(--font-body)', color: 'var(--text)',
      whiteSpace: 'pre-wrap', wordBreak: 'break-word',
    }}>
      {parts}
    </p>
  );
}

// ─── Evidence card for one claim ─────────────────────────────────────────────
function EvidenceCard({ claim, index }: { claim: Claim; index: number }) {
  const verdict = claim.verdict ?? 'unverified';
  const color   = VERDICT_COLOR[verdict];

  return (
    <div
      className="panel panel-sm animate-fade-in"
      style={{ borderLeft: `3px solid ${color}` }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            width: 22, height: 22, borderRadius: '50%',
            background: color, color: '#000',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '0.6875rem', fontWeight: 700, flexShrink: 0,
          }}>
            {index}
          </span>
          <div>
            <span className={`badge badge-muted`} style={{ marginRight: 6 }}>{claim.category}</span>
            <ClaimBadge verdict={verdict} />
          </div>
        </div>
        {claim.score !== undefined && (
          <ScoreRing score={claim.score} size={40} strokeWidth={4} label={`Claim ${index} score`} />
        )}
      </div>

      {/* Extracted value */}
      <div style={{ marginTop: 10 }}>
        <div style={{ fontSize: '0.6875rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
          Extracted value
        </div>
        <code style={{ color: 'var(--accent)', fontSize: '0.875rem' }}>{claim.extractedValue}</code>
      </div>

      {/* Stale correction */}
      {verdict === 'stale' && claim.liveValue && (
        <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <s style={{ color: 'var(--stale)', fontSize: '0.875rem', fontFamily: 'var(--font-mono)' }}>
            {claim.extractedValue}
          </s>
          <span style={{ color: 'var(--muted)' }}>→</span>
          <span style={{ color: 'var(--current)', fontWeight: 600, fontFamily: 'var(--font-mono)', fontSize: '0.875rem' }}>
            {claim.liveValue}
          </span>
        </div>
      )}

      {/* Sources */}
      {claim.sources && claim.sources.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: '0.6875rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
            Sources
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {claim.sources.slice(0, 3).map((s, i) => (
              <a
                key={i}
                href={s.url}
                target="_blank"
                rel="noopener noreferrer"
                style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.75rem', color: 'var(--accent)', overflow: 'hidden' }}
              >
                <ExternalLink size={11} aria-hidden="true" style={{ flexShrink: 0 }} />
                <span className="truncate">{s.domain ?? s.url}</span>
                {s.isOfficial && <span className="badge badge-accent" style={{ fontSize: '0.5rem', padding: '1px 5px' }}>official</span>}
                {s.publishedDate && (
                  <span style={{ color: 'var(--muted)', flexShrink: 0 }}>
                    {new Date(s.publishedDate).toLocaleDateString()}
                  </span>
                )}
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function Inspector() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { showError } = useToast();
  const { copied, copy } = useClipboard();
  const [doc, setDoc]           = useState<ResponseDoc | null>(null);
  const [loading, setLoading]   = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [verifying, setVerifying] = useState(false);

  const load = useCallback(() => {
    if (!id || id === 'x') { setNotFound(true); setLoading(false); return; }
    setLoading(true);
    api.getResponse(id)
      .then(setDoc)
      .catch(e => {
        if ((e as { status?: number }).status === 404) setNotFound(true);
        else showError((e as Error).message);
      })
      .finally(() => setLoading(false));
  }, [id, showError]);

  useEffect(() => { load(); }, [load]);

  const handleVerify = async () => {
    if (!id || !doc) return;
    setVerifying(true);
    try {
      const updated = await api.postVerify(id);
      setDoc(updated);
    } catch (e) {
      showError((e as Error).message);
    } finally {
      setVerifying(false);
    }
  };

  const handleCopyCorrected = () => {
    if (!doc) return;
    const text = doc.correctedAnswer ?? doc.originalText;
    copy(text);
  };

  if (loading) return <LoadingSpinner label="Loading response" />;

  if (notFound) return (
    <div className="animate-fade-in" style={{ padding: '2rem', textAlign: 'center' }}>
      <h2>Response not found</h2>
      <p style={{ margin: '1rem 0' }}>This response may have expired or the ID is invalid.</p>
      <button className="btn btn-secondary" onClick={() => navigate('/')}>
        <ArrowLeft size={14} /> Back to Overview
      </button>
    </div>
  );

  if (!doc) return null;

  const headers = {
    'X-FreshnessGuard-Score':   doc.overallScore.toFixed(3),
    'X-FreshnessGuard-Stale':   String(doc.staleCount),
    'X-FreshnessGuard-Latency': `${doc.processingMs}ms`,
    'X-FreshnessGuard-Mode':    doc.mode,
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', maxWidth: 960 }} className="animate-fade-in">

      {/* ── Back + actions ─────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
        <button className="btn btn-secondary" onClick={() => navigate(-1)} aria-label="Go back">
          <ArrowLeft size={14} aria-hidden="true" /> Back
        </button>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn btn-secondary" onClick={handleVerify} disabled={verifying}>
            <RefreshCw size={14} style={verifying ? { animation: 'spin 0.75s linear infinite' } : {}} aria-hidden="true" />
            {verifying ? 'Re-verifying…' : 'Re-verify'}
          </button>
          <button className="btn btn-primary" onClick={handleCopyCorrected} aria-live="polite">
            {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
            {copied ? 'Copied!' : 'Copy corrected answer'}
          </button>
        </div>
      </div>

      {/* ── Score header ───────────────────────────────────────────────────── */}
      <div className="panel" style={{ display: 'flex', alignItems: 'center', gap: '1.5rem', flexWrap: 'wrap' }}>
        <ScoreRing score={doc.overallScore} size={110} strokeWidth={8} label="Overall freshness score" />
        <div style={{ flex: 1, minWidth: 200 }}>
          <h1 style={{ marginBottom: 6, fontSize: '1.375rem' }}>Response Freshness</h1>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
            <code style={{ background: 'var(--accent-dim)', color: 'var(--accent)', padding: '2px 8px', borderRadius: 4, fontSize: '0.8125rem' }}>
              {doc.model}
            </code>
            <span className={`badge ${doc.staleCount > 0 ? 'badge-stale' : 'badge-current'}`}>
              {doc.staleCount} stale / {doc.totalClaims} claims
            </span>
            <span className="badge badge-muted">{doc.mode} mode</span>
            {doc.fromLLM && <span className="badge badge-accent">LLM extracted</span>}
          </div>
          <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: '0.75rem', color: 'var(--muted)' }}>
              <Clock size={12} aria-hidden="true" />
              {new Date(doc.checkedAt).toLocaleString()}
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: '0.75rem', color: 'var(--muted)' }}>
              <Cpu size={12} aria-hidden="true" />
              {doc.processingMs}ms processing
            </span>
            {doc.fromCache && (
              <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: '0.75rem', color: 'var(--accent)' }}>
                <Database size={12} aria-hidden="true" />
                Cache hit
              </span>
            )}
          </div>
        </div>
      </div>

      {/* ── Annotated text ─────────────────────────────────────────────────── */}
      <div className="panel">
        <h2 style={{ marginBottom: '1rem', fontSize: '0.9375rem' }}>Model Answer</h2>
        <AnnotatedText text={doc.originalText} claims={doc.claims} />
      </div>

      {/* ── Evidence cards ─────────────────────────────────────────────────── */}
      {doc.claims.length > 0 && (
        <section aria-label="Claim evidence">
          <h2 style={{ marginBottom: '0.875rem', fontSize: '0.9375rem' }}>
            Claim Evidence ({doc.claims.length})
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
            {doc.claims.map((c, i) => (
              <EvidenceCard key={c.id} claim={c} index={i + 1} />
            ))}
          </div>
        </section>
      )}

      {/* ── Injected headers ───────────────────────────────────────────────── */}
      <div className="panel">
        <h2 style={{ marginBottom: '0.875rem', fontSize: '0.9375rem' }}>Injected Response Headers</h2>
        <div className="code-block">
          {Object.entries(headers).map(([k, v]) => (
            <div key={k}>
              <span style={{ color: 'var(--accent)' }}>{k}</span>
              <span style={{ color: 'var(--muted)' }}>: </span>
              <span style={{ color: 'var(--text)' }}>{v}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Corrected answer ───────────────────────────────────────────────── */}
      {doc.correctedAnswer && doc.correctedAnswer !== doc.originalText && (
        <div className="panel" style={{ borderColor: 'var(--current)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.875rem' }}>
            <h2 style={{ fontSize: '0.9375rem', color: 'var(--current)' }}>Corrected Answer</h2>
            <button className="btn btn-secondary" onClick={handleCopyCorrected} style={{ fontSize: '0.75rem' }}>
              {copied ? <Check size={12} /> : <Copy size={12} />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <p style={{ lineHeight: 1.8, fontSize: '0.9375rem', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {doc.correctedAnswer}
          </p>
        </div>
      )}
    </div>
  );
}

