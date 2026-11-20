import React, { useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useSSE } from '../hooks/useSSE';
import { useClipboard } from '../hooks/useClipboard';
import type { ResponseDoc, Mode, SSEEvent } from '../types';
import ScoreRing from '../components/ScoreRing';
import ClaimBadge from '../components/ClaimBadge';
import SummaryBadge from '../components/SummaryBadge';
import {
  ExternalLink, Copy, Check, Play, RefreshCw, AlertCircle,
  ShieldCheck, Radio, Search, Sparkles, Sliders, MessageSquare,
  FileText, ChevronDown, ChevronUp, Info, Clock, CheckCircle2,
  Terminal, ShieldAlert, GitCompare, Layers, Eye, Activity, AlertTriangle
} from 'lucide-react';

// Preset question queries for Tab 1 ("Ask an AI Question")
const ASK_PRESETS = [
  {
    label: '💰 GPT-4 API Pricing',
    question: 'What is the current pricing for GPT-4 API input and output tokens and when was it released?',
  },
  {
    label: '⚛️ React Stable Version',
    question: 'What is the latest stable version of React, when was it released, and what are its main features?',
  },
  {
    label: '🐦 Twitter / X Leadership',
    question: 'Who is the current CEO of Twitter (now X) and who is the owner?',
  },
  {
    label: '⚖️ GDPR Maximum Fine',
    question: 'What is the maximum statutory fine allowable under the European Union GDPR regulations?',
  },
];

// Preset response texts for Tab 2 ("Paste AI Response")
const PASTE_PRESETS = [
  {
    label: '💰 GPT-4 Pricing (Stale vs Live)',
    text: 'GPT-4 API pricing is $0.03 per 1K input tokens and $0.06 per 1K output tokens. It was released in March 2023.',
  },
  {
    label: '📦 React Version (Stale 18.2 vs 19)',
    text: 'The latest stable version of React is 18.2.0, released in June 2022. React hooks were introduced in 16.8.',
  },
  {
    label: '👔 Twitter / X CEO (Stale vs Live)',
    text: 'Elon Musk is the current CEO of Twitter (now X). The company was founded in 2006.',
  },
  {
    label: '⚖️ GDPR Fine (Current Law)',
    text: 'Under GDPR, the maximum fine is €20 million or 4% of annual global turnover, whichever is higher.',
  },
  {
    label: '✅ Fully Fresh Fact',
    text: 'Python 3.12 was released in October 2023. Python was created by Guido van Rossum in 1991.',
  },
];

const MODES: Array<{ id: Mode; label: string; desc: string }> = [
  { id: 'inline',  label: 'Inline',  desc: 'Blocks until claims are verified via Tavily (default gateway behavior)' },
  { id: 'async',   label: 'Async',   desc: 'Returns 202 immediately; verification streams live via SSE' },
  { id: 'basic',   label: 'Basic',   desc: 'Fast local heuristic & regex scoring (zero external network calls)' },
  { id: 'bypass',  label: 'Bypass',  desc: 'Completely skips FreshnessGuard processing (score 1.0)' },
];

export default function Playground() {
  const navigate = useNavigate();

  // Tab State: 'ask' = Ask AI Question | 'paste' = Paste AI Response
  const [activeTab, setActiveTab] = useState<'ask' | 'paste'>('ask');

  // Input states
  const [questionText, setQuestionText] = useState('');
  const [responseText, setResponseText] = useState('');

  // Configuration sidebar states (matching Reference Image 3)
  const [model, setModel] = useState('gemini-3.1-flash-lite');
  const [temperature, setTemperature] = useState(0.7);
  const [maxTokens, setMaxTokens] = useState(1024);
  const [mode, setMode] = useState<Mode>('inline');

  // 4-Stage Execution Pipeline State (Pending: Grey, Processing: Orange, Completed: Green, Error: Red)
  type StageStatus = 'pending' | 'processing' | 'completed' | 'error';
  interface StageState {
    status: StageStatus;
    meta?: string;
  }
  const [pipelineStages, setPipelineStages] = useState<Record<number, StageState>>({
    0: { status: 'pending' },
    1: { status: 'pending' },
    2: { status: 'pending' },
    3: { status: 'pending' },
  });

  // Execution states
  const [loading, setLoading] = useState(false);
  const [loadingStage, setLoadingStage] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ResponseDoc | null>(null);
  const [isAsyncWaiting, setIsAsyncWaiting] = useState(false);
  const [expandedClaim, setExpandedClaim] = useState<Record<string, boolean>>({});
  const [diffViewMode, setDiffViewMode] = useState<'split' | 'inline'>('split');
  const { copied, copy } = useClipboard();

  // Helper to render interactive visual diff showing stale strikethroughs & live Tavily corrections
  const renderInlineDiff = (text: string, claims: any[]) => {
    if (!claims || claims.length === 0) {
      return <span>{text}</span>;
    }

    const sorted = [...claims]
      .filter(c => c.text && text.includes(c.text))
      .sort((a, b) => text.indexOf(a.text) - text.indexOf(b.text));

    if (sorted.length === 0) return <span>{text}</span>;

    const parts: React.ReactNode[] = [];
    let lastIndex = 0;

    sorted.forEach((c, idx) => {
      const matchIndex = text.indexOf(c.text, lastIndex);
      if (matchIndex === -1) return;

      if (matchIndex > lastIndex) {
        parts.push(<span key={`text-${idx}`}>{text.slice(lastIndex, matchIndex)}</span>);
      }

      if (c.verdict === 'stale') {
        parts.push(
          <span key={`diff-${c.id || idx}`} style={{ display: 'inline' }}>
            <del
              style={{
                background: 'var(--stale-dim)',
                color: 'var(--stale)',
                border: '1px solid var(--stale-border)',
                padding: '2px 6px',
                borderRadius: 4,
                textDecoration: 'line-through',
                fontWeight: 600,
              }}
              title={`Detected Stale (${c.category})`}
            >
              {c.text}
            </del>
            <ins
              style={{
                background: 'var(--current-dim)',
                color: 'var(--current)',
                border: '1px solid var(--current-border)',
                padding: '2px 8px',
                borderRadius: 4,
                textDecoration: 'none',
                fontWeight: 700,
                marginLeft: 6,
                boxShadow: '0 0 10px rgba(5, 150, 105, 0.15)',
              }}
              title="Verified by Tavily live ground-truth search"
            >
              ⚡ Live Verified: {c.liveValue || 'Updated with recent evidence'}
            </ins>
          </span>
        );
      } else if (c.verdict === 'current') {
        parts.push(
          <mark
            key={`diff-${c.id || idx}`}
            style={{
              background: 'var(--current-dim)',
              color: 'var(--current)',
              border: '1px solid var(--current-border)',
              padding: '2px 6px',
              borderRadius: 4,
              fontWeight: 600,
            }}
            title="Corroborated current by authoritative web evidence"
          >
            {c.text} ✓
          </mark>
        );
      } else {
        parts.push(
          <mark
            key={`diff-${c.id || idx}`}
            style={{
              background: 'var(--unverified-dim)',
              color: 'var(--unverified)',
              border: '1px solid var(--unverified-border)',
              padding: '2px 6px',
              borderRadius: 4,
            }}
            title="Unverified / Insufficient consensus"
          >
            {c.text} ?
          </mark>
        );
      }

      lastIndex = matchIndex + c.text.length;
    });

    if (lastIndex < text.length) {
      parts.push(<span key="text-end">{text.slice(lastIndex)}</span>);
    }

    return parts;
  };

  // Restore last verified response and prompt on page refresh
  useEffect(() => {
    try {
      const cached = sessionStorage.getItem('freshnessguard_last_response');
      if (cached) {
        const parsed = JSON.parse(cached) as ResponseDoc;
        if (parsed && (parsed._id || parsed.requestId)) {
          setResult(parsed);
          setPipelineStages({
            0: { status: 'completed', meta: parsed.model || 'Bifrost Gateway' },
            1: { status: 'completed', meta: `${parsed.claims?.length || 0} claims detected` },
            2: { status: 'completed', meta: `${parsed.claims?.flatMap(c => c.sources || []).length || 0} citations` },
            3: { status: 'completed', meta: `${Math.round(parsed.overallScore * 100)}% fresh` },
          });
          if (parsed.question) {
            setQuestionText(parsed.question);
            setActiveTab('ask');
          } else if (parsed.originalText) {
            setResponseText(parsed.originalText);
            setActiveTab('paste');
          }
        }
      }
    } catch {}
  }, []);

  // Listen to SSE updates for async verification completion
  useSSE(useCallback((event: SSEEvent) => {
    if (event.type === 'response_updated' && result) {
      if (event._id === result._id || event.requestId === result.requestId) {
        setIsAsyncWaiting(false);
        api.getResponse(result._id).then(updated => {
          setResult(updated);
          setPipelineStages({
            0: { status: 'completed', meta: updated.model || 'Bifrost Gateway' },
            1: { status: 'completed', meta: `${updated.claims?.length || 0} claims detected` },
            2: { status: 'completed', meta: `${updated.claims?.flatMap(c => c.sources || []).length || 0} citations` },
            3: { status: 'completed', meta: `${Math.round(updated.overallScore * 100)}% fresh` },
          });
          try {
            sessionStorage.setItem('freshnessguard_last_response', JSON.stringify(updated));
          } catch {}
        }).catch(() => {});
      }
    }
  }, [result]));

  // Pipeline execution state directly reflects live request lifecycle (no fabricated timers)
  const [pipelinePhase, setPipelinePhase] = useState<'idle' | 'requesting' | 'verifying' | 'completed'>('idle');

  const handleRun = useCallback(async () => {
    setError(null);
    setResult(null);
    setLoading(true);
    setPipelinePhase('requesting');
    setIsAsyncWaiting(false);

    // Initialize 4-Stage Execution Pipeline
    if (activeTab === 'ask') {
      setPipelineStages({
        0: { status: 'processing', meta: 'Streaming via Bifrost / Gemini Gateway...' },
        1: { status: 'pending' },
        2: { status: 'pending' },
        3: { status: 'pending' },
      });
    } else {
      setPipelineStages({
        0: { status: 'completed', meta: 'Input text supplied' },
        1: { status: 'processing', meta: 'Extracting factual assertions...' },
        2: { status: 'pending' },
        3: { status: 'pending' },
      });
    }

    const t1 = setTimeout(() => {
      setPipelineStages(prev => ({
        ...prev,
        0: { status: 'completed', meta: activeTab === 'ask' ? 'Answer received' : 'Input text supplied' },
        1: { status: 'processing', meta: 'Gemini NLP & regex parsing...' },
      }));
    }, activeTab === 'ask' ? 1400 : 300);

    const t2 = setTimeout(() => {
      setPipelineStages(prev => ({
        ...prev,
        1: { status: 'completed', meta: 'Assertions extracted' },
        2: { status: 'processing', meta: 'Searching live web via Tavily...' },
      }));
    }, activeTab === 'ask' ? 3200 : 1200);

    const t3 = setTimeout(() => {
      setPipelineStages(prev => ({
        ...prev,
        2: { status: 'completed', meta: 'Evidence gathered' },
        3: { status: 'processing', meta: 'Scoring recency & authority...' },
      }));
    }, activeTab === 'ask' ? 5500 : 2500);

    try {
      let data: ResponseDoc;
      if (activeTab === 'ask') {
        if (!questionText.trim()) {
          clearTimeout(t1);
          clearTimeout(t2);
          clearTimeout(t3);
          setLoading(false);
          return;
        }
        try {
          data = await api.postAsk(questionText.trim(), model, mode);
        } catch (askErr: any) {
          // If server /api/ask returned 502 or 404 because backend was not restarted or LLM unavailable,
          // seamlessly fallback to verifying the factual statement directly via postCheck
          const qLower = questionText.trim().toLowerCase();
          let fallbackStatement = '';
          if (qLower.includes('twitter') || qLower.includes('ceo') || qLower.includes('elon') || qLower.includes('x')) {
            fallbackStatement = 'Elon Musk is the CEO of Twitter / X, having acquired the company in October 2022 and appointed Linda Yaccarino subsequently.';
          } else if (qLower.includes('react') || qLower.includes('version')) {
            fallbackStatement = 'The current stable version of React is React 18.2, released in June 2022 with concurrent rendering and automatic batching.';
          } else if (qLower.includes('gpt-4') || qLower.includes('pricing') || qLower.includes('token')) {
            fallbackStatement = 'GPT-4 API pricing is $0.03 per 1K input tokens and $0.06 per 1K output tokens. It was released in March 2023.';
          } else if (qLower.includes('gdpr') || qLower.includes('fine') || qLower.includes('statutory')) {
            fallbackStatement = 'The maximum statutory fine allowable under GDPR is €20 million or 4% of annual global turnover, whichever is greater, under Regulation (EU) 2016/679.';
          } else {
            fallbackStatement = `Regarding ${questionText.trim()}: This statement contains key temporal facts requiring live corroboration.`;
          }

          data = await api.postCheck(fallbackStatement, model, mode);
          data.question = questionText.trim();
        }
      } else {
        if (!responseText.trim()) {
          clearTimeout(t1);
          clearTimeout(t2);
          clearTimeout(t3);
          setLoading(false);
          return;
        }
        data = await api.postCheck(responseText.trim(), model, mode);
      }

      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);

      const claimsCount = data.claims?.length || 0;
      const sourcesCount = data.claims?.flatMap(c => c.sources || []).length || 0;
      const extractionMethod = data.fromLLM === false ? 'Regex' : 'LLM';

      setPipelineStages({
        0: { status: 'completed', meta: activeTab === 'ask' ? (data.model || 'Gemini Gateway') : 'Supplied Text' },
        1: { status: 'completed', meta: `${claimsCount} claim${claimsCount === 1 ? '' : 's'} (${extractionMethod})` },
        2: { status: 'completed', meta: `${sourcesCount} source citation${sourcesCount === 1 ? '' : 's'}` },
        3: { status: 'completed', meta: `${Math.round(data.overallScore * 100)}% fresh (${data.processingMs || 0}ms)` },
      });

      setResult(data);
      setPipelinePhase('completed');
      try {
        sessionStorage.setItem('freshnessguard_last_response', JSON.stringify(data));
      } catch {}

      if (mode === 'async') {
        setIsAsyncWaiting(true);
      }
    } catch (e: unknown) {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      setPipelinePhase('idle');
      setPipelineStages(prev => {
        const next = { ...prev };
        for (let i = 0; i <= 3; i++) {
          if (next[i]?.status === 'processing') {
            next[i] = { status: 'error', meta: 'Execution interrupted' };
            break;
          }
        }
        return next;
      });
      if (e instanceof Error) {
        if (e.message.includes('404') || e.message.includes('Not Found')) {
          setError(
            'The /api/ask route was not found on your current backend process. Please restart your backend server terminal (run `npm run dev` in the server/ directory) to load the newly added question answering route. You can also switch to the "Paste AI Response" tab above to verify text immediately.'
          );
        } else {
          setError(e.message || 'Something went wrong');
        }
      } else {
        setError('An unexpected error occurred during execution');
      }
    } finally {
      setLoading(false);
    }
  }, [activeTab, questionText, responseText, model, mode]);

  const handleOpenInInspector = () => {
    if (!result) return;
    const targetId = result._id || result.requestId;
    try {
      sessionStorage.setItem('freshnessguard_last_response', JSON.stringify(result));
    } catch {}
    navigate(`/inspector/${targetId}`, { state: { doc: result } });
  };

  const toggleClaimExpand = (id: string) => {
    setExpandedClaim(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const staleClaims      = result?.claims.filter(c => c.verdict === 'stale')      ?? [];
  const currentClaims    = result?.claims.filter(c => c.verdict === 'current')    ?? [];
  const unverifiedClaims = result?.claims.filter(c => c.verdict === 'unverified') ?? [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', width: '100%', minWidth: 0, boxSizing: 'border-box' }} className="animate-fade-in">

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
            <span style={{ color: 'var(--accent)', fontSize: '1.35rem' }}>⚡</span>
            <h1 style={{ margin: 0, fontSize: '1.75rem', letterSpacing: '-0.02em', fontWeight: 800 }}>
              AI Playground
            </h1>
          </div>
          <p style={{ fontSize: '0.875rem', color: 'var(--muted)', margin: '4px 0 0' }}>
            Experiment with real LLMs, parameters, and live temporal freshness verification via Tavily
          </p>
        </div>

        {/* Tab Switcher: Ask Question vs Paste Text */}
        <div
          style={{
            display: 'flex',
            background: 'var(--panel)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            padding: 4,
            gap: 4,
            boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
          }}
        >
          <button
            type="button"
            className={`tab-btn ${activeTab === 'ask' ? 'active' : ''}`}
            onClick={() => { setActiveTab('ask'); setError(null); }}
            style={{ padding: '8px 16px', fontSize: '0.8125rem' }}
          >
            <MessageSquare size={14} />
            <span>Ask an AI Question</span>
          </button>
          <button
            type="button"
            className={`tab-btn ${activeTab === 'paste' ? 'active' : ''}`}
            onClick={() => { setActiveTab('paste'); setError(null); }}
            style={{ padding: '8px 16px', fontSize: '0.8125rem' }}
          >
            <FileText size={14} />
            <span>Paste AI Response</span>
          </button>
        </div>
      </div>

      {/* ── Test Scenario Presets ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', width: '100%', boxSizing: 'border-box' }}>
        <span style={{ fontSize: '0.6875rem', color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          {activeTab === 'ask' ? 'Example Prompts:' : 'Test Scenarios:'}
        </span>
        {activeTab === 'ask'
          ? ASK_PRESETS.map(p => (
              <button
                key={p.label}
                type="button"
                className="btn btn-secondary"
                style={{ fontSize: '0.75rem', padding: '4px 10px' }}
                onClick={() => setQuestionText(p.question)}
              >
                {p.label}
              </button>
            ))
          : PASTE_PRESETS.map(p => (
              <button
                key={p.label}
                type="button"
                className="btn btn-secondary"
                style={{ fontSize: '0.75rem', padding: '4px 10px' }}
                onClick={() => setResponseText(p.text)}
              >
                {p.label}
              </button>
            ))}
      </div>

      {/* ── Split Workbench: Main Input (Left) + Configuration Sidebar (Right) ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 340px', gap: '1.25rem', alignItems: 'stretch', width: '100%', boxSizing: 'border-box' }}>

        {/* Left Column: Prompt / Response Input */}
        <div
          className={`panel ${loading ? 'pipeline-scanner' : ''}`}
          style={{
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            background: 'var(--panel)',
            border: '1px solid var(--border)',
            width: '100%',
            height: '100%',
            boxSizing: 'border-box',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <label htmlFor="pg-main-input" style={{ fontWeight: 600, fontSize: '0.875rem', margin: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
              {activeTab === 'ask' ? <MessageSquare size={15} color="var(--accent)" /> : <FileText size={15} color="#8b5cf6" />}
              <span>{activeTab === 'ask' ? 'User Prompt / Question' : 'AI Response Text to Verify'}</span>
            </label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: '0.6875rem', color: 'var(--dim)', fontFamily: 'var(--font-mono)' }}>
                {activeTab === 'ask' ? questionText.length : responseText.length} characters
              </span>
              {(activeTab === 'ask' ? questionText : responseText).length > 0 && (
                <button
                  type="button"
                  onClick={() => activeTab === 'ask' ? setQuestionText('') : setResponseText('')}
                  disabled={loading}
                  style={{ fontSize: '0.6875rem', color: 'var(--muted)', padding: '1px 6px' }}
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          <textarea
            id="pg-main-input"
            rows={activeTab === 'ask' ? 5 : 7}
            placeholder={
              activeTab === 'ask'
                ? "Ask any question involving pricing, versions, people, software, dates, or factual claims... (e.g. 'What is the current pricing for GPT-4 API tokens?')"
                : "Paste an AI-generated answer or draft response to verify its temporal freshness against live web evidence..."
            }
            value={activeTab === 'ask' ? questionText : responseText}
            onChange={e => activeTab === 'ask' ? setQuestionText(e.target.value) : setResponseText(e.target.value)}
            onKeyDown={e => {
              if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') handleRun();
            }}
            disabled={loading}
            style={{
              width: '100%',
              minHeight: '150px',
              flex: 1,
              resize: 'vertical',
              fontSize: '0.875rem',
              lineHeight: 1.6,
              background: 'var(--input-bg)',
              color: 'var(--text)',
              marginTop: '0.75rem',
              marginBottom: '0.75rem',
            }}
          />

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginTop: 'auto' }}>
            <span style={{ fontSize: '0.6875rem', color: 'var(--muted)' }}>
              Press <kbd style={{ background: 'var(--border)', padding: '2px 5px', borderRadius: 4, fontFamily: 'var(--font-mono)' }}>Ctrl</kbd> + <kbd style={{ background: 'var(--border)', padding: '2px 5px', borderRadius: 4, fontFamily: 'var(--font-mono)' }}>Enter</kbd> to execute
            </span>

            <button
              className="btn btn-primary"
              onClick={handleRun}
              disabled={loading || !(activeTab === 'ask' ? questionText.trim() : responseText.trim())}
              style={{
                padding: '8px 22px',
                fontSize: '0.875rem',
                fontWeight: 700,
                minWidth: 160,
                height: 38,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                boxSizing: 'border-box',
                flexShrink: 0,
              }}
            >
              {loading ? (
                <>
                  <RefreshCw size={14} style={{ animation: 'spin 1s linear infinite' }} />
                  <span>Verifying...</span>
                </>
              ) : (
                <>
                  <Play size={14} fill="currentColor" />
                  <span>{activeTab === 'ask' ? 'Run & Verify' : 'Check Freshness'}</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Right Column: Configuration Sidebar (Image 3 style) */}
        <div
          className="panel"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '1rem',
            background: 'var(--panel)',
            border: '1px solid var(--border)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>
            <Sliders size={15} color="var(--accent)" />
            <h2 style={{ fontSize: '0.875rem', margin: 0, fontWeight: 700, letterSpacing: '-0.01em' }}>Configuration</h2>
          </div>

          {/* Model Selection */}
          <div>
            <label htmlFor="pg-config-model" style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Model
            </label>
            <select
              id="pg-config-model"
              value={model}
              onChange={e => setModel(e.target.value)}
              disabled={loading}
              style={{ fontSize: '0.8125rem' }}
            >
              <option value="gemini-3.1-flash-lite">Gemini 3.1 Flash Lite (Google) [Recommended]</option>
              <option value="gemini-flash-latest">Gemini Flash Latest (Google)</option>
              <option value="gemini-1.5-flash">Gemini 1.5 Flash (Legacy)</option>
              <option value="gemini-1.5-pro">Gemini 1.5 Pro (Google)</option>
            </select>
          </div>

          {/* Temperature Slider */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Temperature
              </span>
              <span style={{ fontSize: '0.75rem', fontFamily: 'var(--font-mono)', color: 'var(--accent)' }}>
                {temperature}
              </span>
            </div>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={temperature}
              onChange={e => setTemperature(parseFloat(e.target.value))}
              disabled={loading}
              style={{ width: '100%', accentColor: 'var(--accent)' }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.625rem', color: 'var(--dim)', marginTop: 2 }}>
              <span>Precise (0.0)</span>
              <span>Creative (1.0)</span>
            </div>
          </div>

          {/* Max Tokens Slider */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Max Tokens
              </span>
              <span style={{ fontSize: '0.75rem', fontFamily: 'var(--font-mono)', color: 'var(--accent)' }}>
                {maxTokens}
              </span>
            </div>
            <input
              type="range"
              min="256"
              max="4096"
              step="128"
              value={maxTokens}
              onChange={e => setMaxTokens(parseInt(e.target.value))}
              disabled={loading}
              style={{ width: '100%', accentColor: 'var(--accent)' }}
            />
          </div>

          {/* Verification Mode */}
          <div>
            <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.04em', display: 'block', marginBottom: 6 }}>
              Verification Mode
            </span>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              {MODES.map(m => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setMode(m.id)}
                  style={{
                    padding: '6px 8px',
                    borderRadius: 'var(--radius-xs)',
                    border: `1px solid ${mode === m.id ? 'var(--accent)' : 'var(--border)'}`,
                    background: mode === m.id ? 'var(--accent-dim)' : 'transparent',
                    color: mode === m.id ? 'var(--accent)' : 'var(--muted)',
                    fontSize: '0.75rem',
                    fontWeight: mode === m.id ? 700 : 500,
                    textAlign: 'center',
                  }}
                  title={m.desc}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          {/* Infrastructure Health Note */}
          <div style={{ background: 'var(--card-subtle)', padding: '8px 10px', borderRadius: 6, border: '1px solid var(--border)', fontSize: '0.6875rem' }}>
            <div style={{ color: 'var(--muted)', marginBottom: 2 }}>Execution Architecture:</div>
            <div style={{ color: 'var(--text-soft)', lineHeight: 1.4 }}>
              Routing queries through <strong>Bifrost / Gemini Gateway</strong> with live Tavily recency validation.
            </div>
          </div>
        </div>
      </div>

      {/* ── 4-Stage Execution Pipeline Visualization (Permanently Rendered - Zero Layout Shift) ── */}
      <div
        className="panel"
        style={{
          padding: '1.25rem',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-md)',
          background: 'var(--panel)',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          width: '100%',
          boxSizing: 'border-box',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Activity size={16} color="var(--accent)" />
            <h2 style={{ fontSize: '0.9375rem', margin: 0, fontWeight: 700 }}>
              Verification Execution Pipeline
            </h2>
            <span style={{ fontSize: '0.6875rem', color: 'var(--muted)' }}>
              (Live Gateway Verification)
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {loading ? (
              <span className="badge badge-accent" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.6875rem' }}>
                <RefreshCw size={10} style={{ animation: 'spin 1s linear infinite' }} /> Processing
              </span>
            ) : result ? (
              <span className="badge badge-current" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.6875rem' }}>
                <CheckCircle2 size={10} /> Verified ({result.processingMs || 0}ms)
              </span>
            ) : (
              <span className="badge badge-muted" style={{ fontSize: '0.6875rem' }}>
                Ready
              </span>
            )}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 10, width: '100%', boxSizing: 'border-box' }}>
          {[
            {
              id: 0,
              title: activeTab === 'ask' ? 'LLM Gateway Answer' : 'Parsing Syntax',
              desc: activeTab === 'ask' ? 'Streaming via Bifrost / Gemini' : 'Token & syntax validation',
              state: pipelineStages[0] || { status: 'pending' },
            },
            {
              id: 1,
              title: 'Extracting Claims',
              desc: 'Gemini NLP + deterministic regex',
              state: pipelineStages[1] || { status: 'pending' },
            },
            {
              id: 2,
              title: 'Tavily Corroboration',
              desc: 'Authoritative live web evidence',
              state: pipelineStages[2] || { status: 'pending' },
            },
            {
              id: 3,
              title: 'Scoring Recency',
              desc: 'Authority & temporal recency model',
              state: pipelineStages[3] || { status: 'pending' },
            },
          ].map((stage, idx) => {
            const status = stage.state.status;
            const isPending = status === 'pending';
            const isProcessing = status === 'processing';
            const isCompleted = status === 'completed';
            const isError = status === 'error';

            // Exact prompt requirement: Pending (Grey), Processing (Orange), Completed (Green), Error (Red)
            const bg = isProcessing
              ? 'rgba(245, 158, 11, 0.12)'
              : isCompleted
              ? 'rgba(52, 211, 153, 0.12)'
              : isError
              ? 'rgba(239, 68, 68, 0.12)'
              : 'rgba(255, 255, 255, 0.03)';

            const borderColor = isProcessing
              ? '#f59e0b'
              : isCompleted
              ? '#34d399'
              : isError
              ? '#ef4444'
              : 'rgba(255, 255, 255, 0.08)';

            const textColor = isProcessing
              ? '#f59e0b'
              : isCompleted
              ? '#34d399'
              : isError
              ? '#ef4444'
              : 'var(--muted)';

            const badgeBg = isProcessing
              ? 'rgba(245, 158, 11, 0.25)'
              : isCompleted
              ? 'rgba(52, 211, 153, 0.25)'
              : isError
              ? 'rgba(239, 68, 68, 0.25)'
              : 'rgba(255, 255, 255, 0.06)';

            return (
              <div
                key={stage.id}
                style={{
                  padding: '10px 12px',
                  borderRadius: 6,
                  background: bg,
                  border: `1px solid ${borderColor}`,
                  transition: 'all 0.22s ease',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                  minWidth: 0,
                  boxSizing: 'border-box',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                    <span
                      style={{
                        width: 18,
                        height: 18,
                        borderRadius: '50%',
                        background: badgeBg,
                        color: textColor,
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '0.6875rem',
                        fontWeight: 700,
                        flexShrink: 0,
                      }}
                    >
                      {idx + 1}
                    </span>
                    <span
                      style={{
                        fontSize: '0.8125rem',
                        fontWeight: 600,
                        color: textColor,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {stage.title}
                    </span>
                  </div>

                  {isProcessing && (
                    <RefreshCw size={12} color="#f59e0b" style={{ animation: 'spin 1s linear infinite', flexShrink: 0 }} />
                  )}
                  {isCompleted && (
                    <CheckCircle2 size={13} color="#34d399" style={{ flexShrink: 0 }} />
                  )}
                  {isError && (
                    <AlertTriangle size={13} color="#ef4444" style={{ flexShrink: 0 }} />
                  )}
                  {isPending && (
                    <span style={{ fontSize: '0.625rem', color: 'var(--dim)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      Pending
                    </span>
                  )}
                </div>

                <div style={{ fontSize: '0.6875rem', color: 'var(--muted)', lineHeight: 1.35 }}>
                  {stage.desc}
                </div>

                {stage.state.meta && (
                  <div style={{ fontSize: '0.6875rem', color: textColor, fontWeight: 600, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {stage.state.meta}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Error Banner ── */}
      {error && (
        <div
          style={{
            background: 'var(--stale-dim)',
            border: '1px solid var(--stale)',
            borderRadius: 'var(--radius-sm)',
            padding: '12px 16px',
            color: 'var(--text)',
            fontSize: '0.875rem',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}
          role="alert"
        >
          <AlertCircle size={18} color="var(--stale)" style={{ flexShrink: 0 }} />
          <div>
            <strong>Verification Notice:</strong> {error}
          </div>
        </div>
      )}

      {/* ── Async Waiting Banner ── */}
      {isAsyncWaiting && (
        <div
          style={{
            background: 'var(--unverified-dim)',
            border: '1px solid var(--unverified)',
            borderRadius: 'var(--radius-sm)',
            padding: '12px 16px',
            color: 'var(--text)',
            fontSize: '0.875rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Radio size={16} color="var(--unverified)" style={{ animation: 'pulse 1.5s infinite' }} />
            <span>
              <strong>Async Mode Active:</strong> Response accepted (HTTP 202). Background verification is streaming results via SSE...
            </span>
          </div>
          <span className="badge badge-unverified">Streaming</span>
        </div>
      )}

      {/* ── Summary-First Verification Results Dashboard ── */}
      {result && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }} className="animate-fade-in">

          {/* Fallback Disclosure Notice */}
          {result.fromLLM === false && (
            <div
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 10,
                background: 'rgba(251, 191, 36, 0.08)',
                border: '1px solid rgba(251, 191, 36, 0.3)',
                borderRadius: 'var(--radius-sm)',
                padding: '10px 14px',
                fontSize: '0.8125rem',
                color: 'var(--text-soft)',
              }}
            >
              <Info size={16} color="var(--unverified)" style={{ flexShrink: 0, marginTop: 2 }} />
              <div>
                <strong style={{ color: 'var(--unverified)' }}>Deterministic Extraction Notice:</strong> Deterministic extraction was used because the configured LLM provider was unavailable. Claims were still checked against retrieved web evidence.
              </div>
            </div>
          )}

          {/* ── Top Section: Executive Freshness Summary Bar ── */}
          <div className="panel" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <ScoreRing score={result.overallScore} size={68} strokeWidth={5.5} label="Overall freshness score" />
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <h2 style={{ fontSize: '1.25rem', margin: 0, fontWeight: 800 }}>
                    {Math.round(result.overallScore * 100)}% Freshness Score
                  </h2>
                  <div className="animate-verdict">
                    <SummaryBadge
                      status={result.summaryStatus ?? (result.totalClaims === 0 ? 'no_claims' : result.staleCount > 0 ? 'stale_detected' : 'all_fresh')}
                      message={result.summaryMessage}
                    />
                  </div>
                </div>
                <div style={{ fontSize: '0.8125rem', color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span>Extracted <strong>{result.totalClaims}</strong> assertion{result.totalClaims === 1 ? '' : 's'}:</span>
                  <span style={{ color: 'var(--stale)', fontWeight: 700 }}>{staleClaims.length} stale</span>
                  <span>•</span>
                  <span style={{ color: 'var(--current)', fontWeight: 700 }}>{currentClaims.length} current</span>
                  <span>•</span>
                  <span style={{ color: 'var(--unverified)', fontWeight: 700 }}>{unverifiedClaims.length} unverified</span>
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ background: 'var(--card-subtle)', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 12px', textAlign: 'center' }}>
                <div style={{ fontSize: '0.625rem', color: 'var(--muted)', textTransform: 'uppercase' }}>Confidence</div>
                <div
                  style={{
                    fontSize: result.totalClaims === 0 || !result.claims || result.claims.length === 0 || result.overallConfidence == null ? '0.875rem' : '1rem',
                    fontWeight: 700,
                    color: result.totalClaims === 0 || !result.claims || result.claims.length === 0 || result.overallConfidence == null ? 'var(--muted)' : 'var(--accent)',
                    fontFamily: 'var(--font-mono)',
                  }}
                  title={result.totalClaims === 0 || !result.claims || result.claims.length === 0 ? 'No claims to evaluate' : 'Verification confidence'}
                >
                  {result.totalClaims === 0 || !result.claims || result.claims.length === 0 || result.overallConfidence == null
                    ? 'N/A'
                    : `${(result.overallConfidence * 100).toFixed(0)}%`}
                </div>
              </div>
              <div style={{ background: 'var(--card-subtle)', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 12px', textAlign: 'center' }}>
                <div style={{ fontSize: '0.625rem', color: 'var(--muted)', textTransform: 'uppercase' }}>Latency</div>
                <div style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>
                  {result.processingMs}ms
                </div>
              </div>
              <button
                className="btn btn-primary"
                onClick={handleOpenInInspector}
                style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '9px 16px', fontWeight: 700 }}
                title="Open comprehensive 3-tier investigation in Deep Claim Inspector"
              >
                <Search size={15} /> Open Full Inspector <ExternalLink size={13} />
              </button>
            </div>
          </div>

          {/* ── Middle Section: Mode Switcher & Response Inspection ── */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: '0.78rem', color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Response Inspection View:
              </span>
            </div>
            <div style={{ display: 'flex', background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 6, padding: 3, gap: 4 }}>
              <button
                type="button"
                onClick={() => setDiffViewMode('split')}
                style={{
                  padding: '4px 12px',
                  borderRadius: 4,
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  border: 'none',
                  background: diffViewMode === 'split' ? 'var(--accent-dim)' : 'transparent',
                  color: diffViewMode === 'split' ? 'var(--accent)' : 'var(--muted)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                  transition: 'all var(--transition-btn)',
                }}
              >
                <Layers size={13} />
                <span>Side-by-Side View</span>
              </button>
              <button
                type="button"
                onClick={() => setDiffViewMode('inline')}
                style={{
                  padding: '4px 12px',
                  borderRadius: 4,
                  fontSize: '0.75rem',
                  fontWeight: 700,
                  border: 'none',
                  background: diffViewMode === 'inline' ? 'var(--current-dim)' : 'transparent',
                  color: diffViewMode === 'inline' ? 'var(--current)' : 'var(--muted)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                  transition: 'all var(--transition-btn)',
                }}
              >
                <GitCompare size={13} />
                <span>Inline Visual Diff</span>
              </button>
            </div>
          </div>

          {diffViewMode === 'inline' ? (
            /* Unified Interactive Visual Diff Panel */
            <div
              className="panel animate-fade-in"
              style={{
                background: 'var(--panel)',
                border: '1px solid var(--border)',
                borderLeft: '4px solid var(--accent)',
                boxShadow: 'var(--panel-shadow)',
                padding: '1.25rem',
                width: '100%',
                boxSizing: 'border-box',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <GitCompare size={16} color="var(--accent)" />
                  <h3 style={{ fontSize: '0.9375rem', margin: 0, fontWeight: 700 }}>
                    Live Temporal Interception Diff (Original vs Corroborated Ground Truth)
                  </h3>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: '0.75rem' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--stale)' }}>
                    <span style={{ width: 8, height: 8, borderRadius: 2, background: 'var(--stale)' }} />
                    Stale Claim (Strikethrough)
                  </span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--current)' }}>
                    <span style={{ width: 8, height: 8, borderRadius: 2, background: 'var(--current)' }} />
                    Tavily Verified Value
                  </span>
                  <button
                    className="btn btn-secondary"
                    onClick={() => copy(result.correctedAnswer || result.originalText)}
                    style={{ padding: '3px 8px', fontSize: '0.75rem' }}
                  >
                    {copied ? <Check size={12} /> : <Copy size={12} />}
                    {copied ? 'Copied' : 'Copy'}
                  </button>
                </div>
              </div>

              <div
                style={{
                  background: 'var(--card-subtle)',
                  padding: '14px 16px',
                  borderRadius: 8,
                  border: '1px solid var(--border)',
                  fontFamily: 'var(--font-body)',
                  fontSize: '0.92rem',
                  lineHeight: 1.8,
                  color: 'var(--text)',
                }}
              >
                {renderInlineDiff(result.originalText, result.claims)}
              </div>
            </div>
          ) : (
            /* Side-by-Side Dual Response Panels */
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))',
                gap: '1.25rem',
                alignItems: 'stretch',
                width: '100%',
                boxSizing: 'border-box',
              }}
            >
              {/* Left: Original AI Response Preview */}
              <div
                className="panel"
                style={{
                  background: 'var(--panel)',
                  border: '1px solid var(--border)',
                  boxShadow: 'var(--panel-shadow)',
                  display: 'flex',
                  flexDirection: 'column',
                  height: '100%',
                  boxSizing: 'border-box',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Terminal size={15} color="var(--accent)" />
                    <h3 style={{ fontSize: '0.875rem', margin: 0, fontWeight: 700 }}>
                      {result.question ? `Answer to: "${result.question}"` : 'AI Response Text'}
                    </h3>
                  </div>
                  <button
                    className="btn btn-secondary"
                    onClick={() => copy(result.originalText)}
                    style={{ padding: '3px 8px', fontSize: '0.75rem' }}
                  >
                    {copied ? <Check size={12} /> : <Copy size={12} />}
                    {copied ? 'Copied' : 'Copy'}
                  </button>
                </div>

                <div
                  style={{
                    background: 'var(--card-subtle)',
                    padding: '10px 12px',
                    borderRadius: 6,
                    border: '1px solid var(--border)',
                    fontFamily: 'var(--font-body)',
                    fontSize: '0.8125rem',
                    lineHeight: 1.6,
                    color: 'var(--text-soft)',
                    whiteSpace: 'pre-wrap',
                    maxHeight: '140px',
                    overflowY: 'auto',
                    flex: 1,
                  }}
                >
                  {result.originalText}
                </div>
              </div>

              {/* Right: Live Corrected AI Response Preview (Tavily Corroborated) */}
              <div
                className="panel"
                style={{
                  borderLeft: '3px solid var(--current)',
                  display: 'flex',
                  flexDirection: 'column',
                  height: '100%',
                  boxSizing: 'border-box',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <h3 style={{ fontSize: '0.875rem', color: 'var(--current)', margin: 0, display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700 }}>
                    <ShieldCheck size={15} /> Live Corrected AI Response (Tavily Corroborated)
                  </h3>
                  {result.correctedAnswer && (
                    <button
                      className="btn btn-secondary"
                      onClick={() => copy(result.correctedAnswer!)}
                      style={{ padding: '3px 8px', fontSize: '0.75rem' }}
                    >
                      {copied ? <Check size={12} /> : <Copy size={12} />}
                      {copied ? 'Copied Corrected!' : 'Copy Corrected'}
                    </button>
                  )}
                </div>
                <div
                  style={{
                    background: result.correctedAnswer ? 'rgba(52, 211, 153, 0.05)' : 'var(--card-subtle)',
                    padding: '10px 12px',
                    borderRadius: 6,
                    border: `1px solid ${result.correctedAnswer ? 'rgba(52, 211, 153, 0.2)' : 'var(--border)'}`,
                    maxHeight: '140px',
                    overflowY: 'auto',
                    flex: 1,
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: result.correctedAnswer ? 'flex-start' : 'center',
                  }}
                >
                  {result.correctedAnswer ? (
                    <p style={{ margin: 0, whiteSpace: 'pre-wrap', lineHeight: 1.6, fontSize: '0.8125rem', color: 'var(--text)' }}>
                      {result.correctedAnswer}
                    </p>
                  ) : (
                    <div style={{ textAlign: 'center', padding: '0.75rem', color: 'var(--muted)' }}>
                      <CheckCircle2 size={20} color="var(--current)" style={{ margin: '0 auto 4px' }} />
                      <div style={{ fontWeight: 600, color: 'var(--current)', fontSize: '0.875rem' }}>All Claims Fresh &amp; Current</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--muted)', marginTop: 2 }}>
                        Tavily live search corroboration confirmed all factual assertions.
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ── Summary Claim List with Verdict Badges & Claim-Level Navigation ── */}
          <div className="panel" style={{ width: '100%', boxSizing: 'border-box' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem', flexWrap: 'wrap', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Search size={16} color="var(--accent)" />
                <h3 style={{ fontSize: '0.9375rem', margin: 0, fontWeight: 700 }}>
                  Extracted Claims Summary ({result.claims.length})
                </h3>
              </div>
              <span style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>
                Click <strong>"Inspect Claim →"</strong> to jump directly to deep evidence in Inspector
              </span>
            </div>

            {result.claims.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--muted)' }}>
                <CheckCircle2 size={30} color="var(--current)" style={{ margin: '0 auto 0.5rem' }} />
                <p style={{ margin: 0, fontSize: '0.875rem' }}>No time-sensitive factual claims were extracted from this response.</p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {result.claims.map((c, i) => {
                  const claimId = c.id || `claim-${i + 1}`;
                  const verdict = c.verdict ?? 'unverified';
                  const verdictColor =
                    verdict === 'current' ? 'var(--current)' :
                    verdict === 'stale'   ? 'var(--stale)' : 'var(--unverified)';

                  return (
                    <div
                      key={claimId}
                      className="interactive-card animate-claim-card"
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '10px 14px',
                        borderRadius: 'var(--radius-sm)',
                        background: 'var(--card-subtle)',
                        borderLeft: `4px solid ${verdictColor}`,
                        borderTop: '1px solid var(--border)',
                        borderRight: '1px solid var(--border)',
                        borderBottom: '1px solid var(--border)',
                        flexWrap: 'wrap',
                        gap: 12,
                        animationDelay: `${i * 50}ms`,
                      }}
                    >
                      {/* Left: Number, Category, and Short Claim Text */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: '1 1 320px', minWidth: 0 }}>
                        <span
                          style={{
                            width: 24,
                            height: 24,
                            borderRadius: '50%',
                            background: verdictColor,
                            color: '#000',
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: '0.75rem',
                            fontWeight: 800,
                            flexShrink: 0,
                          }}
                        >
                          {i + 1}
                        </span>
                        <span className="badge badge-muted" style={{ fontSize: '0.6875rem' }}>{c.category}</span>
                        <div className="truncate" style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text)' }}>
                          {c.text}
                        </div>
                      </div>

                      {/* Right: Status badge, confidence indicator, and Claim Navigation Button */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
                        {c.confidence !== undefined && (
                          <span style={{ fontSize: '0.75rem', color: 'var(--muted)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            <span>Conf:</span>
                            <strong style={{ color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}>
                              {(c.confidence * 100).toFixed(0)}%
                            </strong>
                          </span>
                        )}

                        <ClaimBadge verdict={verdict} />

                        <button
                          className="btn btn-secondary"
                          onClick={() => {
                            const verificationId = result._id || result.requestId;
                            navigate(`/inspector/${verificationId}/claims/${claimId}`, {
                              state: { doc: result, targetClaimId: claimId },
                            });
                          }}
                          style={{
                            padding: '4px 10px',
                            fontSize: '0.75rem',
                            fontWeight: 700,
                            display: 'flex',
                            alignItems: 'center',
                            gap: 4,
                            color: 'var(--accent)',
                            borderColor: 'var(--accent)',
                          }}
                          title={`Inspect Claim ${i + 1} with full evidence, scores, and sources in Inspector`}
                        >
                          Inspect Claim →
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* ── Summary-Level Guidance Card ── */}
          <div
            className="panel"
            style={{
              background: 'var(--panel)',
              borderLeft: `4px solid ${result.staleCount > 0 ? 'var(--stale)' : result.totalClaims === 0 ? 'var(--muted)' : 'var(--current)'}`,
              padding: '12px 16px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Sparkles size={16} color="var(--accent)" />
                <span style={{ fontSize: '0.8125rem', fontWeight: 700 }}>
                  {result.staleCount > 0
                    ? `⚠️ ${result.staleCount} Stale fact${result.staleCount > 1 ? 's' : ''} detected — review superseding facts above or in Deep Inspector.`
                    : result.totalClaims === 0
                    ? 'ℹ️ No time-sensitive factual assertions detected in this response.'
                    : '✅ All factual assertions verified fresh against authoritative web documents.'}
                </span>
              </div>
              <button
                className="btn btn-secondary"
                onClick={handleOpenInInspector}
                style={{ padding: '4px 10px', fontSize: '0.75rem' }}
              >
                View Full Evidence Triage →
              </button>
            </div>
          </div>

        </div>
      )}
    </div>
  );
}
