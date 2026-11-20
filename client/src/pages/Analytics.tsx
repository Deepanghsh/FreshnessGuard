import React, { useState, useEffect } from 'react';
import {
  BarChart3, TrendingUp, Clock, Zap, Database, CheckCircle2,
  AlertTriangle, Layers, Calendar, Filter, RefreshCw
} from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  BarChart, Bar, CartesianGrid
} from 'recharts';
import { api } from '../api/client';
import { useToast } from '../components/Layout';
import type { StatsData } from '../types';
import LoadingSpinner from '../components/LoadingSpinner';

export default function Analytics() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [stats, setStats] = useState<StatsData | null>(null);
  const [timeRange, setTimeRange] = useState<'24h' | '7d' | '30d'>('24h');
  const { showToast } = useToast();

  const loadStats = (isManual = false) => {
    if (isManual) setRefreshing(true);
    api.getStats()
      .then(res => {
        setStats(res);
        if (isManual) showToast('Analytics and telemetry metrics refreshed.', 'info');
      })
      .catch(() => {})
      .finally(() => {
        setLoading(false);
        if (isManual) setRefreshing(false);
      });
  };

  useEffect(() => {
    setLoading(true);
    loadStats(false);
  }, []);

  if (loading) return <LoadingSpinner label="Aggregating response intelligence analytics" />;

  const hourlyData = (stats?.hourlyHistory || []).map(h => ({
    time: h._id.includes('T') ? h._id.split('T')[1].slice(0, 5) : h._id,
    Total: h.total,
    Stale: h.stale,
    Current: h.current,
    Unverified: h.unverified || 0,
  }));

  const categoryData = (stats?.claimsPerCategory || []).map(c => ({
    name: c._id.toUpperCase(),
    total: c.count,
    stale: c.staleCount,
    current: (c.count - c.staleCount),
  }));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', width: '100%', boxSizing: 'border-box' }} className="animate-fade-in">
      {/* ── Page Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 800 }}>Response Analytics</h1>
          <p style={{ margin: '4px 0 0', fontSize: '0.8125rem', color: 'var(--muted)' }}>
            Deep operational telemetry, temporal drift analysis, category distribution, and multi-tier cache efficiency.
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ display: 'flex', gap: 6, background: 'var(--panel)', padding: 3, borderRadius: 6, border: '1px solid var(--border)' }}>
            {(['24h', '7d', '30d'] as const).map(t => (
              <button
                key={t}
                onClick={() => setTimeRange(t)}
                style={{
                  padding: '4px 10px',
                  borderRadius: 4,
                  fontSize: '0.75rem',
                  fontWeight: timeRange === t ? 700 : 500,
                  background: timeRange === t ? 'var(--accent-dim)' : 'transparent',
                  color: timeRange === t ? 'var(--accent)' : 'var(--muted)',
                  border: 'none',
                }}
              >
                {t.toUpperCase()}
              </button>
            ))}
          </div>

          <button
            className="btn btn-secondary"
            onClick={() => loadStats(true)}
            disabled={refreshing}
            style={{ padding: '6px 12px', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <RefreshCw size={12} style={refreshing ? { animation: 'spin 0.75s linear infinite' } : {}} />
            {refreshing ? 'Refreshing…' : 'Refresh Metrics'}
          </button>
        </div>
      </div>

      {/* ── Metric Cards ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
        <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: '0.6875rem', color: 'var(--muted)', textTransform: 'uppercase' }}>Total Verifications</span>
          <div style={{ fontSize: '1.625rem', fontWeight: 800, color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>
            {stats?.totalScanned || 0}
          </div>
          <span style={{ fontSize: '0.6875rem', color: 'var(--accent)' }}>Active Gateway Traffic</span>
        </div>

        <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: '0.6875rem', color: 'var(--muted)', textTransform: 'uppercase' }}>Stale Claim Detection</span>
          <div style={{ fontSize: '1.625rem', fontWeight: 800, color: 'var(--stale)', fontFamily: 'var(--font-mono)' }}>
            {stats?.totalStale || 0}
          </div>
          <span style={{ fontSize: '0.6875rem', color: 'var(--muted)' }}>Superseded assertions</span>
        </div>

        <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: '0.6875rem', color: 'var(--muted)', textTransform: 'uppercase' }}>Cache Hit Efficiency</span>
          <div style={{ fontSize: '1.625rem', fontWeight: 800, color: 'var(--current)', fontFamily: 'var(--font-mono)' }}>
            {((stats?.cacheHitRate || 0) * 100).toFixed(1)}%
          </div>
          <span style={{ fontSize: '0.6875rem', color: 'var(--muted)' }}>{stats?.cacheHits || 0} hits / {stats?.cacheMisses || 0} misses</span>
        </div>

        <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: '0.6875rem', color: 'var(--muted)', textTransform: 'uppercase' }}>P95 Response Latency</span>
          <div style={{ fontSize: '1.625rem', fontWeight: 800, color: '#8b5cf6', fontFamily: 'var(--font-mono)' }}>
            {stats?.p95ProcessingMs || 0}ms
          </div>
          <span style={{ fontSize: '0.6875rem', color: 'var(--muted)' }}>Avg: {stats?.avgProcessingMs || 0}ms • P99: {stats?.p99ProcessingMs || 0}ms</span>
        </div>
      </div>

      {/* ── Charts Row ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: '1.25rem' }}>

        {/* Verification Activity Over Time */}
        <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h2 style={{ margin: 0, fontSize: '0.9375rem', fontWeight: 700 }}>Verification Activity Timeline</h2>
            <span style={{ fontSize: '0.6875rem', color: 'var(--muted)' }}>Hourly Total vs Stale</span>
          </div>

          <div style={{ width: '100%', height: 260 }}>
            {hourlyData.length === 0 ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--muted)', fontSize: '0.8125rem' }}>
                Awaiting historical telemetry events...
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={hourlyData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="totalGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--accent)" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="var(--accent)" stopOpacity={0.0} />
                    </linearGradient>
                    <linearGradient id="staleGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--stale)" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="var(--stale)" stopOpacity={0.0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="time" stroke="var(--muted)" fontSize={11} />
                  <YAxis stroke="var(--muted)" fontSize={11} />
                  <Tooltip contentStyle={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 6, fontSize: '0.75rem' }} />
                  <Area type="monotone" dataKey="Total" stroke="var(--accent)" strokeWidth={2} fillOpacity={1} fill="url(#totalGrad)" />
                  <Area type="monotone" dataKey="Stale" stroke="var(--stale)" strokeWidth={2} fillOpacity={1} fill="url(#staleGrad)" />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Claim Category Breakdown */}
        <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h2 style={{ margin: 0, fontSize: '0.9375rem', fontWeight: 700 }}>Claim Distribution by Category</h2>
            <span style={{ fontSize: '0.6875rem', color: 'var(--muted)' }}>Total vs Stale Claims</span>
          </div>

          <div style={{ width: '100%', height: 260 }}>
            {categoryData.length === 0 ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--muted)', fontSize: '0.8125rem' }}>
                No category metrics recorded yet.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={categoryData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="name" stroke="var(--muted)" fontSize={11} />
                  <YAxis stroke="var(--muted)" fontSize={11} />
                  <Tooltip contentStyle={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 6, fontSize: '0.75rem' }} />
                  <Bar dataKey="current" stackId="a" fill="var(--current)" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="stale" stackId="a" fill="var(--stale)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
