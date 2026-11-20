import React, { useState } from 'react';
import {
  Shield, Server, Search, Database, Layers, CheckCircle2,
  Clock, AlertTriangle, ArrowRight, Activity, Cpu, Sparkles,
  ExternalLink, Code2, Zap, Radio, Info, ChevronRight,
  Globe, Smartphone, Terminal, Building2, Wrench, BookOpen, Key, Check
} from 'lucide-react';

interface ComponentDetail {
  id: string;
  name: string;
  layer: string;
  tech: string;
  status: 'verified' | 'active_fallback' | 'degraded' | 'pending';
  statusLabel: string;
  description: string;
  responsibility: string;
  configuration: string;
}

const COMPONENTS: ComponentDetail[] = [
  {
    id: 'interfaces',
    name: 'Input Channels & Clients',
    layer: 'Consumer Interface',
    tech: 'Web App / Mobile / REST API / SDK',
    status: 'verified',
    statusLabel: 'Standard Consumer',
    description: 'Any client application or AI agent making OpenAI-compatible chat completion requests.',
    responsibility: 'Sends prompts to Bifrost Gateway. Receives completions with injected X-FreshnessGuard-* headers.',
    configuration: 'Base URL: http://localhost:8080/v1 (Bifrost Gateway endpoint)',
  },
  {
    id: 'bifrost',
    name: 'Bifrost AI Gateway',
    layer: 'Gateway Layer',
    tech: 'Go / Bifrost (maximhq)',
    status: 'verified',
    statusLabel: 'Integrated via Hook',
    description: 'High-performance AI gateway managing multi-provider model routing, rate limits, and plugin hooks.',
    responsibility: 'Routes requests to target LLM. Invokes FreshnessGuard PostLLMHook on completion streams.',
    configuration: 'Plugin config: post_llm_hook enabled, fail-open timeout: 2000ms',
  },
  {
    id: 'llm',
    name: 'Model Routing & Provider',
    layer: 'Model Provider',
    tech: 'Gemini 1.5 / GPT-4o / Claude 3.5',
    status: 'verified',
    statusLabel: 'Gemini 1.5 Flash + Fallback Ready',
    description: 'Configured model provider generating the original response text and extracting claim assertions.',
    responsibility: 'Generates completions and isolates factual claims. Uses high-availability deterministic regex safety guardrail when upstream quotas limit API throughput.',
    configuration: 'Primary: Gemini 1.5 Flash & Pro (Google) / Secondary: Deterministic regex extraction fallback.',
  },
  {
    id: 'guard',
    name: 'FreshnessGuard PostLLMHook',
    layer: 'Gateway Guardrail',
    tech: 'Go Plugin + Node.js 20 Backend',
    status: 'verified',
    statusLabel: 'Verified (124/124 Tests)',
    description: 'Interception hook executing post-completion temporal freshness verification.',
    responsibility: 'Performs claim extraction, triage, web search, and scoring before completion reaches client.',
    configuration: 'Canonical Init(config any), PreLLMHook, PostLLMHook implementation with fail-open safety.',
  },
  {
    id: 'tavily',
    name: 'Tavily Search Engine (Tools)',
    layer: 'Live Web Evidence',
    tech: 'Tavily Search API',
    status: 'verified',
    statusLabel: 'Configured & Active',
    description: 'Search engine optimized for AI fact-checking, real-time publication dates, and source authority.',
    responsibility: 'Executes concurrent queries (limit 3) with dynamic current-year query contextualization.',
    configuration: 'API key configured. Extracts publication dates, official domain tags, and relevance scores.',
  },
  {
    id: 'storage',
    name: 'Memory & Storage Services',
    layer: 'Storage Layer',
    tech: 'In-Memory L1 Cache + MongoDB Atlas',
    status: 'verified',
    statusLabel: 'Atlas Online & Hybrid L1',
    description: 'Hybrid storage tier supporting persistent MongoDB Atlas cloud database with sub-millisecond in-memory cache.',
    responsibility: 'Stores verifications in MongoDB Atlas cloud cluster with fallback to high-speed in-memory L1 cache.',
    configuration: 'MongoDB Atlas connected and verified. Automatic in-memory L1 cache fallback for zero downtime.',
  },
];

const FORMULA_WEIGHTS = [
  { label: 'Evidence Agreement', weight: 0.40, color: 'var(--accent)', description: 'Corroboration agreement: 1.0 if verified current, 0.0 if stale, 0.5 if unverified' },
  { label: 'Source Authority',   weight: 0.30, color: '#818CF8', description: 'Domain authority (.gov/.edu/official docs) blended 70/30 with Tavily relevance' },
  { label: 'Recency Score',      weight: 0.20, color: 'var(--current)', description: 'Publication date tier: <7d = 1.0, <30d = 0.75, <90d = 0.50, older = 0.15' },
  { label: 'Source Volume',      weight: 0.10, color: 'var(--unverified)', description: 'Quantity of corroborating sources (scaled and capped at 3 sources)' },
];

// ─── Glowing Glass Cylinder Component (Reference Image 1) ───────────────────
function CylinderStream({ label, subtitle }: { label: string; subtitle: string }) {
  // 12 particle dots with randomized positions and animation delays
  const particles = [
    { left: '25%', delay: '0s', duration: '2.4s', size: 5 },
    { left: '60%', delay: '0.6s', duration: '3.1s', size: 4 },
    { left: '40%', delay: '1.2s', duration: '2.8s', size: 6 },
    { left: '75%', delay: '1.8s', duration: '2.2s', size: 4 },
    { left: '20%', delay: '2.1s', duration: '3.5s', size: 5 },
    { left: '50%', delay: '0.9s', duration: '2.6s', size: 3 },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
      <div style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#38bdf8', letterSpacing: '0.06em', textAlign: 'center', textTransform: 'uppercase' }}>
        {label}
      </div>

      <div className="data-cylinder">
        <div className="data-cylinder-caps" />

        {/* Ambient interior glow */}
        <div
          style={{
            position: 'absolute',
            top: 20,
            bottom: 20,
            left: 10,
            right: 10,
            background: 'radial-gradient(ellipse at center, rgba(56, 189, 248, 0.2) 0%, transparent 80%)',
            pointerEvents: 'none',
          }}
        />

        {/* Streaming particles */}
        {particles.map((p, idx) => (
          <div
            key={idx}
            style={{
              position: 'absolute',
              top: 0,
              left: p.left,
              width: p.size,
              height: p.size,
              borderRadius: '50%',
              background: '#38bdf8',
              boxShadow: '0 0 10px #38bdf8, 0 0 16px #38bdf8',
              animation: `streamParticle ${p.duration} ease-in-out infinite`,
              animationDelay: p.delay,
            }}
          />
        ))}

        {/* Center status text */}
        <div style={{ zIndex: 1, textAlign: 'center', padding: '0 6px' }}>
          <div style={{ fontSize: '0.625rem', fontFamily: 'var(--font-mono)', color: 'var(--text-soft)', letterSpacing: '0.05em' }}>
            DATA
          </div>
          <div style={{ fontSize: '0.5625rem', color: '#38bdf8', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
            PLANE
          </div>
        </div>

        <div className="data-cylinder-bottom" />
      </div>

      <div style={{ fontSize: '0.625rem', color: 'var(--dim)', textAlign: 'center' }}>
        {subtitle}
      </div>
    </div>
  );
}

export default function Architecture() {
  const [selectedComponent, setSelectedComponent] = useState<ComponentDetail>(COMPONENTS[3]);
  const [activePathMode, setActivePathMode] = useState<'inline' | 'async' | 'basic' | 'bypass' | 'fallback'>('inline');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.75rem', width: '100%', minWidth: 0, boxSizing: 'border-box' }} className="animate-fade-in">

      {/* ── Page Header (Clean & Modern) ── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 16,
          paddingBottom: 4,
          borderBottom: '1px solid var(--border)',
          width: '100%',
          boxSizing: 'border-box',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#38bdf8', boxShadow: '0 0 12px #38bdf8' }} />
            <h1 style={{ margin: 0, fontSize: '1.75rem', letterSpacing: '-0.03em', fontWeight: 800 }}>
              System Architecture &amp; Data Plane
            </h1>
          </div>
          <p style={{ fontSize: '0.875rem', color: 'var(--muted)', margin: '4px 0 0' }}>
            Interactive 3-tier architectural blueprint of Bifrost Gateway guardrails, temporal verification pipelines, and resilience fallbacks
          </p>
        </div>
      </div>

      {/* ── Honest Engineering Audit Status Banner ── */}
      <div
        className="panel"
        style={{
          borderLeft: '4px solid var(--accent)',
          background: 'var(--panel)',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          width: '100%',
          boxSizing: 'border-box',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Shield size={18} color="var(--accent)" />
          <h2 style={{ fontSize: '1rem', margin: 0, color: 'var(--text)' }}>
            Engineering Audit &amp; Technical Verification Status
          </h2>
        </div>
        <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--muted)', lineHeight: 1.6 }}>
          FreshnessGuard operates directly at the AI Gateway layer to detect stale factual assertions in LLM responses.
          The operational status of every subsystem in this environment is documented below:
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 10, marginTop: 4, width: '100%', boxSizing: 'border-box' }}>
          <div style={{ background: 'var(--panel)', padding: '10px 12px', borderRadius: 6, border: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--current)', fontWeight: 600, fontSize: '0.8125rem' }}>
              <CheckCircle2 size={14} /> Node.js Backend: 124/124 PASSED
            </div>
            <p style={{ margin: '4px 0 0', fontSize: '0.75rem', color: 'var(--muted)' }}>
              9 test suites passing (scoring, triage, regex extraction, Tavily concurrency, modes, SSE, cache, auth, ask).
            </p>
          </div>

          <div style={{ background: 'var(--panel)', padding: '10px 12px', borderRadius: 6, border: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--current)', fontWeight: 600, fontSize: '0.8125rem' }}>
              <CheckCircle2 size={14} /> Go Plugin Interface: 22/22 PASSED
            </div>
            <p style={{ margin: '4px 0 0', fontSize: '0.75rem', color: 'var(--muted)' }}>
              PreLLMHook &amp; PostLLMHook fail-open timeout logic (2000ms) verified via Go test suite.
            </p>
          </div>

          <div style={{ background: 'var(--panel)', padding: '10px 12px', borderRadius: 6, border: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--current)', fontWeight: 600, fontSize: '0.8125rem' }}>
              <CheckCircle2 size={14} /> MongoDB: ATLAS ONLINE &amp; VERIFIED
            </div>
            <p style={{ margin: '4px 0 0', fontSize: '0.75rem', color: 'var(--muted)' }}>
              Atlas cloud cluster verified and persistent; hybrid sub-millisecond in-memory L1 cache active.
            </p>
          </div>

          <div style={{ background: 'var(--panel)', padding: '10px 12px', borderRadius: 6, border: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--current)', fontWeight: 600, fontSize: '0.8125rem' }}>
              <CheckCircle2 size={14} /> Extraction: GEMINI + REGEX HYBRID
            </div>
            <p style={{ margin: '4px 0 0', fontSize: '0.75rem', color: 'var(--muted)' }}>
              Google Gemini (gemini-flash-lite) active with deterministic regex fallback for guaranteed high-availability.
            </p>
          </div>
        </div>
      </div>

      {/* ── High-Tech Cybernetic 3-Tier Diagram (Reference Image 1) ── */}
      <div
        className="panel cyber-diagram"
        style={{
          background: 'var(--diagram-bg)',
          border: '1px solid rgba(56, 189, 248, 0.25)',
          boxShadow: 'var(--panel-shadow)',
          padding: '1.75rem 1.5rem',
          position: 'relative',
          overflow: 'hidden',
          width: '100%',
          boxSizing: 'border-box',
        }}
      >
        <div style={{ width: '100%', overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
          <div style={{ minWidth: 900 }}>
        {/* Tier Header Navigation Spanning Columns 1-2, 3-4, and 5-6 */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(180px, 1.1fr) 95px minmax(200px, 1.25fr) minmax(240px, 1.5fr) minmax(220px, 1.35fr) 95px',
            gap: '1.5rem',
            marginBottom: '1.25rem',
            width: '100%',
            boxSizing: 'border-box',
          }}
        >
          {/* Tier 1 Header */}
          <div
            style={{
              gridColumn: 'span 2',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '8px 14px',
              borderRadius: 6,
              background: 'rgba(56, 189, 248, 0.12)',
              border: '1px solid rgba(56, 189, 248, 0.35)',
            }}
          >
            <span style={{ color: '#0284c7', fontSize: '0.75rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Tier 1: Consumer Interfaces
            </span>
            <span style={{ color: 'var(--muted)', fontSize: '0.6875rem', fontWeight: 600 }}>Ingress &amp; Stream</span>
          </div>

          {/* Tier 2 Header */}
          <div
            style={{
              gridColumn: 'span 2',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '8px 14px',
              borderRadius: 6,
              background: 'rgba(139, 92, 246, 0.12)',
              border: '1px solid rgba(139, 92, 246, 0.35)',
            }}
          >
            <span style={{ color: '#7c3aed', fontSize: '0.75rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Tier 2: Control Plane &amp; Guard
            </span>
            <span style={{ color: 'var(--muted)', fontSize: '0.6875rem', fontWeight: 600 }}>PostLLMHook Interceptor</span>
          </div>

          {/* Tier 3 Header */}
          <div
            style={{
              gridColumn: 'span 2',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '8px 14px',
              borderRadius: 6,
              background: 'rgba(16, 185, 129, 0.12)',
              border: '1px solid rgba(16, 185, 129, 0.35)',
            }}
          >
            <span style={{ color: '#059669', fontSize: '0.75rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Tier 3: Data Plane &amp; Ground Truth
            </span>
            <span style={{ color: 'var(--muted)', fontSize: '0.6875rem', fontWeight: 600 }}>Tavily &amp; Cache</span>
          </div>
        </div>

        {/* ── The 5-Column Flow (Matching Reference Image 1) ── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(180px, 1.1fr) 95px minmax(200px, 1.25fr) minmax(240px, 1.5fr) minmax(220px, 1.35fr) 95px', gap: '1.5rem', alignItems: 'center', width: '100%', boxSizing: 'border-box' }}>

          {/* Col 1: INPUT CHANNELS */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontSize: '0.6875rem', fontWeight: 700, color: 'var(--muted)', letterSpacing: '0.06em', textAlign: 'center', textTransform: 'uppercase', marginBottom: 4 }}>
              Input Channels
            </div>

            {[
              { icon: <Globe size={14} />, label: 'Web App' },
              { icon: <Smartphone size={14} />, label: 'Mobile App' },
              { icon: <Terminal size={14} />, label: 'API / SDK' },
              { icon: <Building2 size={14} />, label: 'Enterprise Systems' },
            ].map((ch, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setSelectedComponent(COMPONENTS[0])}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '9px 12px',
                  borderRadius: 6,
                  background: 'var(--diagram-card)',
                  border: '1px solid rgba(56, 189, 248, 0.3)',
                  color: 'var(--text)',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'all 0.2s',
                }}
              >
                <span style={{ color: '#0284c7' }}>{ch.icon}</span>
                <span>{ch.label}</span>
              </button>
            ))}
          </div>

          {/* Col 2: FIRST GLASS CYLINDER (ASYNC EVENT STREAM) */}
          <CylinderStream label="Async Event" subtitle="202 Accepted" />

          {/* Col 3: MODEL ROUTING */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#7c3aed', letterSpacing: '0.06em', textAlign: 'center', textTransform: 'uppercase', marginBottom: 4 }}>
              Model Routing
            </div>

            <div
              onClick={() => setSelectedComponent(COMPONENTS[2])}
              style={{
                background: 'var(--diagram-card)',
                border: '1px solid rgba(139, 92, 246, 0.4)',
                borderRadius: 10,
                padding: '12px 14px',
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
                cursor: 'pointer',
              }}
            >
              {[
                { title: 'Gemini 1.5 Pro', desc: 'Complex reasoning' },
                { title: 'Gemini Flash', desc: 'Fast generation' },
                { title: 'Deterministic', desc: 'Regex fallback' },
              ].map((m, idx) => (
                <div key={idx} style={{ padding: '6px 8px', borderRadius: 4, background: 'var(--card-subtle)', border: '1px solid var(--border)' }}>
                  <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#7c3aed' }}>{m.title}</div>
                  <div style={{ fontSize: '0.625rem', color: 'var(--muted)' }}>{m.desc}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Col 4: PRIVACY & FRESHNESS GUARD (Glowing Shield Card) */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#d97706', letterSpacing: '0.06em', textAlign: 'center', textTransform: 'uppercase', marginBottom: 4 }}>
              Freshness Guard
            </div>

            <div
              onClick={() => setSelectedComponent(COMPONENTS[3])}
              style={{
                background: 'var(--diagram-card)',
                border: '2px solid #f59e0b',
                boxShadow: '0 0 20px rgba(245, 158, 11, 0.25)',
                borderRadius: 12,
                padding: '16px 14px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 10,
                cursor: 'pointer',
              }}
            >
              <div
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: '50%',
                  background: 'rgba(245, 158, 11, 0.15)',
                  border: '2px solid #f59e0b',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: '0 0 16px rgba(245, 158, 11, 0.3)',
                }}
              >
                <Shield size={28} color="#d97706" />
              </div>

              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '0.875rem', fontWeight: 800, color: 'var(--text)' }}>PostLLMHook</div>
                <div style={{ fontSize: '0.6875rem', color: '#d97706', fontWeight: 600 }}>Freshness Interceptor</div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, width: '100%', fontSize: '0.6875rem', marginTop: 4 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--current)' }}>
                  <Check size={12} /> Claim Triage Engine
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--current)' }}>
                  <Check size={12} /> Multi-Factor Scoring
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--current)' }}>
                  <Check size={12} /> Fail-Open 2000ms
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--current)' }}>
                  <Check size={12} /> Recursion Guard
                </div>
              </div>
            </div>
          </div>

          {/* Col 5: TOOLS (Tavily) & MEMORY SERVICES */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

            {/* Upper: TOOLS */}
            <div
              onClick={() => setSelectedComponent(COMPONENTS[4])}
              style={{
                background: 'var(--diagram-card)',
                border: '1px solid rgba(45, 212, 191, 0.3)',
                borderRadius: 8,
                padding: '10px 12px',
                cursor: 'pointer',
              }}
            >
              <div style={{ fontSize: '0.6875rem', fontWeight: 700, color: 'var(--accent)', textTransform: 'uppercase', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Wrench size={13} /> Tools &amp; Evidence
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.6875rem', color: 'var(--text-soft)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Search size={12} color="var(--accent)" /> Tavily Live Search
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Clock size={12} color="var(--accent)" /> Published Date Parser
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Key size={12} color="var(--accent)" /> Domain Authority Rank
                </div>
              </div>
            </div>

            {/* Lower: MEMORY SERVICES */}
            <div
              onClick={() => setSelectedComponent(COMPONENTS[5])}
              style={{
                background: 'var(--diagram-card)',
                border: '1px solid rgba(16, 185, 129, 0.3)',
                borderRadius: 8,
                padding: '10px 12px',
                cursor: 'pointer',
              }}
            >
              <div style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#059669', textTransform: 'uppercase', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Database size={13} /> Memory Services
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.6875rem', color: 'var(--text-soft)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Cpu size={12} color="#059669" /> L1 In-Memory Cache
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Database size={12} color="#059669" /> MongoDB Atlas Storage
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <BookOpen size={12} color="#059669" /> Volatility Heuristics
                </div>
              </div>
            </div>

          </div>

          {/* Col 6: SECOND GLASS CYLINDER (RESPONSE STREAM) */}
          <CylinderStream label="Response Stream" subtitle="SSE Broadcast" />

        </div>
          </div>
        </div>
      </div>

      {/* ── Selected Component Detailed Inspector Card ── */}
      <div
        className="panel"
        style={{
          background: 'var(--panel)',
          border: '1px solid var(--border)',
          padding: '1.25rem',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          width: '100%',
          boxSizing: 'border-box',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <h3 style={{ fontSize: '1.125rem', margin: 0, color: 'var(--accent)' }}>{selectedComponent.name}</h3>
            <span className="badge badge-muted">{selectedComponent.layer}</span>
          </div>
          <span
            className={`badge ${
              selectedComponent.status === 'verified' ? 'badge-current' :
              selectedComponent.status === 'degraded' ? 'badge-degraded' : 'badge-unverified'
            }`}
          >
            {selectedComponent.statusLabel}
          </span>
        </div>

        <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--text-soft)', lineHeight: 1.6 }}>
          {selectedComponent.description}
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
          <div style={{ background: 'var(--card-subtle)', padding: '10px 14px', borderRadius: 6, border: '1px solid var(--border)' }}>
            <div style={{ fontSize: '0.6875rem', color: 'var(--muted)', textTransform: 'uppercase', marginBottom: 2 }}>Core Responsibility</div>
            <p style={{ margin: 0, fontSize: '0.8125rem', color: 'var(--text)' }}>{selectedComponent.responsibility}</p>
          </div>
          <div style={{ background: 'var(--card-subtle)', padding: '10px 14px', borderRadius: 6, border: '1px solid var(--border)' }}>
            <div style={{ fontSize: '0.6875rem', color: 'var(--muted)', textTransform: 'uppercase', marginBottom: 2 }}>Technical Specification / Config</div>
            <code style={{ margin: 0, fontSize: '0.75rem', color: 'var(--accent)' }}>{selectedComponent.configuration}</code>
          </div>
        </div>
      </div>

      {/* ── Conditional Execution Paths ── */}
      <div className="panel" style={{ width: '100%', boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem', flexWrap: 'wrap', gap: 8 }}>
          <div>
            <h2 style={{ fontSize: '1rem', margin: 0 }}>Execution Modes &amp; Conditional Routing</h2>
            <p style={{ fontSize: '0.75rem', color: 'var(--muted)', margin: '2px 0 0' }}>
              FreshnessGuard supports four verification operational modes plus automatic resilience fallbacks
            </p>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {(['inline', 'async', 'basic', 'bypass', 'fallback'] as const).map(m => (
              <button
                key={m}
                type="button"
                onClick={() => setActivePathMode(m)}
                style={{
                  padding: '4px 10px',
                  borderRadius: 4,
                  fontSize: '0.75rem',
                  fontWeight: activePathMode === m ? 700 : 500,
                  background: activePathMode === m ? 'var(--accent-dim)' : 'transparent',
                  color: activePathMode === m ? 'var(--accent)' : 'var(--muted)',
                  border: `1px solid ${activePathMode === m ? 'var(--accent)' : 'var(--border)'}`,
                  textTransform: 'capitalize',
                }}
              >
                {m === 'fallback' ? '⚡ Deterministic Fallback' : m}
              </button>
            ))}
          </div>
        </div>

        <div style={{ background: 'var(--card-subtle)', padding: '1rem', borderRadius: 6, border: '1px solid var(--border)' }}>
          {activePathMode === 'inline' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ fontWeight: 600, color: 'var(--accent)', fontSize: '0.875rem' }}>Inline Mode (Default Gateway Behavior)</div>
              <p style={{ margin: 0, fontSize: '0.8125rem', color: 'var(--muted)', lineHeight: 1.6 }}>
                The AI Gateway intercepts the completion stream. FreshnessGuard blocks until claims are extracted, triaged, and corroborated via Tavily Search API. Injects <code>X-FreshnessGuard-Score</code>, <code>X-FreshnessGuard-Stale</code>, and <code>X-FreshnessGuard-Latency</code> headers before delivering the final verified payload to the user.
              </p>
            </div>
          )}
          {activePathMode === 'async' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ fontWeight: 600, color: 'var(--accent)', fontSize: '0.875rem' }}>Async Mode (Non-Blocking Streaming)</div>
              <p style={{ margin: 0, fontSize: '0.8125rem', color: 'var(--muted)', lineHeight: 1.6 }}>
                Returns HTTP 202 Accepted immediately so downstream applications experience zero gateway latency. Background workers execute live web verification asynchronously and stream progress and completion events directly to connected clients via Server-Sent Events (SSE).
              </p>
            </div>
          )}
          {activePathMode === 'basic' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ fontWeight: 600, color: 'var(--accent)', fontSize: '0.875rem' }}>Basic Mode (Fast Zero-Network Scoring)</div>
              <p style={{ margin: 0, fontSize: '0.8125rem', color: 'var(--muted)', lineHeight: 1.6 }}>
                Bypasses all outbound Tavily web search requests. Evaluates claims strictly via local heuristic and category volatility rules (e.g. pricing and API versions receive lower baseline confidence). Completes in under 5ms.
              </p>
            </div>
          )}
          {activePathMode === 'bypass' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ fontWeight: 600, color: 'var(--accent)', fontSize: '0.875rem' }}>Bypass Mode (Recursion Protection)</div>
              <p style={{ margin: 0, fontSize: '0.8125rem', color: 'var(--muted)', lineHeight: 1.6 }}>
                Triggered via <code>x-freshnessguard-bypass: true</code> or <code>x-bf-eh-freshnessguard-bypass: true</code>. FreshnessGuard immediately passes the response through with a score of 1.0 without claim extraction. Prevents infinite recursive verification loops when FreshnessGuard itself calls LLM providers.
              </p>
            </div>
          )}
          {activePathMode === 'fallback' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ fontWeight: 600, color: 'var(--unverified)', fontSize: '0.875rem' }}>Deterministic Extraction Fallback Path</div>
              <p style={{ margin: 0, fontSize: '0.8125rem', color: 'var(--muted)', lineHeight: 1.6 }}>
                When upstream LLM provider calls fail with quota limits (HTTP 429) or network timeouts, the extraction engine automatically catches the error and executes deterministic regex extractors. Factual statements are still passed to Tavily for full live web corroboration.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* ── Scoring Formula Details ── */}
      <div className="panel" style={{ width: '100%', boxSizing: 'border-box' }}>
        <h2 style={{ fontSize: '1rem', marginBottom: '0.75rem' }}>Freshness Scoring Formula &amp; Mathematical Bounds</h2>
        <p style={{ fontSize: '0.875rem', color: 'var(--muted)', lineHeight: 1.6, marginBottom: '1rem' }}>
          FreshnessGuard calculates a quantitative freshness score (0.00 – 1.00) using a composite formula designed to detect superseded information:
        </p>

        {/* Formula Display */}
        <div
          style={{
            background: 'var(--card-subtle)',
            padding: '12px 16px',
            borderRadius: 6,
            border: '1px solid var(--border)',
            fontFamily: 'var(--font-mono)',
            fontSize: '0.875rem',
            color: 'var(--accent)',
            marginBottom: '1rem',
            width: '100%',
            boxSizing: 'border-box',
          }}
        >
          claimScore = (Agreement × 0.40) + (Authority × 0.30) + (Recency × 0.20) + (Volume × 0.10)
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12, width: '100%', boxSizing: 'border-box' }}>
          {FORMULA_WEIGHTS.map(w => (
            <div key={w.label} style={{ background: 'var(--card-subtle)', border: '1px solid var(--border)', borderRadius: 6, padding: '10px 12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontWeight: 600, color: w.color, fontSize: '0.8125rem' }}>{w.label}</span>
                <span style={{ fontSize: '0.75rem', fontFamily: 'var(--font-mono)', color: 'var(--muted)' }}>weight: {(w.weight * 100).toFixed(0)}%</span>
              </div>
              <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--muted)', lineHeight: 1.4 }}>{w.description}</p>
            </div>
          ))}
        </div>

        {/* Safety Bounds Highlight */}
        <div style={{ marginTop: '1rem', padding: '12px 14px', borderRadius: 6, background: 'var(--stale-dim)', border: '1px solid var(--stale-border)' }}>
          <div style={{ fontWeight: 600, color: 'var(--stale)', fontSize: '0.8125rem', marginBottom: 4 }}>
            Critical Algorithmic Safety Bounds
          </div>
          <ul style={{ margin: 0, paddingLeft: '1.25rem', fontSize: '0.75rem', color: 'var(--text)', lineHeight: 1.6 }}>
            <li><strong>Unverified Ceiling:</strong> Unverified claims are strictly capped at <code>0.50</code> so third-party search noise cannot misclassify them as fresh.</li>
            <li><strong>Stale Ceiling:</strong> Stale claims with conflicting live values are capped at <code>0.35</code>.</li>
            <li><strong>Confidence vs Score:</strong> Verification confidence measures evidence certainty independently from whether the claim is fresh or stale.</li>
            <li><strong>Zero-Claim Distinction:</strong> Responses with 0 time-sensitive claims are tagged as <code>"No claims requiring verification"</code> (distinct from <code>"All verified fresh"</code>).</li>
          </ul>
        </div>
      </div>

    </div>
  );
}
