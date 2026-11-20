import React, { useState, useEffect } from 'react';
import { Link, useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import {
  Shield,
  Eye,
  EyeOff,
  AlertCircle,
  ArrowRight,
  Sparkles,
  CheckCircle2,
  Cpu,
  Globe,
  Lock,
  Layers,
  Network,
  Sun,
  Moon,
  Activity,
  Zap,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { api } from '../api/client';

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { login, loginDemo } = useAuth();
  const { theme, toggleTheme } = useTheme();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [demoLoading, setDemoLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [googleConfigured, setGoogleConfigured] = useState<boolean | null>(null);

  // Return path after successful authentication
  const from = (location.state as any)?.from?.pathname || '/';

  // Check URL error parameter and provider status on mount
  useEffect(() => {
    const urlError = searchParams.get('error');
    if (urlError) {
      setError(decodeURIComponent(urlError));
    }

    api.getAuthProviders()
      .then((res) => setGoogleConfigured(res.google))
      .catch(() => setGoogleConfigured(true)); // Graceful fallback
  }, [searchParams]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      setError('Please provide both email and password.');
      return;
    }

    try {
      setLoading(true);
      setError(null);
      await login(email, password);
      navigate(from, { replace: true });
    } catch (err: any) {
      setError(err.message || 'Login failed. Please check your credentials.');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = () => {
    if (googleConfigured === false) {
      setError(
        'Google OAuth credentials (GOOGLE_CLIENT_ID & GOOGLE_CLIENT_SECRET) are not set in server/.env. You can sign in using Email & Password or use the 1-Click Demo Workspace below.'
      );
      return;
    }
    // Direct browser redirect to Google OAuth authorization endpoint
    window.location.href = '/api/auth/google';
  };

  const handleQuickDemo = async () => {
    try {
      setDemoLoading(true);
      setError(null);
      await loginDemo();
      navigate(from, { replace: true });
    } catch (err: any) {
      setError(err.message || 'Failed to initialize demo workspace.');
    } finally {
      setDemoLoading(false);
    }
  };

  return (
    <div
      style={{
        height: '100vh',
        width: '100vw',
        display: 'flex',
        flexWrap: 'wrap',
        background: 'var(--bg)',
        color: 'var(--text)',
        boxSizing: 'border-box',
        overflow: 'hidden',
        transition: 'background var(--transition), color var(--transition)',
      }}
    >
      {/* ── LEFT SECTION: Hero, Architecture & Live Pipeline (Direct on Background, Compact & Fully Scrollable) ── */}
      <div
        style={{
          flex: '1 1 500px',
          height: '100vh',
          background: 'var(--auth-left-bg)',
          borderRight: '1px solid var(--border)',
          padding: '1.25rem 1.75rem',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'flex-start',
          boxSizing: 'border-box',
          position: 'relative',
          overflowY: 'auto',
          transition: 'background var(--transition)',
        }}
      >
        {/* Left Information Card / Plate for 100% High Legibility in both Light & Dark Themes */}
        <div
          style={{
            width: '100%',
            maxWidth: '520px',
            margin: 'auto 0',
            padding: '1.25rem 1.5rem',
            background: 'var(--auth-left-card-bg)',
            backdropFilter: 'blur(24px)',
            WebkitBackdropFilter: 'blur(24px)',
            borderRadius: '16px',
            border: '1px solid var(--auth-left-card-border)',
            boxShadow: 'var(--auth-card-shadow)',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.75rem',
            boxSizing: 'border-box',
          }}
          className="animate-fade-in"
        >
          {/* Brand Header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div
              style={{
                width: 38,
                height: 38,
                borderRadius: '10px',
                background: 'linear-gradient(135deg, rgba(45, 212, 191, 0.3), rgba(139, 92, 246, 0.25))',
                border: '1.5px solid var(--accent)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 0 16px rgba(45, 212, 191, 0.35)',
                flexShrink: 0,
              }}
            >
              <Shield size={20} color="var(--accent)" strokeWidth={2.4} />
            </div>
            <div>
              <div style={{ fontSize: '1.25rem', fontWeight: 800, letterSpacing: '-0.02em', lineHeight: 1.2, color: 'var(--auth-text-title)' }}>
                FreshnessGuard
              </div>
              <div style={{ fontSize: '0.7rem', color: 'var(--accent)', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                AI Temporal Verification Gateway
              </div>
            </div>
          </div>

          {/* Headline & Value Proposition */}
          <div>
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '3px 8px',
                borderRadius: 14,
                background: 'var(--accent-dim)',
                border: '1px solid rgba(45, 212, 191, 0.40)',
                color: 'var(--accent)',
                fontSize: '0.7rem',
                fontWeight: 700,
                marginBottom: '0.35rem',
              }}
            >
              <Sparkles size={12} />
              <span>Bifrost Gateway &amp; Tavily Real-Time Intelligence</span>
            </div>

            <h1
              style={{
                fontSize: 'clamp(1.15rem, 1.4vw, 1.35rem)',
                fontWeight: 800,
                letterSpacing: '-0.025em',
                lineHeight: 1.25,
                margin: '0 0 0.35rem',
                color: 'var(--auth-text-title)',
              }}
            >
              Real-Time AI Hallucination &amp; Stale Fact Interception
            </h1>
            <p
              style={{
                fontSize: '0.8125rem',
                color: 'var(--auth-text-body)',
                lineHeight: 1.45,
                margin: 0,
                fontWeight: 450,
              }}
            >
              FreshnessGuard intercepts LLM responses directly at the AI Gateway data plane. It parses time-sensitive assertions across version numbers, release dates, pricing, and leadership—corroborating them concurrently against authoritative web documents via Tavily before answers reach end users.
            </p>
          </div>

          {/* Live Temporal Verification Stream */}
          <div style={{ width: '100%' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8125rem', fontWeight: 700, color: 'var(--auth-text-title)' }}>
                <Network size={14} color="var(--accent)" />
                <span>Temporal Verification Flow</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: '0.7rem', color: 'var(--current)', fontWeight: 700 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--current)', boxShadow: '0 0 6px var(--current)' }} />
                Live Pipeline Active
              </div>
            </div>

            {/* 5-Step Pipeline Steps */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', position: 'relative' }}>
              {[
                {
                  step: '1',
                  title: 'LLM Response Stream',
                  desc: 'Gemini, GPT-4, or Claude streams response tokens through AI Gateway',
                  color: 'var(--accent)',
                  icon: Cpu,
                },
                {
                  step: '2',
                  title: 'Bifrost PostLLMHook Interposition',
                  desc: 'Captures output buffer in 2.1ms with fail-open safety timeout bounds',
                  color: '#38BDF8',
                  icon: Activity,
                },
                {
                  step: '3',
                  title: 'FreshnessGuard Claim Extractor',
                  desc: 'Gemini structured JSON + high-precision regex isolate time-sensitive assertions',
                  color: '#A855F7',
                  icon: Layers,
                },
                {
                  step: '4',
                  title: 'Tavily Live Web Corroboration',
                  desc: 'Concurrent queries against live documentation and official news sources',
                  color: '#F59E0B',
                  icon: Globe,
                },
                {
                  step: '5',
                  title: 'Scoring & Live Correction',
                  desc: 'Verdicts (Current / Stale / Unverified) with superseding factual citations',
                  color: 'var(--current)',
                  icon: CheckCircle2,
                },
              ].map((node) => {
                const Icon = node.icon;
                return (
                  <div
                    key={node.step}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '4px 8px',
                      borderRadius: '6px',
                      background: 'var(--auth-left-step-bg)',
                      border: '1px solid var(--auth-left-step-border)',
                      boxShadow: '0 1px 4px rgba(0,0,0,0.03)',
                    }}
                  >
                    <div
                      style={{
                        width: 24,
                        height: 24,
                        borderRadius: '6px',
                        background: 'var(--auth-badge-bg)',
                        border: `1.5px solid ${node.color}`,
                        color: node.color,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontWeight: 800,
                        fontSize: '0.7rem',
                        flexShrink: 0,
                        boxShadow: `0 0 8px ${node.color}25`,
                      }}
                    >
                      <Icon size={12} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--auth-text-title)' }}>
                          {node.title}
                        </span>
                        <span style={{ fontSize: '0.68rem', color: node.color, fontWeight: 700 }}>
                          #{node.step}
                        </span>
                      </div>
                      <div style={{ fontSize: '0.6875rem', color: 'var(--auth-text-muted)', marginTop: 1, lineHeight: 1.3, fontWeight: 450 }}>
                        {node.desc}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Feature Highlights Footer */}
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: 6,
              paddingTop: '0.35rem',
              borderTop: '1px solid var(--border)',
            }}
          >
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                padding: '3px 8px',
                borderRadius: 14,
                background: 'var(--auth-badge-bg)',
                border: '1px solid var(--auth-badge-border)',
                fontSize: '0.7rem',
                fontWeight: 600,
                color: 'var(--auth-text-title)',
              }}
            >
              <Zap size={11} color="var(--accent)" />
              <span>Sub-Second Latency</span>
            </div>
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                padding: '3px 8px',
                borderRadius: 14,
                background: 'var(--auth-badge-bg)',
                border: '1px solid var(--auth-badge-border)',
                fontSize: '0.7rem',
                fontWeight: 600,
                color: 'var(--auth-text-title)',
              }}
            >
              <Globe size={11} color="#F59E0B" />
              <span>Tavily Corroborated</span>
            </div>
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                padding: '3px 8px',
                borderRadius: 14,
                background: 'var(--auth-badge-bg)',
                border: '1px solid var(--auth-badge-border)',
                fontSize: '0.7rem',
                fontWeight: 600,
                color: 'var(--current)',
              }}
            >
              <Lock size={11} color="var(--current)" />
              <span>Tenant Isolation</span>
            </div>
          </div>
        </div>
      </div>

      {/* ── RIGHT SECTION: Authentication Workbench (Always Centered & Fully Scrollable) ── */}
      <div
        style={{
          flex: '1 1 420px',
          height: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '1.5rem',
          boxSizing: 'border-box',
          position: 'relative',
          overflowY: 'auto',
          background: 'var(--auth-right-bg)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          transition: 'background var(--transition)',
        }}
      >
        {/* Top Bar: Theme Switcher Toggle pinned to top-right */}
        <div style={{ position: 'absolute', top: '1.25rem', right: '1.5rem', zIndex: 20 }}>
          <button
            onClick={toggleTheme}
            className="btn btn-secondary"
            style={{
              padding: '6px 12px',
              fontSize: '0.75rem',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              boxShadow: 'var(--panel-shadow)',
              backdropFilter: 'blur(10px)',
              background: 'var(--panel)',
            }}
            title={`Switch to ${theme === 'dark' ? 'Light' : 'Dark'} Theme`}
          >
            {theme === 'dark' ? (
              <>
                <Sun size={14} color="#f59e0b" />
                <span style={{ fontWeight: 600 }}>Light Theme</span>
              </>
            ) : (
              <>
                <Moon size={14} color="#0D9488" />
                <span style={{ fontWeight: 600 }}>Dark Theme</span>
              </>
            )}
          </button>
        </div>

        {/* Center Card Content: Frosted Glassmorphic Panel (Strictly Centered) */}
        <div
          style={{
            width: '100%',
            maxWidth: '420px',
            margin: '0 auto',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            boxSizing: 'border-box',
          }}
        >
          <div
            style={{
              width: '100%',
              padding: '1.75rem 2rem',
              background: 'var(--auth-card-bg)',
              backdropFilter: 'blur(24px)',
              WebkitBackdropFilter: 'blur(24px)',
              borderRadius: '16px',
              border: '1px solid var(--auth-card-border)',
              boxShadow: 'var(--auth-card-shadow)',
              boxSizing: 'border-box',
            }}
            className="animate-fade-in"
          >
          <div style={{ marginBottom: '1.75rem' }}>
            <h2 style={{ fontSize: '1.625rem', fontWeight: 800, letterSpacing: '-0.02em', margin: '0 0 0.5rem', color: 'var(--text)' }}>
              Sign In to Workspace
            </h2>
            <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--muted)', lineHeight: 1.5 }}>
              Access your personal verification runs, telemetry, and claim investigation vault.
            </p>
          </div>

          {/* Error Alert Banner */}
          {error && (
            <div
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 10,
                padding: '12px 14px',
                borderRadius: 'var(--radius-sm)',
                background: 'var(--stale-dim)',
                border: '1px solid var(--stale-border)',
                color: 'var(--stale)',
                fontSize: '0.8125rem',
                marginBottom: '1.25rem',
              }}
            >
              <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
              <div style={{ lineHeight: 1.4 }}>{error}</div>
            </div>
          )}

          {/* Google OAuth Button */}
          <button
            type="button"
            onClick={handleGoogleLogin}
            className="btn interactive-card"
            style={{
              width: '100%',
              height: '46px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 10,
              background: 'var(--card-subtle)',
              border: '1px solid var(--border)',
              color: 'var(--text)',
              borderRadius: 'var(--radius-sm)',
              fontSize: '0.875rem',
              fontWeight: 600,
              cursor: 'pointer',
              boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24">
              <path
                fill="#4285F4"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path
                fill="#34A853"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="#FBBC05"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
              />
              <path
                fill="#EA4335"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
              />
            </svg>
            Continue with Google
          </button>

          {/* Divider */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              margin: '1.5rem 0',
              color: 'var(--dim)',
              fontSize: '0.75rem',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}
          >
            <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
            <span style={{ padding: '0 12px' }}>or sign in with email</span>
            <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
          </div>

          {/* Email / Password Form */}
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div>
              <label
                htmlFor="email"
                style={{
                  display: 'block',
                  fontSize: '0.8125rem',
                  fontWeight: 600,
                  color: 'var(--text)',
                  marginBottom: 6,
                }}
              >
                Work email address
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="operator@enterprise.com"
                required
                autoComplete="email"
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  padding: '11px 14px',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border)',
                  background: 'var(--card-subtle)',
                  color: 'var(--text)',
                  fontSize: '0.875rem',
                  outline: 'none',
                }}
              />
            </div>

            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <label
                  htmlFor="password"
                  style={{
                    fontSize: '0.8125rem',
                    fontWeight: 600,
                    color: 'var(--text)',
                  }}
                >
                  Password
                </label>
                <Link
                  to="/forgot-password"
                  style={{
                    fontSize: '0.75rem',
                    color: 'var(--accent)',
                    textDecoration: 'none',
                    fontWeight: 500,
                  }}
                >
                  Forgot password?
                </Link>
              </div>
              <div style={{ position: 'relative' }}>
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  required
                  autoComplete="current-password"
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    padding: '11px 42px 11px 14px',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border)',
                    background: 'var(--card-subtle)',
                    color: 'var(--text)',
                    fontSize: '0.875rem',
                    outline: 'none',
                  }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  style={{
                    position: 'absolute',
                    right: 10,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'none',
                    border: 'none',
                    color: 'var(--muted)',
                    cursor: 'pointer',
                    padding: 4,
                    display: 'flex',
                    alignItems: 'center',
                  }}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="btn btn-primary"
              style={{
                width: '100%',
                height: '44px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                fontSize: '0.875rem',
                fontWeight: 700,
                marginTop: '0.5rem',
              }}
            >
              {loading ? 'Authenticating…' : 'Sign In to Workspace'}
              {!loading && <ArrowRight size={14} />}
            </button>
          </form>

          {/* Switch to Register */}
          <div style={{ marginTop: '1.75rem', textAlign: 'center', fontSize: '0.8125rem', color: 'var(--muted)' }}>
            Don't have an account?{' '}
            <Link to="/register" style={{ color: 'var(--accent)', fontWeight: 600, textDecoration: 'none' }}>
              Create personal workspace
            </Link>
          </div>

          <div style={{ marginTop: '0.75rem', textAlign: 'center', fontSize: '0.75rem', color: 'var(--dim)' }}>
            Need a quick look?{' '}
            <button
              type="button"
              onClick={handleQuickDemo}
              disabled={demoLoading}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--accent)',
                cursor: 'pointer',
                padding: 0,
                fontSize: '0.75rem',
                textDecoration: 'underline',
              }}
            >
              {demoLoading ? 'Loading demo…' : 'Explore demo workspace'}
            </button>
          </div>
          </div>

          {/* Bottom Disclaimer */}
          <div style={{ textAlign: 'center', fontSize: '0.6875rem', color: 'var(--dim)', marginTop: '1.25rem' }}>
            FreshnessGuard Enterprise Verification Engine • Geek Room 2026
          </div>
        </div>
      </div>
    </div>
  );
}
