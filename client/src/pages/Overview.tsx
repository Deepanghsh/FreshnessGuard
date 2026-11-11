import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from 'recharts';
import { Radio, Settings, RefreshCw } from 'lucide-react';
import { useStats } from '../hooks/useStats';
import { useSSE } from '../hooks/useSSE';
import { useToast } from '../components/Layout';
import { api } from '../api/client';
import StatCard from '../components/StatCard';
import ScoreRing from '../components/ScoreRing';
import ClaimBadge from '../components/ClaimBadge';
import LoadingSpinner from '../components/LoadingSpinner';
import EmptyState from '../components/EmptyState';
import type { ResponseDoc, SSEEvent } from '../types';

// ─── Settings stored in localStorage ─────────────────────────────────────────
interface LocalSettings {
  basicMode: boolean;
  serviceURL: string;
  timeoutMs: number;
  scoreThreshold: number;
}

function loadSettings(): LocalSettings {
  try {
    const s = localStorage.getItem('fg-settings');
    return s ? JSON.parse(s) : { basicMode: false, serviceURL: 'http://localhost:3001', timeoutMs: 2000, scoreThreshold: 0.75 };
  } catch { return { basicMode: false, serviceURL: 'http://localhost:3001', timeoutMs: 2000, scoreThreshold: 0.75 }; }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
function fmtPct(n: number) { return `${(n * 100).toFixed(1)}%`; }

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
  const { stats, loading: statsLoading } = useStats(5000);
  const [responses, setResponses] = useState<ResponseDoc[]>([]);
  const [liveFeed, setLiveFeed]   = useState<SSEEvent[]>([]);
  const [settings, setSettings]   = useState<LocalSettings>(loadSettings);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // SSE live updates
  const { connected } = useSSE(useCallback((data: unknown) => {
    const ev = data as SSEEvent;
    if (ev._id || ev.requestId) {
      setLiveFeed(prev => [ev, ...prev].slice(0, 20));
    }
  }, []));

  // Load initial responses
  const loadResponses = useCallback(() => {
    setRefreshing(true);
    api.getResponses(1, 10)
      .then(r => setResponses(r.data))
      .catch(e => showError((e as Error).message))
      .finally(() => setRefreshing(false));
  }, [showError]);

  useEffect(() => { loadResponses(); }, [loadResponses]);

  // Settings save
  const saveSettings = (next: LocalSettings) => {
    setSettings(next);
    localStorage.setItem('fg-settings', JSON.stringify(next));
  };

  // Build hourly chart data (last 24 1h buckets)
  const chartData = (() => {
    if (stats?.hourlyHistory?.length) {
      return stats.hourlyHistory.map(h => ({
        time: h._id.slice(11, 16),
        stale: h.stale,
        current: h.current,
        total: h.total,
      }));
    }
    return [];
  })();

  // Sparkline history for stat cards (last 7 hours from hourly)
  const spark = (key: 'stale' | 'current' | 'total') =>
    chartData.length > 0 ? chartData.slice(-7).map(d => d[key]) : undefined;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', maxWidth: 1400 }} className="animate-fade-in">

      {/* ── Header ────────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ marginBottom: 4 }}>Overview</h1>
          <p style={{ fontSize: '0.875rem', color: 'var(--muted)' }}>
            Live freshness intelligence across all LLM responses
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {/* SSE indicator */}
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.75rem', color: connected ? 'var(--current)' : 'var(--muted)' }}>
            <Radio size={12} aria-hidden="true" />
            {connected ? 'Live' : 'Connecting…'}
          </span>
          <button
            className="btn btn-secondary"
            onClick={loadResponses}
            disabled={refreshing}
            aria-label="Refresh responses"
          >
            <RefreshCw size={14} style={refreshing ? { animation: 'spin 0.75s linear infinite' } : {}} aria-hidden="true" />
            Refresh
          </button>
          <button
            className="btn btn-secondary"
            onClick={() => setSettingsOpen(o => !o)}
            aria-expanded={settingsOpen}
            aria-controls="settings-panel"
          >
            <Settings size={14} aria-hidden="true" /> Settings
          </button>
        </div>
      </div>

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
          label="P95 Overhead"
          value={statsLoading ? '—' : (stats?.p95ProcessingMs ?? 0)}
          unit="ms"
          color="var(--muted)"
          loading={statsLoading}
          trendLabel={stats ? `avg ${stats.avgProcessingMs}ms` : undefined}
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: settingsOpen ? '1fr 300px' : '1fr', gap: '1.5rem', alignItems: 'start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

          {/* ── Claims Over Time chart ──────────────────────────────────────────── */}
          <div className="panel">
            <h2 style={{ marginBottom: '1rem', fontSize: '0.9375rem' }}>Claims Over Time (last 24h)</h2>
            {chartData.length === 0 ? (
              <div style={{ height: 220, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)', fontSize: '0.875rem', gap: 6 }}>
                <span>No claim activity recorded in the last 24 hours.</span>
                <span style={{ fontSize: '0.75rem', color: 'var(--dim)' }}>Verified claims through Bifrost will appear here in real time.</span>
              </div>
            ) : (
            <div style={{ height: 220 }} aria-label="Area chart of claims over time" role="img">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gStale"   x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="var(--stale)"   stopOpacity={0.3} />
                      <stop offset="95%" stopColor="var(--stale)"   stopOpacity={0}   />
                    </linearGradient>
                    <linearGradient id="gCurrent" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="var(--current)" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="var(--current)" stopOpacity={0}   />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="time" tick={{ fill: 'var(--muted)', fontSize: 11 }} tickLine={false} axisLine={false} interval={3} />
                  <YAxis tick={{ fill: 'var(--muted)', fontSize: 11 }} tickLine={false} axisLine={false} />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, paddingTop: 8, color: 'var(--muted)' }} />
                  <Area type="monotone" dataKey="stale"   name="Stale"   stroke="var(--stale)"   fill="url(#gStale)"   strokeWidth={2} dot={false} />
                  <Area type="monotone" dataKey="current" name="Current" stroke="var(--current)" fill="url(#gCurrent)" strokeWidth={2} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            )}
          </div>

          {/* ── Live Feed ──────────────────────────────────────────────────────── */}
          <div className="panel" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h2 style={{ fontSize: '0.9375rem' }}>Recent Responses</h2>
              <span className="badge badge-muted">{responses.length} shown</span>
            </div>

            {responses.length === 0 && !refreshing && (
              <EmptyState message="No responses yet" detail="Send a request through the Bifrost gateway or use the Playground." />
            )}
            {refreshing && responses.length === 0 && <LoadingSpinner label="Loading responses" />}

            {responses.length > 0 && (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }} aria-label="Recent LLM responses">
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border)' }}>
                      {['Time', 'Model', 'Score', 'Claims', 'Preview'].map(h => (
                        <th key={h} style={{ padding: '0.625rem 1rem', textAlign: 'left', fontSize: '0.6875rem', fontWeight: 600, color: 'var(--muted)', letterSpacing: '0.05em', textTransform: 'uppercase' }}>{h}</th>
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
                        <td style={{ padding: '0.75rem 1rem', fontSize: '0.75rem', color: 'var(--muted)', whiteSpace: 'nowrap', fontFamily: 'var(--font-mono)' }}>
                          {fmtTime(r.checkedAt)}
                        </td>
                        <td style={{ padding: '0.75rem 1rem', fontSize: '0.8125rem', whiteSpace: 'nowrap' }}>
                          <code style={{ color: 'var(--accent)', fontSize: '0.75rem' }}>{r.model}</code>
                        </td>
                        <td style={{ padding: '0.75rem 1rem' }}>
                          <ScoreRing score={r.overallScore} size={36} strokeWidth={4} />
                        </td>
                        <td style={{ padding: '0.75rem 1rem', whiteSpace: 'nowrap' }}>
                          {r.staleCount > 0 ? (
                            <ClaimBadge verdict="stale" />
                          ) : (
                            <ClaimBadge verdict="current" />
                          )}
                          <span style={{ marginLeft: 6, fontSize: '0.75rem', color: 'var(--muted)' }}>
                            {r.staleCount}/{r.totalClaims}
                          </span>
                        </td>
                        <td style={{ padding: '0.75rem 1rem', fontSize: '0.8125rem', color: 'var(--muted)', maxWidth: 320 }}>
                          <span className="truncate" style={{ display: 'block', maxWidth: 300 }}>
                            {r.originalText.slice(0, 80)}{r.originalText.length > 80 ? '…' : ''}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* ── Settings Panel ──────────────────────────────────────────────────── */}
        {settingsOpen && (
          <aside id="settings-panel" className="panel" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <h2 style={{ fontSize: '0.9375rem' }}>Plugin Settings</h2>
            <p style={{ fontSize: '0.75rem', color: 'var(--muted)', lineHeight: 1.6 }}>
              These settings are stored locally. Restart the Go plugin to apply changes.
            </p>

            <div>
              <label htmlFor="serviceURL">Service URL</label>
              <input
                id="serviceURL"
                type="url"
                value={settings.serviceURL}
                onChange={e => saveSettings({ ...settings, serviceURL: e.target.value })}
                placeholder="http://localhost:3001"
              />
            </div>

            <div>
              <label htmlFor="timeoutMs">Timeout (ms)</label>
              <input
                id="timeoutMs"
                type="number"
                min={100}
                max={30000}
                value={settings.timeoutMs}
                onChange={e => saveSettings({ ...settings, timeoutMs: Number(e.target.value) })}
              />
            </div>

            <div>
              <label htmlFor="scoreThreshold">Score Threshold (0–1)</label>
              <input
                id="scoreThreshold"
                type="number"
                min={0}
                max={1}
                step={0.05}
                value={settings.scoreThreshold}
                onChange={e => saveSettings({ ...settings, scoreThreshold: Number(e.target.value) })}
              />
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <input
                id="basicMode"
                type="checkbox"
                checked={settings.basicMode}
                onChange={e => saveSettings({ ...settings, basicMode: e.target.checked })}
                style={{ width: 'auto' }}
              />
              <label htmlFor="basicMode" style={{ marginBottom: 0, cursor: 'pointer' }}>Basic mode (regex only)</label>
            </div>

            <div style={{ padding: '0.75rem', background: 'rgba(94,234,212,0.06)', borderRadius: 6, border: '1px solid var(--border)' }}>
              <p style={{ fontSize: '0.6875rem', color: 'var(--muted)', lineHeight: 1.6 }}>
                Settings are saved to localStorage. To apply to the Go plugin, update <code>config.json</code> and restart Bifrost.
              </p>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}

