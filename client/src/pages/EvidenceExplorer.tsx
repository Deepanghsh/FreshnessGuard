import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search, Filter, ExternalLink, Globe, CheckCircle2,
  Clock, ShieldCheck, AlertTriangle, Layers, ArrowRight, FileText, RefreshCw
} from 'lucide-react';
import { api } from '../api/client';
import { useToast } from '../components/Layout';
import type { ResponseDoc, Claim, Source, Verdict } from '../types';
import ClaimBadge from '../components/ClaimBadge';
import LoadingSpinner from '../components/LoadingSpinner';

interface FlattenedEvidence {
  verificationId: string;
  model: string;
  checkedAt: string;
  claim: Claim;
  claimIndex: number;
}

export default function EvidenceExplorer() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [evidenceList, setEvidenceList] = useState<FlattenedEvidence[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [verdictFilter, setVerdictFilter] = useState<'all' | 'current' | 'stale' | 'unverified'>('all');
  const [officialOnly, setOfficialOnly] = useState(false);
  const { showToast } = useToast();

  const loadEvidence = (isManual = false) => {
    if (isManual) setRefreshing(true);
    api.getResponses(1, 100)
      .then(res => {
        const flattened: FlattenedEvidence[] = [];
        const docs = (res.data && res.data.length > 0) ? res.data : (() => {
          try {
            const cached = sessionStorage.getItem('freshnessguard_last_response');
            return cached ? [JSON.parse(cached) as ResponseDoc] : [];
          } catch {
            return [];
          }
        })();

        docs.forEach(doc => {
          (doc.claims || []).forEach((c, idx) => {
            flattened.push({
              verificationId: doc._id || doc.requestId,
              model: doc.model,
              checkedAt: doc.checkedAt,
              claim: c,
              claimIndex: idx + 1,
            });
          });
        });
        setEvidenceList(flattened);
        if (isManual) showToast('Evidence citations and source records refreshed.', 'info');
      })
      .catch(() => {})
      .finally(() => {
        setLoading(false);
        if (isManual) setRefreshing(false);
      });
  };

  useEffect(() => {
    setLoading(true);
    loadEvidence(false);
  }, []);

  const filteredEvidence = evidenceList.filter(item => {
    const q = searchQuery.toLowerCase().trim();
    if (q) {
      const matchClaim = item.claim.text.toLowerCase().includes(q) || (item.claim.extractedValue || '').toLowerCase().includes(q);
      const matchLive = (item.claim.liveValue || '').toLowerCase().includes(q);
      const matchSource = (item.claim.sources || []).some(s =>
        (s.title || '').toLowerCase().includes(q) ||
        (s.url || '').toLowerCase().includes(q) ||
        (s.domain || '').toLowerCase().includes(q) ||
        (s.content || '').toLowerCase().includes(q)
      );
      if (!matchClaim && !matchLive && !matchSource) return false;
    }

    if (categoryFilter !== 'all' && item.claim.category !== categoryFilter) return false;
    if (verdictFilter !== 'all' && item.claim.verdict !== verdictFilter) return false;
    if (officialOnly && !(item.claim.sources || []).some(s => s.isOfficial)) return false;

    return true;
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', width: '100%', boxSizing: 'border-box' }} className="animate-fade-in">
      {/* ── Page Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 800 }}>Evidence Explorer</h1>
          <p style={{ margin: '4px 0 0', fontSize: '0.8125rem', color: 'var(--muted)' }}>
            Search, filter, and audit all web citations, publication timestamps, and domain authority records harvested across verification sessions.
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: '0.8125rem', color: 'var(--muted)' }}>
            Total Evidence Records: <strong style={{ color: 'var(--text)' }}>{evidenceList.length}</strong>
          </span>
          <button
            className="btn btn-secondary"
            onClick={() => loadEvidence(true)}
            disabled={refreshing}
            style={{ padding: '6px 12px', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <RefreshCw size={12} style={refreshing ? { animation: 'spin 0.75s linear infinite' } : {}} />
            {refreshing ? 'Refreshing…' : 'Refresh Evidence'}
          </button>
        </div>
      </div>

      {/* ── Filter Bar ── */}
      <div className="panel panel-sm" style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: '1 1 320px' }}>
          <div style={{ position: 'relative', width: '100%' }}>
            <Search size={15} color="var(--muted)" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)' }} />
            <input
              type="text"
              placeholder="Search claims, live values, source titles, URLs, or excerpts..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              style={{ paddingLeft: '2.25rem', fontSize: '0.8125rem' }}
            />
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          {/* Category Dropdown */}
          <select
            value={categoryFilter}
            onChange={e => setCategoryFilter(e.target.value)}
            style={{ width: 'auto', padding: '0.45rem 0.8rem', fontSize: '0.78125rem' }}
          >
            <option value="all">All Categories</option>
            <option value="version">Version</option>
            <option value="pricing">Pricing</option>
            <option value="leadership">Leadership</option>
            <option value="law">Law &amp; Regulation</option>
            <option value="date">Date</option>
            <option value="fact">Factual</option>
          </select>

          {/* Verdict Filter */}
          <select
            value={verdictFilter}
            onChange={e => setVerdictFilter(e.target.value as any)}
            style={{ width: 'auto', padding: '0.45rem 0.8rem', fontSize: '0.78125rem' }}
          >
            <option value="all">All Verdicts</option>
            <option value="current">Current Only</option>
            <option value="stale">Stale Only</option>
            <option value="unverified">Unverified Only</option>
          </select>

          {/* Official Domain Toggle */}
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.75rem', cursor: 'pointer', margin: 0 }}>
            <input
              type="checkbox"
              checked={officialOnly}
              onChange={e => setOfficialOnly(e.target.checked)}
              style={{ width: 15, height: 15, cursor: 'pointer' }}
            />
            <span>Official Domain Only</span>
          </label>
        </div>
      </div>

      {/* ── Results List ── */}
      {loading ? (
        <LoadingSpinner label="Harvesting verified evidence across workspace records" />
      ) : filteredEvidence.length === 0 ? (
        <div className="panel" style={{ textAlign: 'center', padding: '3rem 1.5rem', color: 'var(--muted)' }}>
          <Globe size={36} color="var(--dim)" style={{ margin: '0 auto 0.75rem' }} />
          <h3 style={{ margin: '0 0 4px', color: 'var(--text)' }}>No matching evidence records</h3>
          <p style={{ margin: 0, fontSize: '0.8125rem' }}>Try adjusting your search query or filter selections.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {filteredEvidence.map((item, idx) => {
            const claimId = item.claim.id || `claim-${item.claimIndex}`;
            const verdict = item.claim.verdict ?? 'unverified';
            const sources = item.claim.sources || [];

            return (
              <div
                key={idx}
                className="panel interactive-card"
                style={{
                  borderLeft: `4px solid ${verdict === 'current' ? 'var(--current)' : verdict === 'stale' ? 'var(--stale)' : 'var(--unverified)'}`,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                }}
              >
                {/* Header */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className="badge badge-muted" style={{ fontSize: '0.625rem' }}>{item.claim.category}</span>
                    <ClaimBadge verdict={verdict} />
                    <span style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>
                      Model: <strong style={{ color: 'var(--text)' }}>{item.model}</strong> • {new Date(item.checkedAt).toLocaleDateString()}
                    </span>
                  </div>

                  <button
                    className="btn btn-secondary"
                    onClick={() => navigate(`/inspector/${item.verificationId}/claims/${claimId}`)}
                    style={{ padding: '3px 8px', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: 4 }}
                  >
                    <span>Inspect Case</span> <ArrowRight size={12} />
                  </button>
                </div>

                {/* Assertion & Live Value */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 10 }}>
                  <div style={{ background: 'var(--card-subtle)', padding: '8px 10px', borderRadius: 4, border: '1px solid var(--border)' }}>
                    <div style={{ fontSize: '0.625rem', color: 'var(--muted)', textTransform: 'uppercase', marginBottom: 2 }}>Extracted Claim Assertion</div>
                    <div style={{ fontSize: '0.8125rem', color: 'var(--text)', fontWeight: 600 }}>{item.claim.text}</div>
                  </div>

                  <div style={{ background: 'var(--card-subtle)', padding: '8px 10px', borderRadius: 4, border: '1px solid var(--border)' }}>
                    <div style={{ fontSize: '0.625rem', color: 'var(--muted)', textTransform: 'uppercase', marginBottom: 2 }}>Tavily Corroborated Value</div>
                    <div style={{ fontSize: '0.8125rem', color: verdict === 'stale' ? 'var(--current)' : 'var(--text)', fontWeight: 700 }}>
                      {item.claim.liveValue || (verdict === 'current' ? 'Confirmed Active & Up-to-date' : 'Unresolved / Insufficient evidence')}
                    </div>
                  </div>
                </div>

                {/* Sources */}
                {sources.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <span style={{ fontSize: '0.6875rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      Web Sources ({sources.length})
                    </span>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 8 }}>
                      {sources.map((s, sIdx) => (
                        <div
                          key={sIdx}
                          style={{
                            background: 'var(--input-bg)',
                            border: '1px solid var(--border)',
                            borderRadius: 4,
                            padding: '6px 8px',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 3,
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                            <a
                              href={s.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: 4 }}
                            >
                              <ExternalLink size={10} />
                              <span className="truncate">{s.title || s.domain || s.url}</span>
                            </a>
                            {s.isOfficial && <span className="badge badge-accent" style={{ fontSize: '0.5rem', padding: '1px 4px' }}>Official</span>}
                          </div>
                          {s.content && (
                            <p style={{ margin: 0, fontSize: '0.6875rem', color: 'var(--muted)', lineHeight: 1.4 }} className="truncate">
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
          })}
        </div>
      )}
    </div>
  );
}
