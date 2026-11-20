import React, { useState, useRef, useEffect } from 'react';
import { useLocation, useNavigate, Link } from 'react-router-dom';
import {
  Sun,
  Moon,
  Radio,
  Shield,
  Sparkles,
  RefreshCw,
  User,
  Settings,
  LogOut,
  ChevronDown,
  ExternalLink,
  Layers,
  Menu,
} from 'lucide-react';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { useSSE } from '../hooks/useSSE';
import { useSidebar } from './Layout';

const PAGE_TITLES: Record<string, { group: string; title: string; subtitle: string }> = {
  '/': { group: 'Workspace', title: 'Overview & Telemetry', subtitle: 'Command Center & Telemetry' },
  '/playground': { group: 'Workspace', title: 'AI Playground', subtitle: 'Dual Mode Verification Sandbox' },
  '/inspector': { group: 'Workspace', title: 'Deep Claim Inspector', subtitle: 'Case Investigation & Evidence Triage' },
  '/policies': { group: 'Intelligence', title: 'Verification Policies', subtitle: 'Gateway Triage & Quota Rules' },
  '/evidence': { group: 'Intelligence', title: 'Evidence Explorer', subtitle: 'Corroboration & Citation Audit' },
  '/traces': { group: 'Intelligence', title: 'Decision Traces', subtitle: 'Distributed Request Lifecycle Tracing' },
  '/benchmarks': { group: 'Performance', title: 'Architecture Benchmarks', subtitle: 'Empirical Verification Evaluation' },
  '/analytics': { group: 'Performance', title: 'Response Analytics', subtitle: 'Temporal Drift & Cache Telemetry' },
  '/architecture': { group: 'Platform', title: 'System Architecture', subtitle: 'Data Plane & Control Plane Blueprint' },
  '/integrations': { group: 'Platform', title: 'Platform Integrations', subtitle: 'Gateway Health & Provider Connectivity' },
  '/settings': { group: 'Platform', title: 'Workspace Settings', subtitle: 'Account & Security Preferences' },
};

export default function TopHeader() {
  const location = useLocation();
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();
  const { user, logout } = useAuth();
  const { connected } = useSSE(() => {});
  const { collapsed, toggleCollapsed, toggleMobile } = useSidebar();

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close profile dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Derive current page info
  const path = location.pathname;
  let pageInfo = PAGE_TITLES[path];
  if (!pageInfo && path.startsWith('/inspector')) {
    pageInfo = { group: 'Workspace', title: 'Deep Claim Inspector', subtitle: 'Case Investigation' };
  }
  if (!pageInfo) {
    pageInfo = { group: 'Platform', title: 'FreshnessGuard', subtitle: 'AI Temporal Verification' };
  }

  const handleLogout = async () => {
    setMenuOpen(false);
    await logout();
    navigate('/login');
  };

  const userInitial = user?.displayName ? user.displayName.charAt(0).toUpperCase() : 'U';

  return (
    <header
      style={{
        height: '56px',
        minHeight: '56px',
        width: '100%',
        boxSizing: 'border-box',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 1.5rem',
        background: 'var(--panel)',
        backdropFilter: 'var(--panel-blur)',
        WebkitBackdropFilter: 'var(--panel-blur)',
        borderBottom: '1px solid var(--border)',
        zIndex: 20,
        transition: 'background-color var(--transition), border-color var(--transition)',
      }}
    >
      {/* Left: Sidebar Toggle + Clean Breadcrumbs */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button
          onClick={() => {
            if (window.innerWidth < 768) {
              toggleMobile();
            } else {
              toggleCollapsed();
            }
          }}
          className="btn btn-secondary"
          style={{
            padding: '6px 8px',
            fontSize: '0.75rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 'var(--radius-sm)',
          }}
          aria-label="Toggle navigation sidebar"
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <Menu size={16} />
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.8125rem' }}>
          <span style={{ color: 'var(--muted)', fontWeight: 500 }}>FreshnessGuard</span>
          <span style={{ color: 'var(--dim)' }}>/</span>
          <span style={{ color: 'var(--muted)', fontWeight: 500 }}>{pageInfo.group}</span>
          <span style={{ color: 'var(--dim)' }}>/</span>
          <span style={{ color: 'var(--text)', fontWeight: 700, letterSpacing: '-0.01em' }}>
            {pageInfo.title}
          </span>
        </div>

        <span
          style={{
            fontSize: '0.6875rem',
            padding: '2px 8px',
            borderRadius: 4,
            background: 'var(--accent-dim)',
            color: 'var(--accent)',
            border: '1px solid var(--border-glow)',
            fontWeight: 600,
          }}
        >
          {pageInfo.subtitle}
        </span>
      </div>

      {/* Right: Actions, SSE Pill, Theme Switcher, User Workspace Dropdown */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {/* SSE Stream Status Pill */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontSize: '0.75rem',
            fontWeight: 600,
            padding: '4px 10px',
            borderRadius: 'var(--radius-sm)',
            background: connected ? 'var(--current-dim)' : 'rgba(148, 163, 184, 0.1)',
            color: connected ? 'var(--current)' : 'var(--muted)',
            border: `1px solid ${connected ? 'var(--current-border)' : 'var(--border)'}`,
          }}
        >
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: '50%',
              background: connected ? 'var(--current)' : 'var(--muted)',
              boxShadow: connected ? '0 0 8px var(--current)' : undefined,
            }}
          />
          <span>{connected ? 'SSE Live' : 'Connecting'}</span>
        </div>

        {/* Theme Toggle Button (Light / Dark) */}
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
          }}
          title={`Switch to ${theme === 'dark' ? 'Light' : 'Dark'} Theme`}
          aria-label="Toggle Theme"
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

        {/* User Workspace Profile Menu */}
        {user && (
          <div ref={menuRef} style={{ position: 'relative' }}>
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '4px 8px 4px 4px',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border)',
                background: 'var(--card-subtle)',
                color: 'var(--text)',
                cursor: 'pointer',
                transition: 'all var(--transition)',
              }}
              aria-label="User Workspace Menu"
            >
              {user.avatarUrl ? (
                <img
                  src={user.avatarUrl}
                  alt={user.displayName}
                  referrerPolicy="no-referrer"
                  style={{ width: 26, height: 26, borderRadius: '50%', objectFit: 'cover' }}
                />
              ) : (
                <div
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: '50%',
                    background: 'var(--accent)',
                    color: '#000000',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '0.75rem',
                    fontWeight: 800,
                  }}
                >
                  {userInitial}
                </div>
              )}

              <span style={{ fontSize: '0.8125rem', fontWeight: 600, maxWidth: 110 }} className="truncate">
                {user.displayName}
              </span>
              <ChevronDown size={14} color="var(--muted)" style={{ transform: menuOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s ease' }} />
            </button>

            {menuOpen && (
              <div
                className="panel animate-dropdown"
                style={{
                  position: 'absolute',
                  right: 0,
                  top: '110%',
                  width: 220,
                  padding: 8,
                  zIndex: 100,
                  boxShadow: 'var(--panel-shadow)',
                  border: '1px solid var(--border)',
                  background: 'var(--panel-solid)',
                }}
              >
                <div style={{ padding: '6px 8px', borderBottom: '1px solid var(--border)', marginBottom: 6 }}>
                  <div style={{ fontSize: '0.8125rem', fontWeight: 700, color: 'var(--text)' }} className="truncate">
                    {user.displayName}
                  </div>
                  <div style={{ fontSize: '0.6875rem', color: 'var(--muted)' }} className="truncate">
                    {user.email}
                  </div>
                </div>

                <Link
                  to="/settings"
                  onClick={() => setMenuOpen(false)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '8px 10px',
                    fontSize: '0.8125rem',
                    color: 'var(--text)',
                    borderRadius: 4,
                    textDecoration: 'none',
                    transition: 'background var(--transition)',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--card-subtle)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  <Settings size={14} color="var(--accent)" />
                  Workspace Settings
                </Link>

                <button
                  onClick={handleLogout}
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '8px 10px',
                    fontSize: '0.8125rem',
                    color: 'var(--stale)',
                    borderRadius: 4,
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    textAlign: 'left',
                    transition: 'background var(--transition)',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--stale-dim)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  <LogOut size={14} color="var(--stale)" />
                  Sign Out
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </header>
  );
}
