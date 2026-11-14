import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Copy, Check, RefreshCw, ExternalLink, Clock,
  Database, Cpu, ShieldCheck, AlertTriangle, HelpCircle, CheckCircle2
} from 'lucide-react';
import { api } from '../api/client';
import { useClipboard } from '../hooks/useClipboard';
import { useToast } from '../components/Layout';
import ScoreRing from '../components/ScoreRing';
import ClaimBadge from '../components/ClaimBadge';
import SummaryBadge from '../components/SummaryBadge';
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
          borderBottom: `2px solid ${VERDICT_COLOR[s.verdict]}`,
          color: 'inherit',
          borderRadius: 2,
          padding: '0 2px',
        }}
        title={`Claim ${s.claimIdx}: ${s.verdict}`}
      >
        {text.slice(s.start, s.end)}
        <sup style={{ fontSize: '0.65em', color: VERDICT_COLOR[s.verdict], marginLeft: 2, fontWeight: 700 }}>
          [{s.claimIdx}]
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
      style={{
        borderLeft: `3px solid ${color}`,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      {/* Header: Claim index, category, verdict badge, freshness score, and verification confidence */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            width: 24, height: 24, borderRadius: '50%',
            background: color, color: '#000',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '0.75rem', fontWeight: 800, flexShrink: 0,
          }}>
            {index}
          </span>
          <div>
            <span className="badge badge-muted" style={{ marginRight: 6 }}>{claim.category}</span>
            <ClaimBadge verdict={verdict} />
          </div>
        </div>

        {/* Distinct Scores: Freshness Score vs Verification Confidence */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          {claim.confidence !== undefined && (
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '0.625rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Confidence
              </div>
              <span style={{ fontSize: '0.8125rem', fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--accent)' }}>
                {(claim.confidence * 100).toFixed(0)}%
              </span>
            </div>
          )}

          {claim.score !== undefined && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '0.625rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Freshness
                </div>
                <span style={{ fontSize: '0.8125rem', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                  {(claim.score * 100).toFixed(0)}%
                </span>
              </div>
              <ScoreRing score={claim.score} size={36} strokeWidth={3.5} label={`Claim ${index} freshness score`} />
            </div>
          )}
        </div>
      </div>

      {/* Claim statement */}
      <div style={{ background: 'rgba(0,0,0,0.25)', padding: '8px 12px', borderRadius: 4, border: '1px solid var(--border)' }}>
        <div style={{ fontSize: '0.6875rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 2 }}>
          Claim Text
        </div>
        <p style={{ margin: 0, color: 'var(--text)', fontSize: '0.875rem' }}>{claim.text}</p>
      </div>

      {/* Extracted value vs Live Value comparison */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
        <div>
          <div style={{ fontSize: '0.6875rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
            Extracted Value
          </div>
          <code style={{ color: verdict === 'stale' ? 'var(--stale)' : 'var(--text)', fontSize: '0.875rem' }}>
            {claim.extractedValue}
          </code>
        </div>

        {verdict === 'stale' && (
          <div>
            <div style={{ fontSize: '0.6875rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
              Current Live Value (Tavily Verified)
            </div>
            <code style={{ color: 'var(--current)', fontWeight: 700, fontSize: '0.875rem' }}>
              {claim.liveValue ?? 'Verified outdated by search evidence'}
            </code>
          </div>
        )}
      </div>

      {/* Supporting Sources & Excerpts */}
      {claim.sources && claim.sources.length > 0 && (
        <div>
          <div style={{ fontSize: '0.6875rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
            Corroborating Evidence ({claim.sources.length} source{claim.sources.length > 1 ? 's' : ''})
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {claim.sources.map((s, i) => (
              <div
                key={i}
                style={{
                  background: 'rgba(255,255,255,0.02)',
                  border: '1px solid var(--border)',
                  borderRadius: 4,
                  padding: '8px 12px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      fontSize: '0.8125rem',
                      fontWeight: 600,
                      color: 'var(--accent)',
                    }}
                  >
                    <ExternalLink size={12} aria-hidden="true" style={{ flexShrink: 0 }} />
                    <span className="truncate">{s.title || s.domain || s.url}</span>
                  </a>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    {s.isOfficial && <span className="badge badge-accent" style={{ fontSize: '0.55rem', padding: '1px 5px' }}>official domain</span>}
                    {s.score !== undefined && (
                      <span style={{ fontSize: '0.6875rem', color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
                        rel: {(s.score * 100).toFixed(0)}%
                      </span>
                    )}
                    {s.publishedDate && (
                      <span style={{ fontSize: '0.6875rem', color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                        📅 {new Date(s.publishedDate).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                </div>
                {s.content && (
                  <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--muted)', lineHeight: 1.5 }}>
                    "{s.content}"
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Inspector Page ───────────────────────────────────────────────────────
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
      .then(d => {
        setDoc(d);
        setNotFound(false);
      })
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

  if (loading) return <LoadingSpinner label="Loading response details" />;

  if (notFound) {
    return (
      <div className="panel animate-fade-in" style={{ padding: '3rem 2rem', textAlign: 'center', maxWidth: 600, margin: '2rem auto' }}>
        <HelpCircle size={40} color="var(--muted)" style={{ margin: '0 auto 1rem' }} />
        <h2 style={{ marginBottom: '0.5rem' }}>Response Not Found</h2>
        <p style={{ marginBottom: '1.5rem', color: 'var(--muted)' }}>
          The requested verification record either expired, was removed, or the ID is invalid.
        </p>
        <button className="btn btn-primary" onClick={() => navigate('/')}>
          <ArrowLeft size={14} /> Return to Overview
        </button>
      </div>
    );
  }

  if (!doc) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', maxWidth: 1000 }} className="animate-fade-in">

      {/* ── Top Bar ─────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
        <button className="btn btn-secondary" onClick={() => navigate(-1)} aria-label="Go back">
          <ArrowLeft size={14} aria-hidden="true" /> Back
        </button>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn btn-secondary" onClick={handleVerify} disabled={verifying}>
            <RefreshCw size={14} style={verifying ? { animation: 'spin 0.75s linear infinite' } : {}} aria-hidden="true" />
            {verifying ? 'Re-verifying…' : 'Re-verify with Tavily'}
          </button>
          {doc.staleCount > 0 && (
            <button className="btn btn-primary" onClick={handleCopyCorrected} aria-live="polite">
              {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
              {copied ? 'Copied Corrected!' : 'Copy Corrected Answer'}
            </button>
          )}
        </div>
      </div>

      {/* ── Summary & Score Header ──────────────────────────────────────────── */}
      <div className="panel" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1.5rem', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
          <ScoreRing score={doc.overallScore} size={76} strokeWidth={6} label="Overall freshness score" />
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <h1 style={{ fontSize: '1.25rem', margin: 0 }}>
                {Math.round(doc.overallScore * 100)}% Freshness Score
              </h1>
              <SummaryBadge
                status={doc.summaryStatus ?? (doc.totalClaims === 0 ? 'no_claims' : doc.staleCount > 0 ? 'stale_detected' : 'all_fresh')}
                message={doc.summaryMessage}
                size="md"
              />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: '0.8125rem', color: 'var(--muted)' }}>
              <span>Model: <strong style={{ color: 'var(--text)' }}>{doc.model}</strong></span>
              <span>•</span>
              <span>Mode: <strong style={{ color: 'var(--accent)' }}>{doc.mode}</strong></span>
              <span>•</span>
              <span>Checked: {new Date(doc.checkedAt).toLocaleString()}</span>
            </div>
          </div>
        </div>

        {/* Confidence & Telemetry Pills */}
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {doc.overallConfidence !== undefined && (
            <div style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid var(--border)', borderRadius: 6, padding: '8px 14px', textAlign: 'center' }}>
              <div style={{ fontSize: '0.6875rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Confidence</div>
              <div style={{ fontSize: '1.125rem', fontWeight: 700, color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}>
                {(doc.overallConfidence * 100).toFixed(0)}%
              </div>
            </div>
          )}
          <div style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid var(--border)', borderRadius: 6, padding: '8px 14px', textAlign: 'center' }}>
            <div style={{ fontSize: '0.6875rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Latency</div>
            <div style={{ fontSize: '1.125rem', fontWeight: 700, color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>
              {doc.processingMs}ms
            </div>
          </div>
          <div style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid var(--border)', borderRadius: 6, padding: '8px 14px', textAlign: 'center' }}>
            <div style={{ fontSize: '0.6875rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Stale Claims</div>
            <div style={{ fontSize: '1.125rem', fontWeight: 700, color: doc.staleCount > 0 ? 'var(--stale)' : 'var(--current)', fontFamily: 'var(--font-mono)' }}>
              {doc.staleCount} / {doc.totalClaims}
            </div>
          </div>
        </div>
      </div>

      {/* ── Annotated AI Response ────────────────────────────────────────────── */}
      <div className="panel">
        <h2 style={{ fontSize: '0.9375rem', marginBottom: '0.75rem' }}>AI Response Text (Annotated Claims)</h2>
        <div style={{ background: 'rgba(0,0,0,0.2)', padding: '1rem', borderRadius: 6, border: '1px solid var(--border)' }}>
          <AnnotatedText text={doc.originalText} claims={doc.claims} />
        </div>
      </div>

      {/* ── Corrected Answer (if stale claims found) ─────────────────────────── */}
      {doc.correctedAnswer && (
        <div className="panel" style={{ borderLeft: '3px solid var(--current)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
            <h2 style={{ fontSize: '0.9375rem', color: 'var(--current)', margin: 0 }}>
              Live Corrected Answer (Tavily Corroborated)
            </h2>
            <button className="btn btn-secondary" onClick={handleCopyCorrected} style={{ padding: '3px 8px', fontSize: '0.75rem' }}>
              {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <div style={{ background: 'rgba(74, 222, 128, 0.05)', padding: '1rem', borderRadius: 6, border: '1px solid rgba(74, 222, 128, 0.2)' }}>
            <p style={{ margin: 0, color: 'var(--text)', whiteSpace: 'pre-wrap', lineHeight: 1.7, fontSize: '0.9375rem' }}>
              {doc.correctedAnswer}
            </p>
          </div>
        </div>
      )}

      {/* ── Detailed Evidence Breakdown ─────────────────────────────────────── */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
          <h2 style={{ fontSize: '1rem' }}>Extracted Claim Evidence Breakdown</h2>
          <span style={{ fontSize: '0.8125rem', color: 'var(--muted)' }}>
            {doc.claims.length} claim{doc.claims.length === 1 ? '' : 's'} extracted
          </span>
        </div>

        {doc.claims.length === 0 ? (
          <div className="panel" style={{ textAlign: 'center', padding: '2rem', color: 'var(--muted)' }}>
            <CheckCircle2 size={32} color="var(--current)" style={{ margin: '0 auto 0.75rem' }} />
            <p style={{ margin: 0 }}>No time-sensitive factual claims were detected in this response.</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {doc.claims.map((c, i) => (
              <EvidenceCard key={c.id || i} claim={c} index={i + 1} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
