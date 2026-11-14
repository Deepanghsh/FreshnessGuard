import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from 'recharts';
import { Radio, RefreshCw, AlertCircle, ShieldCheck, Zap } from 'lucide-react';
import { useStats } from '../hooks/useStats';
import { useSSE } from '../hooks/useSSE';
import { useToast } from '../components/Layout';
import { api } from '../api/client';
import StatCard from '../components/StatCard';
import ScoreRing from '../components/ScoreRing';
import SummaryBadge from '../components/SummaryBadge';
import LoadingSpinner from '../components/LoadingSpinner';
import EmptyState from '../components/EmptyState';
import type { ResponseDoc, SSEEvent, SummaryStatus } from '../types';

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmtTime(iso: string) {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return iso;
  }
}

function fmtPct(n: number) {
  return `${(n * 100).toFixed(1)}%`;
}

// ─── Custom recharts tooltip ─────────────────────────────────────────────────
function CustomTooltip({ active, payload, label }: Record<string, unknown>) {
  if (!active || !Array.isArray(payload) || !payload.length) return null;
  return (
    <div style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 6, padding: '8px 12px', fontSize: 12 }}>
      <div style={{ color: 'var(--muted)', marginBottom: 4 }}>{String(label)}</div>
      {(payload as Array<{ name: string; value: number; color: string }>).map(p => (
        <div key={p.name} style={{ color: p.color }}>{p.name}: {p.value}</div>
      ))}
    </div>
  );
}

export default function Overview() {
  const navigate = useNavigate();
  const { showError } = useToast();
  const { stats, loading: statsLoading, refetch: refetchStats } = useStats(5000);
  const [responses, setResponses] = useState<ResponseDoc[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // SSE live updates
  const { connected } = useSSE(useCallback((event: SSEEvent) => {
    if (event.type === 'new_response' && event._id) {
      refetchStats();
      // Prepend to recent list
      setResponses(prev => {
        if (prev.some(r => r._id === event._id)) return prev;
        const newDoc: ResponseDoc = {
          _id: event._id!,
          requestId: event.requestId ?? '',
          model: event.model ?? 'unknown',
          originalText: event.previewText ?? '',
          checkedAt: event.checkedAt ?? new Date().toISOString(),
          claims: [],
          overallScore: event.overallScore ?? 1.0,
          overallConfidence: event.overallConfidence ?? 1.0,
          summaryStatus: event.summaryStatus,
          summaryMessage: event.summaryMessage,
          staleCount: event.staleCount ?? 0,
          totalClaims: event.totalClaims ?? 0,
          fromCache: false,
          processingMs: event.processingMs ?? 0,
          mode: 'inline',
        };
        return [newDoc, ...prev].slice(0, 20);
      });
    } else if (event.type === 'response_updated' && event._id) {
      refetchStats();
      setResponses(prev =>
        prev.map(r =>
          r._id === event._id
            ? {
                ...r,
                overallScore: event.overallScore ?? r.overallScore,
                overallConfidence: event.overallConfidence ?? r.overallConfidence,
                staleCount: event.staleCount ?? r.staleCount,
                totalClaims: event.totalClaims ?? r.totalClaims,
                summaryStatus: event.summaryStatus ?? r.summaryStatus,
                summaryMessage: event.summaryMessage ?? r.summaryMessage,
              }
            : r
        )
      );
    }
  }, [refetchStats]));

  // Load initial responses
  const loadResponses = useCallback(() => {
    setRefreshing(true);
    setFetchError(null);
    api.getResponses(1, 15)
      .then(r => {
        setResponses(r.data);
        setFetchError(null);
      })
      .catch(e => {
        const msg = (e as Error).message || 'Failed to connect to backend';
        setFetchError(msg);
        showError(msg);
      })
      .finally(() => setRefreshing(false));
  }, [showError]);

  useEffect(() => { loadResponses(); }, [loadResponses]);

  // Build hourly chart data (last 24 1h buckets)
  const chartData = (() => {
    if (stats?.hourlyHistory?.length) {
      return stats.hourlyHistory.map(h => ({
        time: h._id.slice(11, 16),
        stale: h.stale,
        current: h.current,
        unverified: h.unverified ?? 0,
        total: h.total,
      }));
    }
    return [];
  })();

  // Calculate average freshness score across loaded responses
  const avgFreshnessScore = (() => {
    if (responses.length === 0) return null;
    const sum = responses.reduce((acc, r) => acc + (r.overallScore ?? 1.0), 0);
    return sum / responses.length;
  })();

  // Sparkline history for stat cards
  const spark = (key: 'stale' | 'current' | 'total') =>
    chartData.length > 0 ? chartData.slice(-7).map(d => d[key]) : undefined;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', maxWidth: 1400 }} className="animate-fade-in">

      {/* ── Header ────────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ marginBottom: 4 }}>Overview</h1>
          <p style={{ fontSize: '0.875rem', color: 'var(--muted)' }}>
            Real-time temporal freshness intelligence &amp; stale claim telemetry across all gateway traffic
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {/* SSE indicator */}
          <span
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontSize: '0.75rem',
              color: connected ? 'var(--current)' : 'var(--muted)',
              background: connected ? 'var(--current-dim)' : 'rgba(139, 150, 165, 0.1)',
              padding: '4px 10px',
              borderRadius: 4,
              border: `1px solid ${connected ? 'rgba(74, 222, 128, 0.3)' : 'var(--border)'}`,
            }}
          >
            <Radio size={12} aria-hidden="true" style={{ animation: connected ? 'pulse 2s infinite' : undefined }} />
            {connected ? 'SSE Stream Active' : 'Connecting to Gateway…'}
          </span>
          <button
            className="btn btn-secondary"
            onClick={() => {
              loadResponses();
              refetchStats();
            }}
            disabled={refreshing}
            aria-label="Refresh responses and statistics"
          >
            <RefreshCw size={14} style={refreshing ? { animation: 'spin 0.75s linear infinite' } : {}} aria-hidden="true" />
            Refresh
          </button>
        </div>
      </div>

      {/* ── Network / Backend Error Banner ─────────────────────────────────────── */}
      {fetchError && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'var(--stale-dim)',
            border: '1px solid var(--stale)',
            borderRadius: 6,
            padding: '12px 16px',
            color: 'var(--text)',
            fontSize: '0.875rem',
          }}
          role="alert"
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <AlertCircle size={18} color="var(--stale)" />
            <span><strong>Backend Connection Error:</strong> {fetchError}. Ensure FreshnessGuard backend is running on port 3001.</span>
          </div>
          <button className="btn btn-secondary" onClick={loadResponses} style={{ padding: '4px 12px', fontSize: '0.8125rem' }}>
            Retry Connection
          </button>
        </div>
      )}

      {/* ── KPI Cards ─────────────────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
        <StatCard
          label="Total Scanned"
          value={statsLoading ? '—' : (stats?.totalScanned ?? 0).toLocaleString()}
          sparkData={spark('total')}
          color="var(--accent)"
          loading={statsLoading}
        />
        <StatCard
          label="Total Claims Detected"
          value={statsLoading ? '—' : (stats?.totalClaims ?? 0).toLocaleString()}
          sparkData={undefined}
          color="var(--accent)"
          loading={statsLoading}
        />
        <StatCard
          label="Current Claims"
          value={statsLoading ? '—' : (stats?.totalCurrent ?? 0).toLocaleString()}
          sparkData={spark('current')}
          color="var(--current)"
          loading={statsLoading}
        />
        <StatCard
          label="Stale Claims Caught"
          value={statsLoading ? '—' : (stats?.totalStale ?? 0).toLocaleString()}
          sparkData={spark('stale')}
          color="var(--stale)"
          loading={statsLoading}
        />
        <StatCard
          label="Unverified Claims"
          value={statsLoading ? '—' : (stats?.totalUnverified ?? 0).toLocaleString()}
          sparkData={undefined}
          color="var(--unverified)"
          loading={statsLoading}
        />
        <StatCard
          label="Avg Freshness Score"
          value={avgFreshnessScore !== null ? `${Math.round(avgFreshnessScore * 100)}%` : '—'}
          color="var(--current)"
          loading={refreshing && responses.length === 0}
        />
        <StatCard
          label="P95 Verification Latency"
          value={statsLoading ? '—' : (stats?.p95ProcessingMs ?? 0)}
          unit="ms"
          color="var(--muted)"
          loading={statsLoading}
          trendLabel={stats ? `avg ${stats.avgProcessingMs}ms · cache ${(stats.cacheHitRate * 100).toFixed(0)}%` : undefined}
        />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

        {/* ── Claims Over Time chart ──────────────────────────────────────────── */}
        <div className="panel">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
            <h2 style={{ fontSize: '0.9375rem' }}>Hourly Factual Claim Telemetry (Last 24 Hours)</h2>
            <span style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>Live Web Corroboration via Tavily API</span>
          </div>
          {chartData.length === 0 ? (
            <div style={{ height: 220, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)', fontSize: '0.875rem', gap: 6 }}>
              <span>No claim activity recorded in the last 24 hours.</span>
              <span style={{ fontSize: '0.75rem', color: 'var(--dim)' }}>Verified AI gateway requests and playground queries will populate this trend in real time.</span>
            </div>
          ) : (
            <div style={{ height: 220 }} aria-label="Area chart of claims over time" role="img">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gStale" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--stale)" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="var(--stale)" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="gCurrent" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--current)" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="var(--current)" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="gUnverified" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--unverified)" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="var(--unverified)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="time" tick={{ fill: 'var(--muted)', fontSize: 11 }} tickLine={false} axisLine={false} interval={3} />
                  <YAxis tick={{ fill: 'var(--muted)', fontSize: 11 }} tickLine={false} axisLine={false} />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, paddingTop: 8, color: 'var(--muted)' }} />
                  <Area type="monotone" dataKey="stale" name="Stale" stroke="var(--stale)" fill="url(#gStale)" strokeWidth={2} dot={false} />
                  <Area type="monotone" dataKey="current" name="Current" stroke="var(--current)" fill="url(#gCurrent)" strokeWidth={2} dot={false} />
                  <Area type="monotone" dataKey="unverified" name="Unverified" stroke="var(--unverified)" fill="url(#gUnverified)" strokeWidth={1.5} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* ── Recent Responses Table ─────────────────────────────────────────── */}
        <div className="panel" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <h2 style={{ fontSize: '0.9375rem', marginBottom: 2 }}>Recent Gateway &amp; Playground Responses</h2>
              <p style={{ fontSize: '0.75rem', color: 'var(--muted)', margin: 0 }}>Click any response to open deep inspection</p>
            </div>
            <span className="badge badge-muted">{responses.length} responses displayed</span>
          </div>

          {responses.length === 0 && !refreshing && !fetchError && (
            <EmptyState
              message="No verification records yet"
              detail="Send an AI response through Bifrost or submit a sample prompt in the Playground to see verification results here."
            />
          )}

          {refreshing && responses.length === 0 && (
            <LoadingSpinner label="Loading verification telemetry" />
          )}

          {responses.length > 0 && (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }} aria-label="Recent LLM responses">
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    {['Timestamp', 'Model & Mode', 'Freshness Score', 'Summary Status', 'Claims Ratio', 'Response Preview'].map(h => (
                      <th
                        key={h}
                        style={{
                          padding: '0.625rem 1rem',
                          textAlign: 'left',
                          fontSize: '0.6875rem',
                          fontWeight: 600,
                          color: 'var(--muted)',
                          letterSpacing: '0.05em',
                          textTransform: 'uppercase',
                        }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {responses.map(r => (
                    <tr
                      key={r._id}
                      onClick={() => navigate(`/inspector/${r._id}`)}
                      onKeyDown={e => e.key === 'Enter' && navigate(`/inspector/${r._id}`)}
                      tabIndex={0}
                      role="button"
                      aria-label={`View response from ${r.model}`}
                      style={{
                        borderBottom: '1px solid var(--border)',
                        cursor: 'pointer',
                        transition: 'background var(--transition)',
                      }}
                      onMouseEnter={e => (e.currentTarget.style.background = 'var(--panel-hover)')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                    >
                      {/* Timestamp */}
                      <td style={{ padding: '0.75rem 1rem', fontSize: '0.8125rem', color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                        {fmtTime(r.checkedAt)}
                      </td>

                      {/* Model & Mode */}
                      <td style={{ padding: '0.75rem 1rem', fontSize: '0.8125rem', whiteSpace: 'nowrap' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontWeight: 600, color: 'var(--text)' }}>{r.model}</span>
                          <span className={`badge ${r.mode === 'bypass' ? 'badge-muted' : r.mode === 'basic' ? 'badge-unverified' : 'badge-accent'}`}>
                            {r.mode}
                          </span>
                        </div>
                      </td>

                      {/* Freshness Score */}
                      <td style={{ padding: '0.75rem 1rem', whiteSpace: 'nowrap' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <ScoreRing score={r.overallScore} size={34} strokeWidth={3.5} />
                          <span style={{ fontSize: '0.8125rem', fontFamily: 'var(--font-mono)' }}>
                            {(r.overallScore * 100).toFixed(0)}%
                          </span>
                        </div>
                      </td>

                      {/* Summary Status */}
                      <td style={{ padding: '0.75rem 1rem', whiteSpace: 'nowrap' }}>
                        <SummaryBadge
                          status={r.summaryStatus ?? (r.totalClaims === 0 ? 'no_claims' : r.staleCount > 0 ? 'stale_detected' : 'all_fresh')}
                          message={r.summaryMessage}
                          size="sm"
                        />
                      </td>

                      {/* Claims Ratio */}
                      <td style={{ padding: '0.75rem 1rem', fontSize: '0.8125rem', whiteSpace: 'nowrap' }}>
                        {r.totalClaims === 0 ? (
                          <span style={{ color: 'var(--muted)', fontSize: '0.75rem' }}>0 claims</span>
                        ) : (
                          <span>
                            <span style={{ color: r.staleCount > 0 ? 'var(--stale)' : 'var(--current)', fontWeight: 600 }}>
                              {r.staleCount} stale
                            </span>
                            <span style={{ color: 'var(--muted)' }}> / {r.totalClaims} total</span>
                          </span>
                        )}
                      </td>

                      {/* Response Preview */}
                      <td style={{ padding: '0.75rem 1rem', fontSize: '0.8125rem', maxWidth: 360 }}>
                        <p className="truncate" style={{ margin: 0, color: 'var(--muted)', fontSize: '0.8125rem' }}>
                          {r.originalText}
                        </p>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
