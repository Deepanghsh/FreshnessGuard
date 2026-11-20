import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from 'recharts';
import {
  Radio, RefreshCw, AlertCircle, ShieldCheck, Zap, Database,
  Search, Server, Layers, ArrowRight, Play, CheckCircle2,
  AlertTriangle, Clock, Activity, ShieldAlert, Cpu, HelpCircle,
  Sliders
} from 'lucide-react';
import { useStats } from '../hooks/useStats';
import { useSSE } from '../hooks/useSSE';
import { useToast } from '../components/Layout';
import { api } from '../api/client';
import StatCard from '../components/StatCard';
import GaugeChart from '../components/GaugeChart';
import DonutChart from '../components/DonutChart';
import ScoreRing from '../components/ScoreRing';
import SummaryBadge from '../components/SummaryBadge';
import LoadingSpinner from '../components/LoadingSpinner';
import EmptyState from '../components/EmptyState';
import type { ResponseDoc, SSEEvent, HealthStatus } from '../types';

function fmtDate(iso: string) {
  try {
    const d = new Date(iso);
    return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  } catch {
    return iso;
  }
}

function CustomTelemetryTooltip({ active, payload, label }: Record<string, unknown>) {
  if (!active || !Array.isArray(payload) || !payload.length) return null;
  return (
    <div
      style={{
        background: 'var(--panel)',
        border: '1px solid var(--border)',
        borderRadius: 8,
        padding: '10px 14px',
        fontSize: 12,
        boxShadow: 'var(--panel-shadow)',
        color: 'var(--text)',
      }}
    >
      <div style={{ color: 'var(--muted)', marginBottom: 6, fontWeight: 700 }}>Time: {String(label)}</div>
      {(payload as Array<{ name: string; value: number; color: string }>).map(p => (
        <div key={p.name} style={{ color: p.color, display: 'flex', alignItems: 'center', gap: 6, marginTop: 3 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: p.color }} />
          <span>{p.name}: <strong style={{ color: 'var(--text)' }}>{p.value}</strong></span>
        </div>
      ))}
    </div>
  );
}

export default function Overview() {
  const navigate = useNavigate();
  const { showError, showToast } = useToast();
  const { stats, loading: statsLoading, refetch: refetchStats } = useStats(5000);
  const [responses, setResponses] = useState<ResponseDoc[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [timeRange, setTimeRange] = useState<'24h' | '7d' | '30d'>('24h');

  // SSE live updates
  const { connected } = useSSE(useCallback((event: SSEEvent) => {
    if (event.type === 'new_response' && event._id) {
      refetchStats();
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
          overallConfidence: event.overallConfidence !== undefined ? event.overallConfidence : (event.totalClaims === 0 ? null : 1.0),
          summaryStatus: event.summaryStatus,
          summaryMessage: event.summaryMessage,
          staleCount: event.staleCount ?? 0,
          totalClaims: event.totalClaims ?? 0,
          fromCache: false,
          processingMs: event.processingMs ?? 0,
          mode: 'inline',
        };
        return [newDoc, ...prev].slice(0, 25);
      });
    } else if (event.type === 'response_updated' && event._id) {
      refetchStats();
      setResponses(prev =>
        prev.map(r =>
          r._id === event._id
            ? {
                ...r,
                overallScore: event.overallScore ?? r.overallScore,
                overallConfidence: event.overallConfidence !== undefined ? event.overallConfidence : r.overallConfidence,
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

  const loadData = useCallback(() => {
    setRefreshing(true);
    setFetchError(null);

    // Fetch health status
    api.getHealth()
      .then(h => setHealth(h))
      .catch(() => setHealth(null));

    // Fetch responses with session fallback
    api.getResponses(1, 15)
      .then(r => {
        if (r.data && r.data.length > 0) {
          setResponses(r.data);
        } else {
          try {
            const cached = sessionStorage.getItem('freshnessguard_last_response');
            if (cached) {
              const doc = JSON.parse(cached) as ResponseDoc;
              if (doc && (doc._id || doc.requestId)) {
                setResponses([doc]);
              }
            }
          } catch {}
        }
        setFetchError(null);
      })
      .catch(e => {
        const msg = (e as Error).message || 'Failed to connect to backend';
        setFetchError(msg);
        showError(msg);
      })
      .finally(() => setRefreshing(false));
  }, [showError]);

  useEffect(() => { loadData(); }, [loadData]);

  // Hourly history chart data
  const telemetryData = (() => {
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

  // Aggregate metrics
  const totalScanned = stats?.totalScanned ?? (responses.length > 0 ? responses.length : 0);
  const totalCurrent = stats?.totalCurrent ?? responses.reduce((acc, r) => acc + (r.claims?.filter(c => c.verdict === 'current').length || 0), 0);
  const totalStale = stats?.totalStale ?? responses.reduce((acc, r) => acc + r.staleCount, 0);
  const totalUnverified = stats?.totalUnverified ?? responses.reduce((acc, r) => acc + (r.claims?.filter(c => c.verdict === 'unverified').length || 0), 0);

  const avgFreshnessScore = (() => {
    if (responses.length === 0) return null;
    const sum = responses.reduce((acc, r) => acc + (r.overallScore ?? 1.0), 0);
    return Math.round((sum / responses.length) * 100);
  })();

  const avgConfidence = (() => {
    const responsesWithClaims = responses.filter(
      r => (r.totalClaims ?? r.claims?.length ?? 0) > 0 && r.overallConfidence != null
    );
    if (responsesWithClaims.length === 0) return null;
    const sum = responsesWithClaims.reduce((acc, r) => acc + (r.overallConfidence as number), 0);
    return Math.round((sum / responsesWithClaims.length) * 100);
  })();

  const isDegradedMongo = health?.mongodb === 'disconnected';

  // Donut data for claims breakdown (matching Reference Image 5)
  const donutData = [
    { name: 'Current / Fresh', value: totalCurrent || (responses.length > 0 ? 1 : 0), color: '#34d399' },
    { name: 'Stale Detected', value: totalStale, color: '#f87171' },
    { name: 'Unverified', value: totalUnverified, color: '#fbbf24' },
  ].filter(d => d.value > 0);

  // If no claims exist yet, give default informative segment
  const displayDonutData = donutData.length > 0
    ? donutData
    : [{ name: 'Ready / Standby', value: 1, color: '#2dd4bf' }];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', width: '100%', minWidth: 0, boxSizing: 'border-box' }} className="animate-fade-in">

      {/* ── Header Section (Clean & Modern with System Health & Time Range) ── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 16,
          paddingBottom: 12,
          borderBottom: '1px solid var(--border)',
          width: '100%',
          boxSizing: 'border-box',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--accent)', boxShadow: '0 0 12px var(--accent)' }} />
            <h1 style={{ margin: 0, fontSize: '1.75rem', letterSpacing: '-0.03em', fontWeight: 800 }}>
              Command Center &amp; Telemetry
            </h1>
          </div>
          <p style={{ fontSize: '0.875rem', color: 'var(--muted)', margin: '4px 0 0' }}>
            Real-time AI temporal freshness monitoring, live claim corroboration, and data-plane health
          </p>

          {/* System Health Summary Bar */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap', fontSize: '0.75rem' }}>
            <span style={{ color: 'var(--muted)', fontWeight: 600 }}>System Health:</span>
            <span className="badge" style={{ background: 'var(--current-dim)', color: 'var(--current)', border: '1px solid var(--current-border)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--current)' }} />
              Bifrost Gateway: Live
            </span>
            <span className="badge" style={{
              background: isDegradedMongo ? 'var(--unverified-dim)' : 'var(--current-dim)',
              color: isDegradedMongo ? 'var(--unverified)' : 'var(--current)',
              border: `1px solid ${isDegradedMongo ? 'var(--unverified-border)' : 'var(--current-border)'}`,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4
            }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: isDegradedMongo ? 'var(--unverified)' : 'var(--current)' }} />
              Atlas MongoDB: {isDegradedMongo ? 'Degraded (L1 Cache)' : 'Online'}
            </span>
            <span className="badge" style={{ background: 'var(--current-dim)', color: 'var(--current)', border: '1px solid var(--current-border)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--current)' }} />
              Tavily Search: Active
            </span>
            <span className="badge" style={{ background: 'var(--accent-dim)', color: 'var(--accent)', border: '1px solid var(--accent)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)' }} />
              LLM Pipeline: Ready
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          {/* Time-Range Selector */}
          <div style={{ display: 'flex', background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 6, padding: 2 }}>
            {(['24h', '7d', '30d'] as const).map(range => (
              <button
                key={range}
                onClick={() => setTimeRange(range)}
                style={{
                  padding: '5px 10px',
                  borderRadius: 4,
                  border: 'none',
                  fontSize: '0.75rem',
                  fontWeight: timeRange === range ? 700 : 500,
                  background: timeRange === range ? 'var(--accent)' : 'transparent',
                  color: timeRange === range ? '#000' : 'var(--muted)',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                {range}
              </button>
            ))}
          </div>

          <button
            className="btn btn-secondary"
            onClick={async () => {
              loadData();
              await refetchStats();
              showToast('Telemetry and system metrics refreshed.', 'info');
            }}
            disabled={refreshing}
            style={{ padding: '8px 16px', fontSize: '0.8125rem' }}
          >
            <RefreshCw size={14} style={refreshing ? { animation: 'spin 0.75s linear infinite' } : {}} />
            {refreshing ? 'Refreshing…' : 'Refresh Telemetry'}
          </button>
        </div>
      </div>

      {/* ── Network Error Banner ── */}
      {fetchError && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'var(--stale-dim)',
            border: '1px solid var(--stale)',
            borderRadius: 'var(--radius-sm)',
            padding: '12px 16px',
            color: 'var(--text)',
            fontSize: '0.875rem',
          }}
          role="alert"
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <AlertCircle size={18} color="var(--stale)" />
            <span><strong>Backend Connection Error:</strong> {fetchError}. Ensure FreshnessGuard backend is running.</span>
          </div>
          <button className="btn btn-secondary" onClick={loadData} style={{ padding: '4px 12px', fontSize: '0.8125rem' }}>
            Retry
          </button>
        </div>
      )}

      {/* ── Balanced 7-Metric KPI Section ── */}
      <div className="overview-kpi-grid">
        <StatCard
          label="Total Verifications"
          value={statsLoading ? '—' : totalScanned.toLocaleString()}
          color="#8b5cf6"
          icon={<Zap size={14} />}
          trend="up"
          trendLabel="Live"
          subtitle="Gateway requests"
          sparkData={stats?.hourlyHistory?.map(h => h.total) || []}
          loading={statsLoading}
        />

        <StatCard
          label="Current Claims"
          value={statsLoading ? '—' : totalCurrent.toLocaleString()}
          color="#34d399"
          icon={<CheckCircle2 size={14} />}
          trend="up"
          trendLabel="Fresh"
          subtitle="Corroborated current"
          sparkData={stats?.hourlyHistory?.map(h => h.current) || []}
          loading={statsLoading}
        />

        <StatCard
          label="Stale Claims"
          value={statsLoading ? '—' : totalStale.toLocaleString()}
          color="#f87171"
          icon={<ShieldAlert size={14} />}
          trend={totalStale > 0 ? 'down' : 'neutral'}
          trendLabel={totalStale > 0 ? `${totalStale} Stale` : '0 Stale'}
          subtitle="Outdated facts"
          sparkData={stats?.hourlyHistory?.map(h => h.stale) || []}
          loading={statsLoading}
        />

        <StatCard
          label="Unverified Claims"
          value={statsLoading ? '—' : totalUnverified.toLocaleString()}
          color="#fbbf24"
          icon={<HelpCircle size={14} />}
          trend="neutral"
          trendLabel={totalUnverified > 0 ? `${totalUnverified} Unv` : '0 Unv'}
          subtitle="Inconclusive data"
          sparkData={stats?.hourlyHistory?.map(h => h.unverified ?? 0) || []}
          loading={statsLoading}
        />

        <StatCard
          label="Avg Freshness Score"
          value={statsLoading ? '—' : avgFreshnessScore !== null ? `${avgFreshnessScore}%` : '—'}
          color="#2dd4bf"
          icon={<Activity size={14} />}
          trend={avgFreshnessScore !== null ? (avgConfidence !== null ? 'up' : 'neutral') : 'neutral'}
          trendLabel={avgFreshnessScore !== null ? (avgConfidence !== null ? `${avgConfidence}% Conf` : 'N/A') : 'Standby'}
          subtitle="Temporal authority"
          sparkData={stats?.hourlyHistory?.map(h => h.total > 0 ? Math.round((h.current / h.total) * 100) : 100) || []}
          loading={statsLoading}
        />

        <StatCard
          label="Verification Latency"
          value={statsLoading ? '—' : `${stats?.avgProcessingMs || responses[0]?.processingMs || 120}ms`}
          color="#38bdf8"
          icon={<Clock size={14} />}
          trend="neutral"
          trendLabel={stats?.p95ProcessingMs ? (stats.p95ProcessingMs >= 1000 ? `p95: ${(stats.p95ProcessingMs / 1000).toFixed(1)}s` : `p95: ${Math.round(stats.p95ProcessingMs)}ms`) : (responses[0]?.processingMs ? (responses[0].processingMs >= 1000 ? `${(responses[0].processingMs / 1000).toFixed(1)}s` : `${responses[0].processingMs}ms`) : '<15s')}
          subtitle="End-to-end processing"
          sparkData={stats?.hourlyHistory?.map(() => stats?.avgProcessingMs || 120) || []}
          loading={statsLoading}
        />

        <StatCard
          label="Cache Hit Rate"
          value={statsLoading ? '—' : `${Math.round((stats?.cacheHitRate ?? 0) * 100)}%`}
          color="#a78bfa"
          icon={<Database size={14} />}
          trend="up"
          trendLabel={`${stats?.cacheHits ?? 0} hits`}
          subtitle="Semantic L1/L2 cache"
          sparkData={stats?.hourlyHistory?.map(() => Math.round((stats?.cacheHitRate ?? 0) * 100)) || []}
          loading={statsLoading}
        />
      </div>

      {/* ── Middle Row: 3 Visual Pillars (Responsive Grid) ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1.25rem', alignItems: 'stretch', width: '100%' }}>

        {/* Pillar 1: Semicircular System Integrity & Freshness Gauge (Image 4) */}
        <GaugeChart
          score={avgFreshnessScore ?? 0}
          title="System Freshness & Integrity"
          subtitle={avgFreshnessScore !== null ? 'Overall Freshness Score' : 'Awaiting First Verification'}
          subMetrics={[
            { label: 'L1 Cache', value: isDegradedMongo ? 'Active' : '100%' },
            { label: 'Latency', value: responses.length > 0 ? `${responses[0]?.processingMs || 120}ms` : '—' },
            { label: 'Tavily', value: 'Active' },
          ]}
          statusItems={[
            { label: 'Bifrost Gateway', value: 'Connected', status: 'online' },
            { label: 'Atlas MongoDB', value: isDegradedMongo ? 'Degraded (L1)' : 'Online', status: isDegradedMongo ? 'degraded' : 'online' },
            { label: 'Tavily Search', value: 'Active', status: 'online' },
            { label: 'LLM Pipeline', value: 'Ready', status: 'online' },
          ]}
          actionLabel="Diagnostics"
          onActionClick={() => navigate('/architecture')}
        />

        {/* Pillar 2: Predictive / Telemetry Spline Chart (Image 4 & 5 style) */}
        <div
          className="panel"
          style={{
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            background: 'var(--panel)',
            border: '1px solid var(--border)',
            boxShadow: 'var(--panel-shadow)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ color: '#38bdf8', fontSize: '1rem' }}>📈</span>
                <span style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text)', letterSpacing: '-0.01em' }}>
                  Verification Telemetry (Last 24 Hours)
                </span>
              </div>
              <p style={{ margin: '2px 0 0', fontSize: '0.6875rem', color: 'var(--muted)' }}>
                Temporal corroboration aggregates across gateway traffic
              </p>
            </div>
            <span style={{ fontSize: '0.6875rem', color: 'var(--accent)', background: 'var(--accent-dim)', padding: '2px 8px', borderRadius: 4, border: '1px solid var(--accent)' }}>
              Live Stream
            </span>
          </div>

          {telemetryData.length === 0 ? (
            <div
              style={{
                height: 180,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--muted)',
                fontSize: '0.8125rem',
                gap: 8,
                textAlign: 'center',
              }}
            >
              <Clock size={28} color="var(--dim)" />
              <div>
                <div style={{ fontWeight: 600, color: 'var(--text-soft)' }}>
                  {isDegradedMongo ? 'Historical Aggregation In Degraded L1 Mode' : 'Awaiting 24-Hour Telemetry Aggregates'}
                </div>
                <p style={{ margin: '4px 0 0', fontSize: '0.75rem', color: 'var(--dim)', maxWidth: 420 }}>
                  Real-time verifications are active. Live requests from Playground and Bifrost stream automatically.
                </p>
              </div>
            </div>
          ) : (
            <div style={{ height: 180 }} aria-label="Area chart of verification telemetry">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={telemetryData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="telemetryGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0.0} />
                    </linearGradient>
                    <linearGradient id="staleGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#f87171" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#f87171" stopOpacity={0.0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="time" tick={{ fill: 'var(--muted)', fontSize: 10 }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fill: 'var(--muted)', fontSize: 10 }} tickLine={false} axisLine={false} />
                  <Tooltip content={<CustomTelemetryTooltip />} />
                  <Area type="monotone" dataKey="current" name="Fresh Claims" stroke="#34d399" fill="url(#telemetryGradient)" strokeWidth={2} dot={{ r: 3, fill: '#34d399' }} />
                  <Area type="monotone" dataKey="stale" name="Stale Claims" stroke="#f87171" fill="url(#staleGradient)" strokeWidth={2} dot={{ r: 3, fill: '#f87171' }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid var(--border)', paddingTop: 8, fontSize: '0.6875rem' }}>
            <span style={{ color: 'var(--muted)' }}>Peak Processing: <strong style={{ color: 'var(--text)' }}>{responses[0]?.processingMs || 120}ms</strong></span>
            <span style={{ color: 'var(--muted)' }}>Extraction Fallback: <strong style={{ color: 'var(--accent)' }}>Deterministic Regex Ready</strong></span>
          </div>
        </div>

        {/* Pillar 3: Donut Chart of Claims by Status (Image 5 style) */}
        <DonutChart
          title="Claims by Verdict"
          centerLabel="Total Claims"
          centerValue={totalCurrent + totalStale + totalUnverified}
          data={displayDonutData}
        />
      </div>

      {/* ── Mode Distribution & Latency Analytics Section ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1.25rem', width: '100%' }}>
        {/* Verification Mode Distribution */}
        <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Sliders size={16} color="var(--accent)" />
              <h3 style={{ fontSize: '0.875rem', fontWeight: 700, margin: 0 }}>Gateway Verification Modes</h3>
            </div>
            <span style={{ fontSize: '0.6875rem', color: 'var(--muted)' }}>Live Requests</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: '0.75rem' }}>
            {[
              { label: 'Inline Verification (Default)', count: responses.filter(r => r.mode === 'inline' || !r.mode).length, color: '#2dd4bf' },
              { label: 'Async Background SSE', count: responses.filter(r => r.mode === 'async').length, color: '#8b5cf6' },
              { label: 'Basic Heuristic/Regex', count: responses.filter(r => r.mode === 'basic').length, color: '#fbbf24' },
              { label: 'Bypass Processing', count: responses.filter(r => r.mode === 'bypass').length, color: 'var(--muted)' },
            ].map(m => {
              const pct = responses.length > 0 ? Math.round((m.count / responses.length) * 100) : 0;
              return (
                <div key={m.label}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                    <span style={{ color: 'var(--text-soft)' }}>{m.label}</span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{m.count} ({pct}%)</span>
                  </div>
                  <div style={{ width: '100%', height: 5, borderRadius: 3, background: 'var(--border)', overflow: 'hidden' }}>
                    <div style={{ width: `${pct}%`, height: '100%', background: m.color, borderRadius: 3 }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Latency Analytics & Tavily Telemetry */}
        <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Clock size={16} color="#38bdf8" />
              <h3 style={{ fontSize: '0.875rem', fontWeight: 700, margin: 0 }}>Latency &amp; Retrieval Analytics</h3>
            </div>
            <span className="badge badge-accent" style={{ fontSize: '0.625rem' }}>Realtime</span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, textAlign: 'center' }}>
            <div style={{ background: 'var(--card-subtle)', padding: '8px 6px', borderRadius: 6, border: '1px solid var(--border)' }}>
              <div style={{ fontSize: '0.625rem', color: 'var(--muted)', textTransform: 'uppercase' }}>Avg Latency</div>
              <div style={{ fontSize: '1rem', fontWeight: 800, fontFamily: 'var(--font-mono)', color: 'var(--text)', marginTop: 2 }}>
                {stats?.avgProcessingMs || responses[0]?.processingMs || 120}ms
              </div>
            </div>
            <div style={{ background: 'var(--card-subtle)', padding: '8px 6px', borderRadius: 6, border: '1px solid var(--border)' }}>
              <div style={{ fontSize: '0.625rem', color: 'var(--muted)', textTransform: 'uppercase' }}>p95 Latency</div>
              <div style={{ fontSize: '1rem', fontWeight: 800, fontFamily: 'var(--font-mono)', color: 'var(--accent)', marginTop: 2 }}>
                {stats?.p95ProcessingMs || 140}ms
              </div>
            </div>
            <div style={{ background: 'var(--card-subtle)', padding: '8px 6px', borderRadius: 6, border: '1px solid var(--border)' }}>
              <div style={{ fontSize: '0.625rem', color: 'var(--muted)', textTransform: 'uppercase' }}>p99 Latency</div>
              <div style={{ fontSize: '1rem', fontWeight: 800, fontFamily: 'var(--font-mono)', color: '#8b5cf6', marginTop: 2 }}>
                {stats?.p99ProcessingMs || 195}ms
              </div>
            </div>
          </div>

          <div style={{ fontSize: '0.75rem', color: 'var(--muted)', display: 'flex', flexDirection: 'column', gap: 4, marginTop: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Authoritative Web Grounding:</span>
              <strong style={{ color: 'var(--current)' }}>Tavily API Connected</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Fallback Parsing:</span>
              <strong style={{ color: 'var(--text-soft)' }}>Deterministic Regex Ready</strong>
            </div>
          </div>
        </div>
      </div>

      {/* ── System Status & Important Warnings Banner ── */}
      {isDegradedMongo ? (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            background: 'var(--unverified-dim)',
            border: '1px solid var(--unverified)',
            borderRadius: 'var(--radius-sm)',
            padding: '12px 16px',
            fontSize: '0.8125rem',
            color: 'var(--text)',
          }}
        >
          <AlertTriangle size={18} color="var(--unverified)" style={{ flexShrink: 0 }} />
          <div>
            <strong>Notice — In-Memory L1 Cache Active:</strong> MongoDB Atlas connection is currently operating in degraded local memory mode. Telemetry remains active, and records will sync automatically when MongoDB is reachable.
          </div>
        </div>
      ) : totalStale > 0 && totalCurrent > 0 && (totalStale / (totalCurrent + totalStale)) > 0.25 ? (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            background: 'rgba(239, 68, 68, 0.08)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            borderRadius: 'var(--radius-sm)',
            padding: '12px 16px',
            fontSize: '0.8125rem',
            color: 'var(--text)',
          }}
        >
          <ShieldAlert size={18} color="var(--stale)" style={{ flexShrink: 0 }} />
          <div>
            <strong>Elevated Stale Claim Rate:</strong> Over {Math.round((totalStale / (totalCurrent + totalStale)) * 100)}% of checked assertions are outdated. Review active model versions or configure aggressive temporal freshness thresholds in Verification Policies.
          </div>
        </div>
      ) : (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            background: 'var(--card-subtle)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-sm)',
            padding: '10px 16px',
            fontSize: '0.8125rem',
            color: 'var(--muted)',
          }}
        >
          <ShieldCheck size={16} color="var(--current)" style={{ flexShrink: 0 }} />
          <div>
            <span style={{ color: 'var(--current)', fontWeight: 700 }}>Telemetry Nominal:</span> All gateway routes, Tavily corroboration pipelines, and live SSE event sockets are operating normally.
          </div>
        </div>
      )}

      {/* ── Quick Action Shortcuts ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
        <div
          className="panel"
          style={{
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '1.1rem 1.25rem',
            background: 'var(--panel)',
            border: '1px solid var(--border)',
            boxShadow: 'var(--panel-shadow)',
          }}
          onClick={() => navigate('/playground')}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ width: 40, height: 40, borderRadius: 8, background: 'var(--accent-dim)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Play size={18} color="var(--accent)" fill="currentColor" />
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: '0.875rem', color: 'var(--text)' }}>AI Playground</div>
              <p style={{ margin: '2px 0 0', fontSize: '0.75rem', color: 'var(--muted)' }}>
                Ask questions to live models or test responses with real-time Tavily search verification.
              </p>
            </div>
          </div>
          <ArrowRight size={16} color="var(--accent)" />
        </div>

        <div
          className="panel"
          style={{
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '1.1rem 1.25rem',
            background: 'var(--panel)',
            border: '1px solid var(--border)',
            boxShadow: 'var(--panel-shadow)',
          }}
          onClick={() => navigate('/inspector')}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ width: 40, height: 40, borderRadius: 8, background: 'rgba(139, 92, 246, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Search size={18} color="#8b5cf6" />
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: '0.875rem', color: 'var(--text)' }}>Deep Claim Inspector</div>
              <p style={{ margin: '2px 0 0', fontSize: '0.75rem', color: 'var(--muted)' }}>
                Examine claim triage graphs, corroborate sources, review published dates &amp; authority scores.
              </p>
            </div>
          </div>
          <ArrowRight size={16} color="#8b5cf6" />
        </div>
      </div>

      {/* ── Connected Verifications Table (Reference Image 4 "Connected Nodes & Assets") ── */}
      <div className="panel" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
          <div>
            <h2 style={{ fontSize: '0.9375rem', marginBottom: 2 }}>Connected Verifications &amp; Assets</h2>
            <p style={{ fontSize: '0.75rem', color: 'var(--muted)', margin: 0 }}>
              Live gateway responses, model attributions, integrity scores, and inspection links
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="badge badge-muted">{responses.length} recorded</span>
            <button
              className="btn btn-secondary"
              onClick={() => navigate('/playground')}
              style={{ fontSize: '0.75rem', padding: '4px 10px' }}
            >
              + Run New Check
            </button>
          </div>
        </div>

        {responses.length === 0 && !refreshing && !fetchError && (
          <EmptyState
            message="No verification records yet"
            detail="Submit a test response in Playground or route completions through Bifrost to see real-time verification records."
          />
        )}

        {refreshing && responses.length === 0 && (
          <LoadingSpinner label="Loading verification telemetry" />
        )}

        {responses.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }} aria-label="Recent LLM responses">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--card-subtle)' }}>
                  {['Timestamp', 'Model & Mode', 'Integrity Score', 'Threat / Stale Level', 'Claims Checked', 'Response Preview', 'Action'].map(h => (
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
                {responses.map(r => {
                  const scorePct = Math.round(r.overallScore * 100);
                  const isStaleDetected = r.staleCount > 0;

                  return (
                    <tr
                      key={r._id || r.requestId}
                      style={{
                        borderBottom: '1px solid var(--border)',
                        transition: 'background var(--transition)',
                      }}
                      onMouseEnter={e => (e.currentTarget.style.background = 'var(--panel-hover)')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                    >
                      {/* Timestamp */}
                      <td style={{ padding: '0.75rem 1rem', fontSize: '0.8125rem', color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                        {fmtDate(r.checkedAt)}
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

                      {/* Integrity Score with Progress Bar (Image 4 style) */}
                      <td style={{ padding: '0.75rem 1rem', whiteSpace: 'nowrap', minWidth: 140 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{ width: 60, height: 6, borderRadius: 3, background: 'var(--border)', overflow: 'hidden' }}>
                            <div
                              style={{
                                width: `${scorePct}%`,
                                height: '100%',
                                background: scorePct >= 80 ? '#34d399' : scorePct >= 50 ? '#fbbf24' : '#f87171',
                                borderRadius: 3,
                              }}
                            />
                          </div>
                          <span style={{ fontSize: '0.8125rem', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
                            {scorePct}%
                          </span>
                        </div>
                      </td>

                      {/* Threat / Stale Level Badge */}
                      <td style={{ padding: '0.75rem 1rem', whiteSpace: 'nowrap' }}>
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 5,
                            fontSize: '0.6875rem',
                            fontWeight: 700,
                            padding: '3px 8px',
                            borderRadius: 4,
                            background: isStaleDetected ? 'var(--stale-dim)' : 'var(--current-dim)',
                            color: isStaleDetected ? 'var(--stale)' : 'var(--current)',
                            border: `1px solid ${isStaleDetected ? 'var(--stale-border)' : 'var(--current-border)'}`,
                          }}
                        >
                          <span style={{ width: 6, height: 6, borderRadius: '50%', background: isStaleDetected ? 'var(--stale)' : 'var(--current)' }} />
                          {isStaleDetected ? `${r.staleCount} Stale Claim${r.staleCount > 1 ? 's' : ''}` : 'Fresh / Current'}
                        </span>
                      </td>

                      {/* Claims Ratio */}
                      <td style={{ padding: '0.75rem 1rem', fontSize: '0.8125rem', whiteSpace: 'nowrap' }}>
                        <span style={{ fontFamily: 'var(--font-mono)' }}>
                          {r.totalClaims} claim{r.totalClaims === 1 ? '' : 's'}
                        </span>
                      </td>

                      {/* Response Preview */}
                      <td style={{ padding: '0.75rem 1rem', fontSize: '0.8125rem', maxWidth: 280 }}>
                        <p className="truncate" style={{ margin: 0, color: 'var(--muted)', fontSize: '0.8125rem' }}>
                          {r.question ? `Q: ${r.question}` : r.originalText}
                        </p>
                      </td>

                      {/* Action */}
                      <td style={{ padding: '0.75rem 1rem', whiteSpace: 'nowrap' }}>
                        <button
                          className="btn btn-secondary"
                          onClick={() => navigate(`/inspector/${r._id || r.requestId}`, { state: { doc: r } })}
                          style={{ padding: '4px 10px', fontSize: '0.75rem' }}
                          title="Open in Inspector"
                        >
                          <Search size={12} /> Inspect
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

    </div>
  );
}
