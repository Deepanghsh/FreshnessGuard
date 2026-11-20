import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import {
  ArrowLeft, Copy, Check, RefreshCw, ExternalLink, Clock,
  ShieldCheck, AlertTriangle, HelpCircle, CheckCircle2,
  Search, Play, ChevronDown, ChevronUp, Info, Sparkles, Filter,
  Network, FileText, Database, ShieldAlert, Globe, Cpu, Layers,
  Download, Code, CheckSquare, Eye, EyeOff, Hash
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
  false:      'var(--stale)',
  unverified: 'var(--unverified)',
};

// ─── Annotate plain text with interactive claim markers ──────────────────────
function AnnotatedText({
  text,
  claims,
  selectedClaimId,
  onClaimClick,
}: {
  text: string;
  claims: Claim[];
  selectedClaimId: string | null;
  onClaimClick?: (claimId: string, idx: number) => void;
}) {
  interface Span { start: number; end: number; claimId: string; claimIdx: number; verdict: Verdict; }
  const spans: Span[] = [];

  claims.forEach((c, idx) => {
    if (!c.text || !c.verdict) return;
    const pos = text.indexOf(c.text);
    if (pos !== -1) {
      spans.push({
        start: pos,
        end: pos + c.text.length,
        claimId: c.id || `claim-${idx + 1}`,
        claimIdx: idx + 1,
        verdict: c.verdict,
      });
    }
  });
  spans.sort((a, b) => a.start - b.start);

  const parts: React.ReactNode[] = [];
  let cursor = 0;
  spans.forEach((s, i) => {
    if (s.start > cursor) parts.push(<span key={`t${i}`}>{text.slice(cursor, s.start)}</span>);
    const isSelected = selectedClaimId === s.claimId;
    parts.push(
      <mark
        key={`m${i}`}
        onClick={() => onClaimClick?.(s.claimId, s.claimIdx)}
        style={{
          background: isSelected ? 'var(--accent-dim)' : 'rgba(56, 189, 248, 0.15)',
          borderBottom: `2px solid ${VERDICT_COLOR[s.verdict]}`,
          color: 'inherit',
          borderRadius: 3,
          padding: '2px 4px',
          cursor: 'pointer',
          transition: 'all 0.15s ease',
          boxShadow: isSelected ? `0 0 10px ${VERDICT_COLOR[s.verdict]}60` : undefined,
        }}
        title={`Click to inspect Claim ${s.claimIdx} (${s.verdict})`}
      >
        {text.slice(s.start, s.end)}
        <sup style={{ fontSize: '0.65em', color: VERDICT_COLOR[s.verdict], marginLeft: 3, fontWeight: 700 }}>
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
      margin: 0,
    }}>
      {parts}
    </p>
  );
}

// ─── Individual Claim Investigation Card with Progressive Disclosure ─────────
function EvidenceCard({
  claim,
  index,
  isExpanded,
  isSelected,
  onToggle,
}: {
  claim: Claim;
  index: number;
  isExpanded: boolean;
  isSelected?: boolean;
  onToggle: () => void;
}) {
  const verdict = claim.verdict ?? 'unverified';
  const color   = VERDICT_COLOR[verdict];
  const { copied, copy } = useClipboard();

  const claimId = claim.id || `claim-${index}`;

  return (
    <div
      id={`claim-card-${claimId}`}
      className={`panel panel-sm animate-fade-in ${isSelected ? 'claim-highlight' : ''}`}
      style={{
        borderLeft: `4px solid ${color}`,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        background: 'var(--panel)',
        boxShadow: isSelected ? `0 0 0 2px var(--accent), 0 8px 24px var(--accent-glow)` : undefined,
        transition: 'all var(--transition-hover)',
      }}
    >
      {/* ── Summary Line (Always Visible) ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: '1 1 300px', minWidth: 0 }}>
          <span style={{
            width: 24, height: 24, borderRadius: '50%',
            background: color, color: '#000',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '0.75rem', fontWeight: 800, flexShrink: 0,
          }}>
            {index}
          </span>
          <span className="badge badge-muted" style={{ marginRight: 2, fontSize: '0.6875rem' }}>{claim.category}</span>
          <ClaimBadge verdict={verdict} />
          <div className="truncate" style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text)' }}>
            {claim.text}
          </div>
        </div>

        {/* Confidence & Freshness Indicators + Expand/Collapse Button */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
          {claim.confidence !== undefined && (
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '0.5625rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
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
                <div style={{ fontSize: '0.5625rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Freshness
                </div>
                <span style={{ fontSize: '0.8125rem', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                  {(claim.score * 100).toFixed(0)}%
                </span>
              </div>
              <ScoreRing score={claim.score} size={30} strokeWidth={3} label={`Claim ${index} freshness score`} />
            </div>
          )}

          <button
            type="button"
            onClick={onToggle}
            className="btn btn-secondary"
            style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.75rem', padding: '4px 9px' }}
            aria-expanded={isExpanded}
            title={isExpanded ? 'Collapse technical claim details' : 'Expand full claim details and evidence'}
          >
            <span>{isExpanded ? 'Less' : 'Details'}</span>
            {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>
        </div>
      </div>

      {/* ── Progressive Detail Layer (Expanded View) ── */}
      {isExpanded && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 6 }} className="animate-fade-in">

          {/* Full Claim Assertion */}
          <div style={{ background: 'var(--card-subtle)', padding: '10px 14px', borderRadius: 6, border: '1px solid var(--border)' }}>
            <div style={{ fontSize: '0.6875rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 2 }}>
              Original Extracted Assertion
            </div>
            <p style={{ margin: 0, color: 'var(--text)', fontSize: '0.875rem', lineHeight: 1.5 }}>{claim.text}</p>
          </div>

          {/* ── Evidence Comparison: Original AI Claim | Verified Information ── */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
              gap: 12,
              background: 'var(--card-subtle)',
              padding: '12px 14px',
              borderRadius: 6,
              border: '1px solid var(--border)',
            }}
          >
            {/* Left: Original AI Claim */}
            <div>
              <div style={{ fontSize: '0.6875rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontWeight: 700 }}>Original AI Claim</span>
                <span className="badge badge-muted" style={{ fontSize: '0.5625rem', padding: '1px 5px' }}>Extracted</span>
              </div>
              <div style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '0.875rem',
                color: verdict === 'stale' ? 'var(--stale)' : 'var(--text)',
                background: 'rgba(0,0,0,0.2)',
                padding: '8px 10px',
                borderRadius: 4,
                border: '1px solid var(--border)',
                wordBreak: 'break-word',
              }}>
                {claim.extractedValue || claim.text}
              </div>
            </div>

            {/* Right: Verified Information */}
            <div>
              <div style={{ fontSize: '0.6875rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontWeight: 700 }}>Verified Information</span>
                  <span className="badge" style={{
                    fontSize: '0.5625rem',
                    padding: '1px 5px',
                    background: verdict === 'stale' ? 'var(--current-dim)' : 'var(--card-subtle)',
                    color: verdict === 'stale' ? 'var(--current)' : 'var(--muted)',
                  }}>
                    {verdict === 'stale' ? 'Superseding Fact' : verdict === 'current' ? 'Corroborated Current' : 'Unresolved'}
                  </span>
                </div>
                {claim.liveValue && (
                  <button
                    type="button"
                    onClick={() => copy(claim.liveValue!)}
                    className="btn btn-secondary"
                    style={{ padding: '2px 6px', fontSize: '0.6875rem', display: 'flex', alignItems: 'center', gap: 3 }}
                    title="Copy verified value to clipboard"
                  >
                    {copied ? <Check size={11} /> : <Copy size={11} />}
                    <span>{copied ? 'Copied' : 'Copy'}</span>
                  </button>
                )}
              </div>
              <div style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '0.875rem',
                fontWeight: 600,
                color: verdict === 'stale' ? 'var(--current)' : verdict === 'current' ? 'var(--current)' : 'var(--unverified)',
                background: 'rgba(0,0,0,0.2)',
                padding: '8px 10px',
                borderRadius: 4,
                border: `1px solid ${verdict === 'stale' ? 'var(--current-border)' : 'var(--border)'}`,
                wordBreak: 'break-word',
              }}>
                {claim.liveValue || (verdict === 'current' ? 'Confirmed Active & Up-to-date' : 'No contradicting or conclusive web data established')}
              </div>
            </div>
          </div>

          {/* ── Verdict & Detailed Reasoning ── */}
          <div style={{
            padding: '10px 14px',
            borderRadius: 6,
            fontSize: '0.8125rem',
            background: verdict === 'stale' ? 'rgba(239, 68, 68, 0.08)' : verdict === 'current' ? 'rgba(52, 211, 153, 0.08)' : 'rgba(245, 158, 11, 0.08)',
            border: `1px solid ${verdict === 'stale' ? 'rgba(239, 68, 68, 0.25)' : verdict === 'current' ? 'rgba(52, 211, 153, 0.25)' : 'rgba(245, 158, 11, 0.25)'}`,
            color: 'var(--text-soft)',
            lineHeight: 1.5,
          }}>
            <strong style={{ color: color }}>Reasoning &amp; Classification: </strong>
            {verdict === 'stale' && `Outdated fact detected. Retrieved authoritative sources superseded the claim with "${claim.liveValue || 'newer updates'}".`}
            {verdict === 'current' && `Confirmed current. Authoritative live web documents corroborate that this claim is accurate as of current date.`}
            {verdict === 'unverified' && `Unverified fact. Insufficient authoritative web documents were found to corroborate or refute this assertion with high confidence. Note: Unverified assertions are not labeled false, but caution is advised.`}
          </div>

          {/* ── Freshness & Confidence Scoring Breakdown ── */}
          <div style={{ background: 'var(--card-subtle)', borderRadius: 6, border: '1px solid var(--border)', padding: '10px 14px' }}>
            <div style={{ fontSize: '0.6875rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8, fontWeight: 700 }}>
              Multi-Factor Scoring Breakdown
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, fontSize: '0.75rem' }}>
              <div style={{ background: 'var(--panel)', padding: '8px 10px', borderRadius: 4, border: '1px solid var(--border)' }}>
                <span style={{ color: 'var(--muted)', display: 'block', fontSize: '0.625rem', textTransform: 'uppercase' }}>Semantic Agreement</span>
                <strong style={{ color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}>
                  {verdict === 'current' ? '1.00 (100%)' : verdict === 'stale' ? '0.00 (0%)' : '0.50 (50%)'}
                </strong>
              </div>
              <div style={{ background: 'var(--panel)', padding: '8px 10px', borderRadius: 4, border: '1px solid var(--border)' }}>
                <span style={{ color: 'var(--muted)', display: 'block', fontSize: '0.625rem', textTransform: 'uppercase' }}>Sources Consulted</span>
                <strong style={{ fontFamily: 'var(--font-mono)' }}>{claim.sources?.length ?? 0} web citation{claim.sources?.length === 1 ? '' : 's'}</strong>
              </div>
              <div style={{ background: 'var(--panel)', padding: '8px 10px', borderRadius: 4, border: '1px solid var(--border)' }}>
                <span style={{ color: 'var(--muted)', display: 'block', fontSize: '0.625rem', textTransform: 'uppercase' }}>Domain Authority</span>
                <strong style={{ fontFamily: 'var(--font-mono)', color: claim.sources?.some(s => s.isOfficial) ? 'var(--current)' : 'var(--text)' }}>
                  {claim.sources?.some(s => s.isOfficial) ? 'Official Domain Verified' : 'Standard Web Authority'}
                </strong>
              </div>
              <div style={{ background: 'var(--panel)', padding: '8px 10px', borderRadius: 4, border: '1px solid var(--border)' }}>
                <span style={{ color: 'var(--muted)', display: 'block', fontSize: '0.625rem', textTransform: 'uppercase' }}>Temporal Gap / Volatility</span>
                <strong style={{ fontFamily: 'var(--font-mono)' }}>{((claim.likelihood ?? 1) * 100).toFixed(0)}%</strong>
              </div>
            </div>
          </div>

          {/* ── Supporting & Contradicting Evidence Sources ── */}
          {claim.sources && claim.sources.length > 0 && (
            <div>
              <div style={{ fontSize: '0.6875rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8, fontWeight: 700 }}>
                Corroborating Evidence ({claim.sources.length} source{claim.sources.length > 1 ? 's' : ''})
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {claim.sources.map((s, i) => (
                  <div
                    key={i}
                    style={{
                      background: 'var(--card-subtle)',
                      border: '1px solid var(--border)',
                      borderRadius: 4,
                      padding: '10px 14px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 6,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', minWidth: 0 }}>
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
                          minWidth: 0,
                          maxWidth: '100%',
                          overflow: 'hidden',
                        }}
                      >
                        <ExternalLink size={12} aria-hidden="true" style={{ flexShrink: 0 }} />
                        <span
                          style={{
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            display: 'inline-block',
                            minWidth: 0,
                          }}
                        >
                          {s.title || s.domain || s.url}
                        </span>
                      </a>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
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
                      <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--muted)', lineHeight: 1.5, background: 'rgba(0,0,0,0.15)', padding: '6px 10px', borderRadius: 4 }}>
                        "{s.content}"
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

        </div>
      )}
    </div>
  );
}

// ─── Main Inspector Page with Progressive Disclosure ──────────────────────────
export default function Inspector() {
  const { id, claimId } = useParams<{ id: string; claimId?: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { showError, showToast } = useToast();
  const { copied, copy } = useClipboard();

  const [doc, setDoc]                 = useState<ResponseDoc | null>(null);
  const [loading, setLoading]         = useState(true);
  const [notFound, setNotFound]       = useState(false);
  const [verifying, setVerifying]     = useState(false);
  const [selectedClaimId, setSelectedClaimId] = useState<string | null>(claimId || null);
  const [filterVerdict, setFilterVerdict]       = useState<'all' | 'stale' | 'current' | 'unverified'>('all');

  // Progressive Disclosure: Independent expandable/collapsible section states
  const [sectionsOpen, setSectionsOpen] = useState({
    original: true,
    corrected: true,
    claims: true,
    evidenceAnalysis: false,
    scoringModel: false,
    metadata: false,
  });

  // Individual Claim Cards expansion states
  const [expandedClaims, setExpandedClaims] = useState<Record<string, boolean>>({});

  // Export report dropdown state
  const [exportMenuOpen, setExportMenuOpen] = useState(false);

  // ── Load response document ──────────────────────────────────────────────────
  const load = useCallback(async () => {
    if (id === 'x') {
      navigate('/inspector', { replace: true });
      return;
    }

    setLoading(true);
    setNotFound(false);

    if (id) {
      const stateDoc = (location.state as { doc?: ResponseDoc } | null)?.doc;
      if (stateDoc && (stateDoc._id === id || stateDoc.requestId === id)) {
        setDoc(stateDoc);
        setNotFound(false);
        setLoading(false);
        try {
          sessionStorage.setItem('freshnessguard_last_response', JSON.stringify(stateDoc));
        } catch {}
        return;
      }

      try {
        const cached = sessionStorage.getItem('freshnessguard_last_response');
        if (cached) {
          const parsed = JSON.parse(cached) as ResponseDoc;
          if (parsed && (parsed._id === id || parsed.requestId === id)) {
            setDoc(parsed);
            setNotFound(false);
            setLoading(false);
            return;
          }
        }
      } catch {}

      try {
        const fetched = await api.getResponse(id);
        setDoc(fetched);
        setNotFound(false);
        try {
          sessionStorage.setItem('freshnessguard_last_response', JSON.stringify(fetched));
        } catch {}
      } catch (e: unknown) {
        if ((e as { status?: number }).status === 404) {
          setNotFound(true);
        } else {
          showError((e as Error).message);
        }
      } finally {
        setLoading(false);
      }
      return;
    }

    const stateDoc = (location.state as { doc?: ResponseDoc } | null)?.doc;
    if (stateDoc) {
      setDoc(stateDoc);
      setNotFound(false);
      setLoading(false);
      try {
        sessionStorage.setItem('freshnessguard_last_response', JSON.stringify(stateDoc));
      } catch {}
      return;
    }

    try {
      const res = await api.getResponses(1, 1);
      if (res && res.data && res.data.length > 0) {
        setDoc(res.data[0]);
        setNotFound(false);
        setLoading(false);
        try {
          sessionStorage.setItem('freshnessguard_last_response', JSON.stringify(res.data[0]));
        } catch {}
        return;
      }
    } catch {}

    try {
      const cached = sessionStorage.getItem('freshnessguard_last_response');
      if (cached) {
        const parsed = JSON.parse(cached) as ResponseDoc;
        if (parsed && (parsed._id || parsed.requestId)) {
          setDoc(parsed);
          setNotFound(false);
          setLoading(false);
          return;
        }
      }
    } catch {}

    setDoc(null);
    setNotFound(false);
    setLoading(false);
  }, [id, location.state, navigate, showError]);

  useEffect(() => { load(); }, [load]);

  // ── Handle Claim-Level Deep Linking on Load or Parameter Change ─────────────
  useEffect(() => {
    const targetClaimId = claimId || (location.state as { targetClaimId?: string } | null)?.targetClaimId;
    if (targetClaimId && doc) {
      setSelectedClaimId(targetClaimId);
      setExpandedClaims(prev => ({ ...prev, [targetClaimId]: true }));
      setSectionsOpen(prev => ({ ...prev, claims: true }));

      // Smooth scroll to target claim
      const timer = setTimeout(() => {
        const targetEl = document.getElementById(`claim-card-${targetClaimId}`);
        if (targetEl) {
          targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 200);

      return () => clearTimeout(timer);
    }
  }, [claimId, location.state, doc]);

  const handleVerify = async () => {
    const targetId = id || doc?._id || doc?.requestId;
    if (!targetId || !doc) return;
    setVerifying(true);
    try {
      const updated = await api.postVerify(targetId);
      setDoc(updated);
      try {
        sessionStorage.setItem('freshnessguard_last_response', JSON.stringify(updated));
      } catch {}
      showToast('Verification updated with live Tavily corroboration.', 'success');
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

  const handleClaimClick = (targetClaimId: string, idx: number) => {
    setSelectedClaimId(targetClaimId);
    setExpandedClaims(prev => ({ ...prev, [targetClaimId]: true }));
    setSectionsOpen(prev => ({ ...prev, claims: true }));

    // Deep link URL update without full reload
    const verificationId = doc?._id || doc?.requestId;
    if (verificationId) {
      navigate(`/inspector/${verificationId}/claims/${targetClaimId}`, { replace: false });
    }

    const targetEl = document.getElementById(`claim-card-${targetClaimId}`);
    if (targetEl) {
      targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  const toggleClaimExpansion = (targetClaimId: string) => {
    setExpandedClaims(prev => ({
      ...prev,
      [targetClaimId]: !prev[targetClaimId],
    }));
  };

  const toggleAllClaims = () => {
    if (!doc) return;
    const allExpanded = doc.claims.every(c => expandedClaims[c.id || `claim-${doc.claims.indexOf(c) + 1}`]);
    const next: Record<string, boolean> = {};
    if (!allExpanded) {
      doc.claims.forEach((c, i) => {
        next[c.id || `claim-${i + 1}`] = true;
      });
    }
    setExpandedClaims(next);
  };

  // ── Verification Report Exporters ───────────────────────────────────────────
  const exportMarkdownReport = () => {
    if (!doc) return;
    const timestamp = doc.checkedAt ? new Date(doc.checkedAt).toISOString() : new Date().toISOString();
    const md = `# FreshnessGuard Verification Report
**Verification ID:** ${doc._id || doc.requestId}
**Timestamp:** ${timestamp}
**Model:** ${doc.model} (${doc.provider || 'Gateway'})
**Mode:** ${doc.mode} | **Processing Latency:** ${doc.processingMs}ms
**Overall Freshness Score:** ${(doc.overallScore * 100).toFixed(0)}%
**Verification Confidence:** ${doc.overallConfidence != null ? (doc.overallConfidence * 100).toFixed(0) + '%' : 'N/A'}
**Overall Verdict:** ${doc.summaryStatus || (doc.staleCount > 0 ? 'Stale Detected' : 'All Fresh')}
**Claim Distribution:** Total: ${doc.totalClaims} | Stale: ${doc.staleCount} | Current: ${doc.claims.filter(c => c.verdict === 'current').length} | Unverified: ${doc.claims.filter(c => c.verdict === 'unverified').length}

---

## 1. Original AI Response
${doc.originalText}

${doc.correctedAnswer ? `## 2. Live Corrected Answer (Tavily Corroborated)\n${doc.correctedAnswer}\n\n---\n` : ''}

## 3. Claim-by-Claim Verification Breakdown

${doc.claims.map((c, i) => `### Claim ${i + 1} [${c.category.toUpperCase()}] — ${c.verdict?.toUpperCase() || 'UNVERIFIED'}
- **Claim ID:** ${c.id || `claim-${i + 1}`}
- **Assertion:** ${c.text}
- **Extracted Value:** ${c.extractedValue}
- **Verified / Current Value:** ${c.liveValue || (c.verdict === 'current' ? 'Confirmed current by live search' : 'Unresolved / Insufficient evidence')}
- **Freshness Score:** ${c.score !== undefined ? (c.score * 100).toFixed(0) + '%' : 'N/A'}
- **Confidence:** ${c.confidence !== undefined ? (c.confidence * 100).toFixed(0) + '%' : 'N/A'}
- **Semantic Agreement Weight:** ${c.verdict === 'current' ? '1.00' : c.verdict === 'stale' ? '0.00' : '0.50'}
- **Sources Consulted:** ${c.sources?.length || 0}
${c.sources && c.sources.length > 0 ? c.sources.map(s => `  - [${s.title || s.domain || s.url}](${s.url}) ${s.publishedDate ? `(${new Date(s.publishedDate).toLocaleDateString()})` : ''}\n    > "${s.content || ''}"`).join('\n') : '  - No web sources cited.'}
`).join('\n')}

---
*Generated by FreshnessGuard — Real-Time LLM Fact & Freshness Verification Gateway.*
`;

    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `freshnessguard-report-${(doc._id || doc.requestId).slice(0, 8)}.md`;
    a.click();
    URL.revokeObjectURL(url);
    setExportMenuOpen(false);
    showToast('Verification report downloaded (.md).', 'success');
  };

  const exportJsonReport = () => {
    if (!doc) return;
    const jsonStr = JSON.stringify(doc, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `freshnessguard-report-${(doc._id || doc.requestId).slice(0, 8)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setExportMenuOpen(false);
    showToast('Raw verification record downloaded (.json).', 'success');
  };

  if (loading) return <LoadingSpinner label="Loading verification details" />;

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

  if (!doc) {
    return (
      <div className="panel animate-fade-in" style={{ padding: '3.5rem 2rem', textAlign: 'center', maxWidth: 640, margin: '2rem auto' }}>
        <div style={{ width: 54, height: 54, borderRadius: '50%', background: 'var(--accent-dim)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1rem' }}>
          <Search size={28} color="var(--accent)" />
        </div>
        <h2 style={{ marginBottom: '0.5rem' }}>No verification selected</h2>
        <p style={{ marginBottom: '1.5rem', color: 'var(--muted)', lineHeight: 1.6 }}>
          Run a check in Playground or select a verification from Overview.
        </p>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
          <button className="btn btn-primary" onClick={() => navigate('/playground')}>
            <Play size={14} fill="currentColor" /> Go to Playground
          </button>
          <button className="btn btn-secondary" onClick={() => navigate('/')}>
            View Overview
          </button>
        </div>
      </div>
    );
  }

  const filteredClaims = doc.claims.filter(c => {
    if (filterVerdict === 'all') return true;
    return c.verdict === filterVerdict;
  });

  const staleClaimsCount = doc.claims.filter(c => c.verdict === 'stale').length;
  const currentClaimsCount = doc.claims.filter(c => c.verdict === 'current').length;
  const unverifiedClaimsCount = doc.claims.filter(c => c.verdict === 'unverified').length;
  const allClaimsExpanded = doc.claims.length > 0 && doc.claims.every(c => expandedClaims[c.id || `claim-${doc.claims.indexOf(c) + 1}`]);

  // Aggregate all sources for evidence analysis section (deduplicate by URL for clean presentation)
  const allSources = doc.claims.flatMap(c => c.sources || []);
  const uniqueSources = Array.from(new Map(allSources.map(s => [s.url, s])).values());
  const officialSourcesCount = uniqueSources.filter(s => s.isOfficial).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', width: '100%', minWidth: 0, boxSizing: 'border-box' }} className="animate-fade-in">

      {/* ── Breadcrumb & Top Action Bar ── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 12,
          paddingBottom: 8,
          borderBottom: '1px solid var(--border)',
          width: '100%',
          boxSizing: 'border-box',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: '0.875rem' }}>
          <button
            className="btn btn-secondary"
            onClick={() => window.history.length > 1 ? navigate(-1) : navigate('/')}
            style={{ padding: '5px 12px', fontSize: '0.75rem' }}
          >
            <ArrowLeft size={13} /> Back
          </button>
          <span style={{ color: 'var(--muted)' }}>/</span>
          <span style={{ color: 'var(--muted)' }}>Verification Record</span>
          <span style={{ color: 'var(--text)', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
            #{doc._id ? doc._id.slice(0, 10) : doc.requestId.slice(0, 10)}
          </span>
          <span
            style={{
              padding: '3px 10px',
              borderRadius: 4,
              fontSize: '0.6875rem',
              fontWeight: 700,
              background: staleClaimsCount > 0 ? 'var(--stale-dim)' : 'var(--current-dim)',
              color: staleClaimsCount > 0 ? 'var(--stale)' : 'var(--current)',
              border: `1px solid ${staleClaimsCount > 0 ? 'var(--stale-border)' : 'var(--current-border)'}`,
            }}
          >
            {staleClaimsCount > 0 ? `🚨 ${staleClaimsCount} Stale Claim${staleClaimsCount === 1 ? '' : 's'}` : '✅ Fresh Verified'}
          </span>
        </div>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', position: 'relative' }}>
          {/* Export Report Dropdown */}
          <div style={{ position: 'relative' }}>
            <button
              className="btn btn-secondary"
              onClick={() => setExportMenuOpen(prev => !prev)}
              style={{ fontSize: '0.8125rem', display: 'flex', alignItems: 'center', gap: 6 }}
              title="Export complete verification report"
            >
              <Download size={13} /> Export Report <ChevronDown size={12} />
            </button>
            {exportMenuOpen && (
              <div
                style={{
                  position: 'absolute',
                  right: 0,
                  top: '110%',
                  background: 'var(--panel)',
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                  boxShadow: 'var(--panel-shadow)',
                  zIndex: 40,
                  minWidth: 180,
                  display: 'flex',
                  flexDirection: 'column',
                  padding: 4,
                }}
              >
                <button
                  type="button"
                  onClick={exportMarkdownReport}
                  style={{
                    padding: '8px 12px',
                    fontSize: '0.78125rem',
                    textAlign: 'left',
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--text)',
                    borderRadius: 4,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--card-subtle)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  <FileText size={14} color="var(--accent)" /> Markdown Report (.md)
                </button>
                <button
                  type="button"
                  onClick={exportJsonReport}
                  style={{
                    padding: '8px 12px',
                    fontSize: '0.78125rem',
                    textAlign: 'left',
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--text)',
                    borderRadius: 4,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--card-subtle)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  <Code size={14} color="var(--accent)" /> Raw Record (.json)
                </button>
              </div>
            )}
          </div>

          <button className="btn btn-secondary" onClick={handleVerify} disabled={verifying} style={{ fontSize: '0.8125rem' }}>
            <RefreshCw size={13} style={verifying ? { animation: 'spin 0.75s linear infinite' } : {}} />
            {verifying ? 'Re-verifying with Tavily…' : 'Re-verify with Tavily'}
          </button>
          {doc.staleCount > 0 && (
            <button className="btn btn-primary" onClick={handleCopyCorrected} style={{ fontSize: '0.8125rem' }}>
              {copied ? <Check size={13} /> : <Copy size={13} />}
              {copied ? 'Copied Corrected!' : 'Copy Corrected Answer'}
            </button>
          )}
        </div>
      </div>

      {/* ── 1. SUMMARY-FIRST VERIFICATION OVERVIEW (Always Visible) ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 360px), 1fr))', gap: '1.25rem', width: '100%', boxSizing: 'border-box' }}>

        {/* Executive Verification Summary Card */}
        <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: 12, height: '100%', boxSizing: 'border-box' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <ScoreRing score={doc.overallScore} size={68} strokeWidth={5.5} label="Overall freshness score" />
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <h1 style={{ margin: 0, fontSize: '1.375rem', fontWeight: 800, letterSpacing: '-0.02em' }}>
                    {Math.round(doc.overallScore * 100)}% Freshness Score
                  </h1>
                  <SummaryBadge
                    status={doc.summaryStatus ?? (doc.totalClaims === 0 ? 'no_claims' : doc.staleCount > 0 ? 'stale_detected' : 'all_fresh')}
                    message={doc.summaryMessage}
                    size="sm"
                  />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.75rem', color: 'var(--muted)', flexWrap: 'wrap' }}>
                  <span>Model: <strong style={{ color: 'var(--text)' }}>{doc.model}</strong></span>
                  <span>•</span>
                  <span>Mode: <strong style={{ color: 'var(--accent)' }}>{doc.mode}</strong></span>
                  <span>•</span>
                  <span>Latency: <strong style={{ color: 'var(--text)' }}>{doc.processingMs}ms</strong></span>
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <div style={{ background: 'var(--card-subtle)', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 12px', textAlign: 'center' }}>
                <div style={{ fontSize: '0.5625rem', color: 'var(--muted)', textTransform: 'uppercase' }}>Confidence</div>
                <div
                  style={{
                    fontSize: doc.totalClaims === 0 || !doc.claims || doc.claims.length === 0 || doc.overallConfidence == null ? '0.8125rem' : '1rem',
                    fontWeight: 700,
                    color: doc.totalClaims === 0 || !doc.claims || doc.claims.length === 0 || doc.overallConfidence == null ? 'var(--muted)' : 'var(--accent)',
                    fontFamily: 'var(--font-mono)',
                  }}
                  title={doc.totalClaims === 0 || !doc.claims || doc.claims.length === 0 ? 'No claims to evaluate' : 'Verification confidence'}
                >
                  {doc.totalClaims === 0 || !doc.claims || doc.claims.length === 0 || doc.overallConfidence == null
                    ? 'N/A'
                    : `${(doc.overallConfidence * 100).toFixed(0)}%`}
                </div>
              </div>
              <div style={{ background: 'var(--card-subtle)', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 12px', textAlign: 'center' }}>
                <div style={{ fontSize: '0.5625rem', color: 'var(--muted)', textTransform: 'uppercase' }}>Distribution</div>
                <div style={{ fontSize: '0.8125rem', fontWeight: 700, fontFamily: 'var(--font-mono)', marginTop: 2 }}>
                  <span style={{ color: 'var(--stale)' }}>{staleClaimsCount}S</span> / <span style={{ color: 'var(--current)' }}>{currentClaimsCount}C</span> / <span style={{ color: 'var(--unverified)' }}>{unverifiedClaimsCount}U</span>
                </div>
              </div>
            </div>
          </div>

          {/* AI Briefing Summary Box */}
          <div style={{ background: 'var(--card-subtle)', border: '1px solid var(--border)', borderRadius: 6, padding: '10px 14px', fontSize: '0.8125rem', marginTop: 'auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--accent)', fontWeight: 700, marginBottom: 4 }}>
              <Sparkles size={13} /> Verification Executive Brief
            </div>
            <ul style={{ margin: 0, paddingLeft: 16, color: 'var(--text-soft)', lineHeight: 1.5, fontSize: '0.78125rem' }}>
              <li>Extracted <strong>{doc.totalClaims} time-sensitive factual assertions</strong> across categories ({doc.claims.map(c => c.category).filter((v, i, a) => a.indexOf(v) === i).join(', ') || 'factual'}).</li>
              <li>Queried <strong>Tavily live search</strong> against authoritative public web documents.</li>
              <li>Detected <strong>{staleClaimsCount} stale fact{staleClaimsCount === 1 ? '' : 's'}</strong> with superseding recency evidence; freshness score is <strong>{Math.round(doc.overallScore * 100)}%</strong>.</li>
            </ul>
          </div>
        </div>

        {/* Interactive Claim Triage Index */}
        <div className="panel" style={{ display: 'flex', flexDirection: 'column', height: '100%', boxSizing: 'border-box' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Layers size={16} color="var(--accent)" />
              <h2 style={{ fontSize: '0.9375rem', fontWeight: 700, margin: 0 }}>
                Claim Triage Index ({doc.claims.length})
              </h2>
            </div>
            <span style={{ fontSize: '0.6875rem', color: 'var(--muted)' }}>
              Click claim to jump &amp; highlight
            </span>
          </div>

          {doc.claims.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '2rem 1rem', color: 'var(--muted)', fontSize: '0.8125rem' }}>
              No claims extracted in this response.
            </div>
          ) : (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
                maxHeight: 200,
                overflowY: 'auto',
                paddingRight: 4,
              }}
            >
              {doc.claims.map((c, i) => {
                const idx = i + 1;
                const claimIdentifier = c.id || `claim-${idx}`;
                const isSelected = selectedClaimId === claimIdentifier;
                const color = VERDICT_COLOR[c.verdict ?? 'unverified'];
                return (
                  <button
                    key={claimIdentifier}
                    type="button"
                    onClick={() => handleClaimClick(claimIdentifier, idx)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '6px 10px',
                      borderRadius: 6,
                      border: `1px solid ${isSelected ? 'var(--accent)' : 'var(--border)'}`,
                      background: isSelected ? 'var(--accent-dim)' : 'var(--card-subtle)',
                      color: 'var(--text)',
                      fontSize: '0.75rem',
                      textAlign: 'left',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                      gap: 8,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, overflow: 'hidden' }}>
                      <span
                        style={{
                          width: 18,
                          height: 18,
                          borderRadius: '50%',
                          background: color,
                          color: '#000',
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '0.6875rem',
                          fontWeight: 800,
                          flexShrink: 0,
                        }}
                      >
                        {idx}
                      </span>
                      <span className="truncate" style={{ fontWeight: 600, maxWidth: 240 }}>
                        {c.extractedValue || c.text}
                      </span>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                      <span style={{ fontSize: '0.6875rem', color: 'var(--muted)', textTransform: 'uppercase' }}>
                        {c.category}
                      </span>
                      <span
                        style={{
                          fontSize: '0.625rem',
                          fontWeight: 700,
                          textTransform: 'uppercase',
                          color: color,
                          padding: '1px 6px',
                          borderRadius: 3,
                          background: `${color}15`,
                        }}
                      >
                        {c.verdict}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Visual Pipeline Bar */}
      <div
        className="panel panel-sm"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 16,
          padding: '10px 16px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Network size={16} color="var(--accent)" />
          <span style={{ fontSize: '0.8125rem', fontWeight: 700, color: 'var(--text)' }}>
            Verification Triage Pipeline
          </span>
          <span className="badge badge-accent" style={{ fontSize: '0.625rem', padding: '1px 6px' }}>Progressive Disclosure</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.75rem' }}>
          <span style={{ padding: '3px 8px', borderRadius: 4, background: 'var(--card-subtle)', color: 'var(--muted)' }}>
            1. Ingestion
          </span>
          <span style={{ color: 'var(--dim)' }}>➔</span>
          <span style={{ padding: '3px 8px', borderRadius: 4, background: 'var(--accent-dim)', color: 'var(--accent)' }}>
            2. {doc.fromLLM === false ? 'Regex Fallback' : 'Claim Extraction'}
          </span>
          <span style={{ color: 'var(--dim)' }}>➔</span>
          <span style={{ padding: '3px 8px', borderRadius: 4, background: 'rgba(139, 92, 246, 0.15)', color: '#8b5cf6' }}>
            3. Tavily Corroboration
          </span>
          <span style={{ color: 'var(--dim)' }}>➔</span>
          <span style={{ padding: '3px 8px', borderRadius: 4, background: staleClaimsCount > 0 ? 'var(--stale-dim)' : 'var(--current-dim)', color: staleClaimsCount > 0 ? 'var(--stale)' : 'var(--current)' }}>
            4. {staleClaimsCount > 0 ? 'Stale Triage' : 'Fresh Verified'}
          </span>
        </div>
      </div>

      {/* Fallback Disclosure Notice if fromLLM === false */}
      {doc.fromLLM === false && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            background: 'var(--unverified-dim)',
            border: '1px solid var(--unverified-border)',
            borderRadius: 'var(--radius-sm)',
            padding: '10px 14px',
            fontSize: '0.8125rem',
            color: 'var(--text-soft)',
          }}
        >
          <Info size={16} color="var(--unverified)" style={{ flexShrink: 0 }} />
          <div>
            <strong style={{ color: 'var(--unverified)' }}>Deterministic Extraction Active:</strong> Claims were parsed using the regex fallback engine due to upstream LLM quota limits, then verified against live Tavily web evidence.
          </div>
        </div>
      )}

      {/* ── 2. INDEPENDENT EXPANDABLE / COLLAPSIBLE SECTIONS ── */}

      {/* SECTION 1: Original AI Response (Collapsible) & SECTION 2: Live Corrected Answer (Collapsible) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 360px), 1fr))', gap: '1.25rem', width: '100%', alignItems: 'stretch', boxSizing: 'border-box' }}>

        {/* Original AI Response Text */}
        <div className="panel" style={{ display: 'flex', flexDirection: 'column', height: '100%', boxSizing: 'border-box' }}>
          <div
            onClick={() => setSectionsOpen(prev => ({ ...prev, original: !prev.original }))}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: sectionsOpen.original ? '0.75rem' : 0, cursor: 'pointer' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <FileText size={15} color="var(--accent)" />
              <h2 style={{ fontSize: '0.9375rem', fontWeight: 700, margin: 0 }}>
                {doc.question ? `Answer to: "${doc.question}"` : 'Original AI Response (Annotated)'}
              </h2>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: '0.6875rem', color: 'var(--muted)' }}>
                {sectionsOpen.original ? 'Click [n] to jump' : 'Show'}
              </span>
              {sectionsOpen.original ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </div>
          </div>

          {sectionsOpen.original && (
            <div
              style={{
                background: 'var(--card-subtle)',
                padding: '1rem',
                borderRadius: 6,
                border: '1px solid var(--border)',
                flex: 1,
                maxHeight: 280,
                overflowY: 'auto',
              }}
            >
              <AnnotatedText
                text={doc.originalText}
                claims={doc.claims}
                selectedClaimId={selectedClaimId}
                onClaimClick={handleClaimClick}
              />
            </div>
          )}
        </div>

        {/* Live Corrected Answer */}
        <div className="panel" style={{ display: 'flex', flexDirection: 'column', height: '100%', boxSizing: 'border-box', borderLeft: doc.correctedAnswer ? '3px solid var(--current)' : undefined }}>
          <div
            onClick={() => setSectionsOpen(prev => ({ ...prev, corrected: !prev.corrected }))}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: sectionsOpen.corrected ? '0.75rem' : 0, cursor: 'pointer' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <ShieldCheck size={16} color="var(--current)" />
              <h2 style={{ fontSize: '0.9375rem', fontWeight: 700, color: 'var(--current)', margin: 0 }}>
                Live Corrected Answer (Tavily Corroborated)
              </h2>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {doc.correctedAnswer && sectionsOpen.corrected && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={(e) => { e.stopPropagation(); handleCopyCorrected(); }}
                  style={{ padding: '3px 8px', fontSize: '0.75rem' }}
                >
                  {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? 'Copied' : 'Copy'}
                </button>
              )}
              {sectionsOpen.corrected ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </div>
          </div>

          {sectionsOpen.corrected && (
            <div
              style={{
                background: doc.correctedAnswer ? 'var(--current-dim)' : 'var(--card-subtle)',
                padding: '1rem',
                borderRadius: 6,
                border: `1px solid ${doc.correctedAnswer ? 'var(--current-border)' : 'var(--border)'}`,
                flex: 1,
                maxHeight: 280,
                overflowY: 'auto',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: doc.correctedAnswer ? 'flex-start' : 'center',
              }}
            >
              {doc.correctedAnswer ? (
                <p style={{ margin: 0, color: 'var(--text)', whiteSpace: 'pre-wrap', lineHeight: 1.7, fontSize: '0.9375rem' }}>
                  {doc.correctedAnswer}
                </p>
              ) : (
                <div style={{ textAlign: 'center', padding: '1rem', color: 'var(--muted)' }}>
                  <CheckCircle2 size={32} color="var(--current)" style={{ margin: '0 auto 0.5rem' }} />
                  <div style={{ fontSize: '0.875rem', fontWeight: 700, color: 'var(--text)' }}>
                    All Claims Verified Fresh &amp; Current
                  </div>
                  <p style={{ margin: '4px 0 0', fontSize: '0.75rem', color: 'var(--muted)' }}>
                    Tavily web retrieval found zero superseding or outdated facts. No correction required.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* SECTION 3: Individual Claim Investigation (Expandable / Collapsible with Expand All Toggle) */}
      <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: '1rem', width: '100%', boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
          <div
            onClick={() => setSectionsOpen(prev => ({ ...prev, claims: !prev.claims }))}
            style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}
          >
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <h2 style={{ fontSize: '1.0625rem', fontWeight: 700, margin: 0 }}>
                  Individual Claim Investigation ({doc.claims.length})
                </h2>
                {sectionsOpen.claims ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              </div>
              <span style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>
                Evidence comparison, multi-factor scoring breakdown, and authoritative citations
              </span>
            </div>
          </div>

          {/* Action Bar: Filter Tabs & Expand/Collapse All */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {(['all', 'stale', 'current', 'unverified'] as const).map(f => (
                <button
                  key={f}
                  onClick={() => setFilterVerdict(f)}
                  style={{
                    padding: '4px 10px',
                    borderRadius: 4,
                    fontSize: '0.75rem',
                    fontWeight: filterVerdict === f ? 700 : 500,
                    background: filterVerdict === f ? 'var(--accent-dim)' : 'transparent',
                    color: filterVerdict === f ? 'var(--accent)' : 'var(--muted)',
                    border: `1px solid ${filterVerdict === f ? 'var(--accent)' : 'var(--border)'}`,
                    textTransform: 'capitalize',
                    cursor: 'pointer',
                  }}
                >
                  {f} ({f === 'all' ? doc.claims.length : doc.claims.filter(c => c.verdict === f).length})
                </button>
              ))}
            </div>

            <button
              className="btn btn-secondary"
              onClick={toggleAllClaims}
              style={{ padding: '4px 10px', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: 4 }}
              title={allClaimsExpanded ? 'Collapse all claim cards' : 'Expand all claim cards'}
            >
              {allClaimsExpanded ? <EyeOff size={13} /> : <Eye size={13} />}
              <span>{allClaimsExpanded ? 'Collapse All' : 'Expand All'}</span>
            </button>
          </div>
        </div>

        {sectionsOpen.claims && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', width: '100%' }}>
            {filteredClaims.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '2.5rem', color: 'var(--muted)', background: 'var(--card-subtle)', borderRadius: 6 }}>
                <CheckCircle2 size={32} color="var(--current)" style={{ margin: '0 auto 0.75rem' }} />
                <p style={{ margin: 0, fontSize: '0.875rem' }}>
                  {doc.claims.length === 0
                    ? 'No time-sensitive factual claims were detected in this response.'
                    : `No claims match the "${filterVerdict}" filter.`}
                </p>
              </div>
            ) : (
              filteredClaims.map(c => {
                const originalIdx = doc.claims.indexOf(c) + 1;
                const claimIdentifier = c.id || `claim-${originalIdx}`;
                const isExpanded = !!expandedClaims[claimIdentifier];
                const isSelected = selectedClaimId === claimIdentifier;

                return (
                  <EvidenceCard
                    key={claimIdentifier}
                    claim={c}
                    index={originalIdx}
                    isExpanded={isExpanded}
                    isSelected={isSelected}
                    onToggle={() => toggleClaimExpansion(claimIdentifier)}
                  />
                );
              })
            )}
          </div>
        )}
      </div>

      {/* SECTION 4: Evidence & Source Analysis (Independent Expandable Section) */}
      <div className="panel" style={{ width: '100%', boxSizing: 'border-box' }}>
        <div
          onClick={() => setSectionsOpen(prev => ({ ...prev, evidenceAnalysis: !prev.evidenceAnalysis }))}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <Globe size={16} color="var(--accent)" />
            <h3 style={{ fontSize: '0.9375rem', margin: 0, fontWeight: 700 }}>
              Evidence &amp; Source Analysis ({uniqueSources.length} unique source{uniqueSources.length === 1 ? '' : 's'}{allSources.length > uniqueSources.length ? `, ${allSources.length} citations` : ''})
            </h3>
            <span className="badge badge-muted" style={{ fontSize: '0.625rem' }}>
              {officialSourcesCount} Official
            </span>
          </div>
          {sectionsOpen.evidenceAnalysis ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </div>

        {sectionsOpen.evidenceAnalysis && (
          <div style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: 12 }} className="animate-fade-in">
            <p style={{ margin: 0, fontSize: '0.8125rem', color: 'var(--muted)' }}>
              Summary of all external domains, publishing recency, and authority ratings aggregated during verification:
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 280px), 1fr))', gap: 12, width: '100%', boxSizing: 'border-box' }}>
              {uniqueSources.length === 0 ? (
                <div style={{ color: 'var(--muted)', fontSize: '0.8125rem', padding: '1rem', background: 'var(--card-subtle)', borderRadius: 6 }}>
                  No external sources retrieved.
                </div>
              ) : (
                uniqueSources.map((s, idx) => {
                  let safeHostname = s.domain || '';
                  if (!safeHostname && s.url) {
                    try {
                      safeHostname = new URL(s.url).hostname;
                    } catch {
                      safeHostname = s.url;
                    }
                  }

                  return (
                    <div
                      key={s.url || idx}
                      style={{
                        background: 'var(--card-subtle)',
                        border: '1px solid var(--border)',
                        borderRadius: 6,
                        padding: '10px 12px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 6,
                        minWidth: 0,
                        overflow: 'hidden',
                        boxSizing: 'border-box',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, minWidth: 0 }}>
                        <a
                          href={s.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            fontSize: '0.8125rem',
                            fontWeight: 600,
                            color: 'var(--accent)',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                            minWidth: 0,
                            flex: 1,
                            overflow: 'hidden',
                          }}
                          title={s.title || safeHostname || s.url}
                        >
                          <ExternalLink size={12} style={{ flexShrink: 0 }} />
                          <span
                            style={{
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                              display: 'inline-block',
                              minWidth: 0,
                              width: '100%',
                            }}
                          >
                            {s.title || safeHostname || s.url}
                          </span>
                        </a>
                        {s.isOfficial && (
                          <span className="badge badge-accent" style={{ fontSize: '0.55rem', padding: '1px 5px', flexShrink: 0 }}>
                            Official
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: '0.6875rem', color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', minWidth: 0 }}>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}>
                          Domain: <strong style={{ color: 'var(--text-soft)' }}>{safeHostname}</strong>
                        </span>
                        {s.publishedDate && (
                          <span style={{ flexShrink: 0 }}>
                            • Date: {new Date(s.publishedDate).toLocaleDateString()}
                          </span>
                        )}
                        {s.score !== undefined && (
                          <span style={{ flexShrink: 0, fontFamily: 'var(--font-mono)' }}>
                            • Rel: {(s.score * 100).toFixed(0)}%
                          </span>
                        )}
                      </div>
                      {s.content && (
                        <div
                          style={{
                            fontSize: '0.75rem',
                            color: 'var(--muted)',
                            lineHeight: 1.45,
                            background: 'rgba(0, 0, 0, 0.2)',
                            padding: '6px 8px',
                            borderRadius: 4,
                            overflow: 'hidden',
                            display: '-webkit-box',
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: 'vertical',
                            textOverflow: 'ellipsis',
                            wordBreak: 'break-word',
                          }}
                          title={s.content}
                        >
                          "{s.content}"
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}
      </div>

      {/* SECTION 5: Freshness & Confidence Scoring Methodology (Independent Expandable Section) */}
      <div className="panel" style={{ width: '100%', boxSizing: 'border-box' }}>
        <div
          onClick={() => setSectionsOpen(prev => ({ ...prev, scoringModel: !prev.scoringModel }))}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Cpu size={16} color="var(--accent)" />
            <h3 style={{ fontSize: '0.9375rem', margin: 0, fontWeight: 700 }}>
              Freshness &amp; Confidence Scoring Engine Details
            </h3>
          </div>
          {sectionsOpen.scoringModel ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </div>

        {sectionsOpen.scoringModel && (
          <div style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: 12 }} className="animate-fade-in">
            <div style={{ fontSize: '0.8125rem', color: 'var(--text-soft)', lineHeight: 1.6 }}>
              FreshnessGuard computes dual orthogonal metrics:
              <ul style={{ margin: '6px 0', paddingLeft: 20 }}>
                <li><strong>Freshness Score ({Math.round(doc.overallScore * 100)}%):</strong> Measures whether stated facts reflect the latest real-world state (40% semantic agreement, 25% domain authority, 25% temporal gap, 10% source volume).</li>
                <li><strong>Verification Confidence ({doc.totalClaims === 0 || !doc.claims || doc.claims.length === 0 || doc.overallConfidence == null ? 'N/A (No claims to evaluate)' : `${(doc.overallConfidence * 100).toFixed(0)}%`}):</strong> Measures certainty based on official domain presence, corroboration density, and semantic clarity.</li>
              </ul>
            </div>
          </div>
        )}
      </div>

      {/* SECTION 6: Technical Verification Metadata (Independent Expandable Section) */}
      <div className="panel" style={{ width: '100%', boxSizing: 'border-box' }}>
        <div
          onClick={() => setSectionsOpen(prev => ({ ...prev, metadata: !prev.metadata }))}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Database size={16} color="var(--accent)" />
            <h3 style={{ fontSize: '0.9375rem', margin: 0, fontWeight: 700 }}>
              Technical Verification Metadata &amp; Record Integrity
            </h3>
          </div>
          {sectionsOpen.metadata ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </div>

        {sectionsOpen.metadata && (
          <div style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: 10 }} className="animate-fade-in">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 8, fontSize: '0.75rem' }}>
              <div style={{ background: 'var(--card-subtle)', padding: '8px 10px', borderRadius: 4, border: '1px solid var(--border)' }}>
                <span style={{ color: 'var(--muted)', display: 'block', fontSize: '0.625rem', textTransform: 'uppercase' }}>MongoDB Record ID</span>
                <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text)' }}>{doc._id || 'N/A'}</span>
              </div>
              <div style={{ background: 'var(--card-subtle)', padding: '8px 10px', borderRadius: 4, border: '1px solid var(--border)' }}>
                <span style={{ color: 'var(--muted)', display: 'block', fontSize: '0.625rem', textTransform: 'uppercase' }}>Gateway Request ID</span>
                <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text)' }}>{doc.requestId}</span>
              </div>
              <div style={{ background: 'var(--card-subtle)', padding: '8px 10px', borderRadius: 4, border: '1px solid var(--border)' }}>
                <span style={{ color: 'var(--muted)', display: 'block', fontSize: '0.625rem', textTransform: 'uppercase' }}>Verified At</span>
                <span>{new Date(doc.checkedAt).toLocaleString()}</span>
              </div>
              <div style={{ background: 'var(--card-subtle)', padding: '8px 10px', borderRadius: 4, border: '1px solid var(--border)' }}>
                <span style={{ color: 'var(--muted)', display: 'block', fontSize: '0.625rem', textTransform: 'uppercase' }}>Extraction Pipeline</span>
                <span style={{ color: doc.fromLLM === false ? 'var(--unverified)' : 'var(--accent)' }}>
                  {doc.fromLLM === false ? 'Regex Fallback Engine' : 'LLM Claim Extractor'}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

    </div>
  );
}