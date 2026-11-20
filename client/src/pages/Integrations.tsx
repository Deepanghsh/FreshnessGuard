import React, { useState, useEffect } from 'react';
import {
  Boxes, CheckCircle2, AlertTriangle, RefreshCw,
  ExternalLink, Cpu, Database, Globe, Shield, Terminal, Layers
} from 'lucide-react';
import { api } from '../api/client';
import { useToast } from '../components/Layout';
import type { HealthStatus } from '../types';
import LoadingSpinner from '../components/LoadingSpinner';

export default function Integrations() {
  const { showToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [health, setHealth] = useState<HealthStatus | null>(null);

  const fetchHealth = () => {
    setRefreshing(true);
    api.getHealth()
      .then(h => {
        setHealth(h);
        showToast('Integration connection statuses refreshed.', 'success');
      })
      .catch(() => {
        showToast('Unable to reach backend gateway health endpoint.', 'error');
      })
      .finally(() => {
        setLoading(false);
        setRefreshing(false);
      });
  };

  useEffect(() => {
    fetchHealth();
  }, []);

  if (loading) return <LoadingSpinner label="Auditing gateway integrations & service health" />;

  const isMongoOnline = health?.mongodb === 'connected';
  const tavilyStatus = health?.tavily ?? 'not_configured';
  const isTavilyOnline = tavilyStatus === 'configured';
  const geminiStatus = health?.gemini ?? 'not_configured';
  const isBifrostOnline = health?.bifrost === 'connected' || health?.bifrost === 'reachable';

  const integrations = [
    {
      name: 'FreshnessGuard Core Service',
      category: 'Data Plane API',
      status: health?.status === 'ok' ? 'online' : 'offline',
      statusLabel: health?.status === 'ok' ? 'Connected (Port 5000)' : 'Offline',
      description: 'Core TypeScript Express verification service, SSE event broadcaster, and REST endpoint handler.',
      details: `Version: ${health?.version || '1.0.0'} • SSE Clients: ${health?.sseClients || 0} • Status: ${health?.status || 'unknown'}`,
      icon: Cpu,
      color: 'var(--accent)',
    },
    {
      name: 'Bifrost AI Gateway',
      category: 'Edge Reverse Proxy',
      status: isBifrostOnline ? 'online' : health?.bifrost === 'unreachable' ? 'offline' : 'degraded',
      statusLabel: isBifrostOnline ? 'Reachable & Online (Port 8080)' : health?.bifrost === 'unreachable' ? 'Unreachable' : 'Not Independently Verified',
      description: 'Edge LLM proxy intercepting chat completions via PostLLMHook plugin architecture.',
      details: isBifrostOnline ? 'Endpoint: http://localhost:8080 • Port: 8080 • Health Ping: Active HTTP 200' : 'Config: bifrost-config/config.json • Port: 8080 (Local/Docker)',
      icon: Layers,
      color: isBifrostOnline ? 'var(--current)' : 'var(--unverified)',
    },
    {
      name: 'MongoDB Atlas',
      category: 'Persistent Cloud Storage',
      status: isMongoOnline ? 'online' : 'degraded',
      statusLabel: isMongoOnline ? 'Connected & Ping Verified' : 'Disconnected (In-Memory L1 Cache Active)',
      description: 'Persistent cloud database storing user accounts, verification records, claims, and telemetry.',
      details: isMongoOnline ? 'Storage Mode: Cloud Cluster0 (Primary)' : 'Storage Mode: In-Memory L1 Degraded Fallback',
      icon: Database,
      color: isMongoOnline ? 'var(--current)' : 'var(--stale)',
    },
    {
      name: 'Tavily Search Engine',
      category: 'Recency Corroborator',
      status: isTavilyOnline ? 'online' : tavilyStatus === 'misconfigured' ? 'offline' : 'offline',
      statusLabel: isTavilyOnline ? 'Configured & Active' : tavilyStatus === 'misconfigured' ? 'Misconfigured Key' : 'Not Configured',
      description: 'Real-time authoritative web search gathering live corroborating evidence and published dates.',
      details: isTavilyOnline ? 'Credentials: Validated TAVILY_API_KEY (tvly-*) • Protocol: HTTPS REST' : 'Credentials: Missing or invalid TAVILY_API_KEY environment variable',
      icon: Globe,
      color: isTavilyOnline ? 'var(--accent)' : 'var(--stale)',
    },
    {
      name: 'Google Gemini Provider',
      category: 'LLM Model Provider',
      status: geminiStatus === 'configured' ? 'online' : 'offline',
      statusLabel: geminiStatus === 'configured' ? 'Configured' : 'Not Configured',
      description: 'Gemini 1.5 Flash / Pro model completions for question answering and structured claim parsing.',
      details: geminiStatus === 'configured' ? 'Key: Verified GEMINI_API_KEY • Default Model: gemini-1.5-flash' : 'Key: Missing GEMINI_API_KEY environment variable',
      icon: Boxes,
      color: '#8b5cf6',
    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', width: '100%', boxSizing: 'border-box' }} className="animate-fade-in">
      {/* ── Page Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 800 }}>Platform Integrations</h1>
          <p style={{ margin: '4px 0 0', fontSize: '0.8125rem', color: 'var(--muted)' }}>
            Real-time operational status, diagnostic health checks, and connectivity monitoring across the FreshnessGuard ecosystem.
          </p>
        </div>

        <button
          className="btn btn-secondary"
          onClick={fetchHealth}
          disabled={refreshing}
          style={{ fontSize: '0.8125rem', display: 'flex', alignItems: 'center', gap: 6 }}
        >
          <RefreshCw size={13} style={refreshing ? { animation: 'spin 0.75s linear infinite' } : {}} />
          <span>{refreshing ? 'Checking Health…' : 'Run Health Check'}</span>
        </button>
      </div>

      {/* ── Integration Cards ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1.25rem' }}>
        {integrations.map((item, i) => {
          const Icon = item.icon;
          const isHealthy = item.status === 'online';
          return (
            <div
              key={i}
              className="panel interactive-card"
              style={{
                borderLeft: `4px solid ${item.color}`,
                display: 'flex',
                flexDirection: 'column',
                gap: 12,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 36, height: 36, borderRadius: 8, background: 'var(--card-subtle)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Icon size={18} color={item.color} />
                  </div>
                  <div>
                    <h2 style={{ margin: 0, fontSize: '0.9375rem', fontWeight: 700 }}>{item.name}</h2>
                    <span style={{ fontSize: '0.6875rem', color: 'var(--muted)' }}>{item.category}</span>
                  </div>
                </div>

                <span
                  style={{
                    padding: '3px 8px',
                    borderRadius: 4,
                    fontSize: '0.6875rem',
                    fontWeight: 700,
                    background: isHealthy ? 'var(--current-dim)' : 'var(--degraded-dim)',
                    color: isHealthy ? 'var(--current)' : 'var(--degraded)',
                    border: `1px solid ${isHealthy ? 'var(--current-border)' : 'rgba(249, 115, 22, 0.35)'}`,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 5,
                  }}
                >
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: isHealthy ? 'var(--current)' : 'var(--degraded)' }} />
                  {item.statusLabel}
                </span>
              </div>

              <p style={{ margin: 0, fontSize: '0.8125rem', color: 'var(--text-soft)', lineHeight: 1.5 }}>
                {item.description}
              </p>

              <div style={{ background: 'var(--card-subtle)', padding: '8px 10px', borderRadius: 4, border: '1px solid var(--border)', fontSize: '0.75rem', fontFamily: 'var(--font-mono)', color: 'var(--muted)' }}>
                {item.details}
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Diagnostic Raw Health Dump ── */}
      <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Terminal size={16} color="var(--accent)" />
          <h2 style={{ margin: 0, fontSize: '0.9375rem', fontWeight: 700 }}>Gateway Diagnostic Telemetry</h2>
        </div>
        <div className="code-block" style={{ margin: 0, fontSize: '0.75rem', padding: '10px 14px' }}>
          {JSON.stringify(health, null, 2)}
        </div>
      </div>
    </div>
  );
}
