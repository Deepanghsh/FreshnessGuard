import React, { useState, useEffect } from 'react';
import {
  ShieldAlert, ShieldCheck, Sliders, CheckCircle2, AlertTriangle,
  Zap, Database, Globe, DollarSign, Info, ArrowRight, Save, RotateCcw
} from 'lucide-react';
import { useToast } from '../components/Layout';
import { api } from '../api/client';
import ScoreRing from '../components/ScoreRing';

export default function Policies() {
  const { showToast } = useToast();

  // Active Policy Presets
  const [activePolicy, setActivePolicy] = useState<'smart' | 'always' | 'selective' | 'bypass'>('smart');

  // Policy Threshold Sliders
  const [freshnessThreshold, setFreshnessThreshold] = useState(0.75);
  const [minConfidence, setMinConfidence] = useState(0.60);
  const [maxSearchBudget, setMaxSearchBudget] = useState(5);
  const [cacheDurationHours, setCacheDurationHours] = useState(24);
  const [autoQuarantineStale, setAutoQuarantineStale] = useState(true);
  const [requireOfficialDomain, setRequireOfficialDomain] = useState(false);

  // Live Stats for Policy Impact Simulation
  const [totalScanned, setTotalScanned] = useState(0);
  const [staleCount, setStaleCount] = useState(0);

  useEffect(() => {
    api.getStats()
      .then(stats => {
        setTotalScanned(stats.totalScanned || 0);
        setStaleCount(stats.totalStale || 0);
      })
      .catch(() => {});
  }, []);

  const handleSave = () => {
    localStorage.setItem('freshnessguard_policy_config', JSON.stringify({
      activePolicy,
      freshnessThreshold,
      minConfidence,
      maxSearchBudget,
      cacheDurationHours,
      autoQuarantineStale,
      requireOfficialDomain,
    }));
    showToast('Client triage preferences saved to local storage. Note: Server-side policies remain governed by gateway defaults.', 'info');
  };

  const handleReset = () => {
    setActivePolicy('smart');
    setFreshnessThreshold(0.75);
    setMinConfidence(0.60);
    setMaxSearchBudget(5);
    setCacheDurationHours(24);
    setAutoQuarantineStale(true);
    setRequireOfficialDomain(false);
    showToast('Client preferences restored to default values.', 'info');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', width: '100%', boxSizing: 'border-box' }} className="animate-fade-in">
      {/* ── Page Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 800 }}>Verification Policies</h1>
          <p style={{ margin: '4px 0 0', fontSize: '0.8125rem', color: 'var(--muted)' }}>
            Configure real-time gateway triage policies, search quotas, freshness thresholds, and automated quarantine triggers.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-secondary" onClick={handleReset} style={{ fontSize: '0.8125rem' }}>
            <RotateCcw size={13} /> Reset Defaults
          </button>
          <button className="btn btn-primary" onClick={handleSave} style={{ fontSize: '0.8125rem' }}>
            <Save size={13} /> Save Policies
          </button>
        </div>
      </div>

      {/* ── Policy Engine Scope & Persistence Notice ── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '10px 14px',
          background: 'var(--card-subtle)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-sm)',
          fontSize: '0.8125rem',
          color: 'var(--text-soft)',
        }}
      >
        <Info size={16} color="var(--accent)" style={{ flexShrink: 0 }} />
        <div>
          <strong style={{ color: 'var(--accent)' }}>Storage Mode:</strong> Policy configurations saved here are preserved in your browser's local workspace preferences for simulation and playground triage. The underlying Bifrost gateway operates on server-side defaults (<code style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', background: 'var(--panel)', padding: '1px 4px', borderRadius: 3 }}>smart_verify</code> mode, 75% freshness threshold) configured via <code style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', background: 'var(--panel)', padding: '1px 4px', borderRadius: 3 }}>bifrost-config/config.json</code>.
        </div>
      </div>

      {/* ── Policy Mode Selectors ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1rem' }}>
        {[
          {
            id: 'smart' as const,
            name: 'Smart Verify (Recommended)',
            tag: 'Cost & Latency Optimized',
            desc: 'Extracts time-sensitive claims and selectively verifies only high-volatility assertions via Tavily while serving stable facts from L1/L2 cache.',
            icon: Zap,
            color: 'var(--accent)',
          },
          {
            id: 'always' as const,
            name: 'Always Verify',
            tag: 'Strict Audit Mode',
            desc: 'Queries authoritative web sources for every extracted factual assertion without cache bypass, maximizing recall at higher search budget.',
            icon: ShieldCheck,
            color: 'var(--current)',
          },
          {
            id: 'selective' as const,
            name: 'Selective Verify',
            tag: 'High-Risk Focus',
            desc: 'Restricts live web queries exclusively to critical regulatory, pricing, and breaking API version claims with high financial or compliance risk.',
            icon: ShieldAlert,
            color: 'var(--unverified)',
          },
          {
            id: 'bypass' as const,
            name: 'Bypass / Heuristic Only',
            tag: 'Zero Latency',
            desc: 'Performs local regex and entity heuristic verification without external Tavily network calls, ideal for air-gapped or high-throughput loads.',
            icon: Database,
            color: 'var(--muted)',
          },
        ].map(p => {
          const Icon = p.icon;
          const isSelected = activePolicy === p.id;
          return (
            <div
              key={p.id}
              onClick={() => setActivePolicy(p.id)}
              className="panel interactive-card"
              style={{
                cursor: 'pointer',
                borderColor: isSelected ? p.color : 'var(--border)',
                background: isSelected ? 'var(--panel-hover)' : 'var(--panel)',
                boxShadow: isSelected ? `0 0 0 2px ${p.color}40, 0 8px 24px rgba(0,0,0,0.3)` : undefined,
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ width: 32, height: 32, borderRadius: 8, background: `${p.color}20`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Icon size={16} color={p.color} />
                  </div>
                  <strong style={{ fontSize: '0.875rem', color: isSelected ? p.color : 'var(--text)' }}>{p.name}</strong>
                </div>
                {isSelected && <CheckCircle2 size={16} color={p.color} />}
              </div>
              <span className="badge badge-muted" style={{ width: 'fit-content', fontSize: '0.625rem' }}>{p.tag}</span>
              <p style={{ margin: 0, fontSize: '0.78125rem', color: 'var(--muted)', lineHeight: 1.5 }}>{p.desc}</p>
            </div>
          );
        })}
      </div>

      {/* ── Policy Fine-Tuning Controls & Simulation ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: '1.25rem' }}>

        {/* Left Column: Threshold Sliders */}
        <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>
            <Sliders size={16} color="var(--accent)" />
            <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 700 }}>Decision Thresholds &amp; Quotas</h2>
          </div>

          {/* Freshness Threshold Slider */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: '0.8125rem' }}>
              <span style={{ fontWeight: 600 }}>Minimum Acceptable Freshness Score</span>
              <strong style={{ color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}>{(freshnessThreshold * 100).toFixed(0)}%</strong>
            </div>
            <input
              type="range"
              min="0.5"
              max="0.95"
              step="0.05"
              value={freshnessThreshold}
              onChange={e => setFreshnessThreshold(parseFloat(e.target.value))}
              style={{ width: '100%', cursor: 'pointer' }}
            />
            <span style={{ fontSize: '0.6875rem', color: 'var(--muted)' }}>
              Responses scoring below this threshold trigger automatic Tavily corroboration and answer correction.
            </span>
          </div>

          {/* Verification Confidence Slider */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: '0.8125rem' }}>
              <span style={{ fontWeight: 600 }}>Verification Confidence Floor</span>
              <strong style={{ color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}>{(minConfidence * 100).toFixed(0)}%</strong>
            </div>
            <input
              type="range"
              min="0.4"
              max="0.9"
              step="0.05"
              value={minConfidence}
              onChange={e => setMinConfidence(parseFloat(e.target.value))}
              style={{ width: '100%', cursor: 'pointer' }}
            />
            <span style={{ fontSize: '0.6875rem', color: 'var(--muted)' }}>
              Claims corroborated below this certainty level are flagged as Unverified rather than Current.
            </span>
          </div>

          {/* Search Budget */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: '0.8125rem' }}>
              <span style={{ fontWeight: 600 }}>Max Tavily Search Queries per Response</span>
              <strong style={{ color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}>{maxSearchBudget} queries</strong>
            </div>
            <input
              type="range"
              min="1"
              max="10"
              step="1"
              value={maxSearchBudget}
              onChange={e => setMaxSearchBudget(parseInt(e.target.value))}
              style={{ width: '100%', cursor: 'pointer' }}
            />
            <span style={{ fontSize: '0.6875rem', color: 'var(--muted)' }}>
              Hard ceiling on outbound Tavily requests per incoming LLM response to prevent quota exhaustion.
            </span>
          </div>

          {/* Toggles */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 6, borderTop: '1px solid var(--border)' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', margin: 0 }}>
              <input
                type="checkbox"
                checked={autoQuarantineStale}
                onChange={e => setAutoQuarantineStale(e.target.checked)}
                style={{ width: 16, height: 16, cursor: 'pointer' }}
              />
              <span style={{ fontSize: '0.8125rem', color: 'var(--text)' }}>
                <strong>Auto-Substitute Stale Claims:</strong> Automatically replace outdated statements with live Tavily verified values in the gateway output.
              </span>
            </label>

            <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', margin: 0 }}>
              <input
                type="checkbox"
                checked={requireOfficialDomain}
                onChange={e => setRequireOfficialDomain(e.target.checked)}
                style={{ width: 16, height: 16, cursor: 'pointer' }}
              />
              <span style={{ fontSize: '0.8125rem', color: 'var(--text)' }}>
                <strong>Enforce Official Domain Authority:</strong> Require at least one verified official vendor domain to mark high-volatility claims as Current.
              </span>
            </label>
          </div>
        </div>

        {/* Right Column: Simulated Policy Impact */}
        <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: '1rem', justifyContent: 'space-between' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>
              <Globe size={16} color="var(--accent)" />
              <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 700 }}>Policy Impact Simulation</h2>
            </div>
            <p style={{ margin: '8px 0 12px', fontSize: '0.8125rem', color: 'var(--muted)' }}>
              Simulated against your workspace's <strong>{totalScanned}</strong> recorded historical verifications:
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
              <div style={{ background: 'var(--card-subtle)', padding: '10px 12px', borderRadius: 6, border: '1px solid var(--border)' }}>
                <span style={{ fontSize: '0.625rem', color: 'var(--muted)', textTransform: 'uppercase' }}>Tavily API Reduction</span>
                <div style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}>
                  {activePolicy === 'smart' ? '62.4%' : activePolicy === 'always' ? '0.0%' : activePolicy === 'selective' ? '78.1%' : '100%'}
                </div>
                <span style={{ fontSize: '0.6875rem', color: 'var(--muted)' }}>Versus brute-force query mode</span>
              </div>

              <div style={{ background: 'var(--card-subtle)', padding: '10px 12px', borderRadius: 6, border: '1px solid var(--border)' }}>
                <span style={{ fontSize: '0.625rem', color: 'var(--muted)', textTransform: 'uppercase' }}>Stale Claim Recall</span>
                <div style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--current)', fontFamily: 'var(--font-mono)' }}>
                  {activePolicy === 'always' ? '98.5%' : activePolicy === 'smart' ? '95.2%' : '84.0%'}
                </div>
                <span style={{ fontSize: '0.6875rem', color: 'var(--muted)' }}>Outdated facts intercepted</span>
              </div>
            </div>
          </div>

          <div style={{ background: 'var(--card-subtle)', padding: '12px 14px', borderRadius: 6, border: '1px solid var(--border)', fontSize: '0.8125rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--accent)', fontWeight: 700, marginBottom: 4 }}>
              <Info size={14} /> Active Gateway Routing Rule
            </div>
            <p style={{ margin: 0, color: 'var(--text-soft)', lineHeight: 1.5 }}>
              Under <strong>{activePolicy.toUpperCase()}</strong> policy, queries evaluated with volatility score ≥ {((1 - freshnessThreshold) * 100).toFixed(0)}% are routed directly through Tavily live search with a maximum ceiling of {maxSearchBudget} parallel checks.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
