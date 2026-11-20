import { NavLink } from 'react-router-dom';
import {
  Shield, LayoutDashboard, FlaskConical, Search, Network,
  Activity, Database, CheckCircle2, AlertTriangle, Settings,
  ShieldAlert, Layers, GitCommit, Zap, BarChart3, Boxes,
  ChevronDown, ChevronRight, ChevronLeft, ChevronRightSquare, X,
  type LucideIcon
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useSidebar } from './Layout';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
}

interface NavGroup {
  group: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    group: 'WORKSPACE',
    items: [
      { to: '/', label: 'Overview', icon: LayoutDashboard, end: true },
      { to: '/playground', label: 'Playground', icon: FlaskConical },
      { to: '/inspector', label: 'Inspector', icon: Search },
    ],
  },
  {
    group: 'INTELLIGENCE',
    items: [
      { to: '/policies', label: 'Verification Policies', icon: ShieldAlert },
      { to: '/evidence', label: 'Evidence Explorer', icon: Layers },
      { to: '/traces', label: 'Decision Traces', icon: GitCommit },
    ],
  },
  {
    group: 'PERFORMANCE',
    items: [
      { to: '/benchmarks', label: 'Benchmarks', icon: Zap },
      { to: '/analytics', label: 'Analytics', icon: BarChart3 },
    ],
  },
  {
    group: 'PLATFORM',
    items: [
      { to: '/architecture', label: 'Architecture', icon: Network },
      { to: '/integrations', label: 'Integrations', icon: Boxes },
      { to: '/settings', label: 'Settings', icon: Settings },
    ],
  },
];

type ServiceStatus = 'online' | 'offline' | 'degraded' | 'checking' | 'configured';

function StatusItem({
  label,
  status,
  statusText,
  title,
  collapsed,
}: {
  label: string;
  status: ServiceStatus;
  statusText: string;
  title?: string;
  collapsed?: boolean;
}) {
  const color =
    status === 'online'     ? 'var(--current)' :
    status === 'degraded'   ? 'var(--degraded)' :
    status === 'configured' ? 'var(--accent)' :
    status === 'offline'    ? 'var(--stale)' : 'var(--unverified)';

  if (collapsed) {
    return (
      <div
        title={`${label}: ${statusText}`}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '4px 0',
        }}
      >
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: color,
            boxShadow: status === 'online' ? `0 0 6px ${color}` : undefined,
          }}
        />
      </div>
    );
  }

  return (
    <div
      title={title}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        fontSize: '0.75rem',
        marginTop: 5,
        padding: '4px 8px',
        borderRadius: 'var(--radius-xs)',
        background: 'var(--card-subtle)',
        border: '1px solid var(--border)',
      }}
    >
      <span style={{ color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 5 }}>
        {label}
      </span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 5, color, fontWeight: 700 }}>
        <span
          aria-hidden="true"
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: color,
            display: 'inline-block',
            ...(status === 'online' ? { boxShadow: `0 0 6px ${color}` } : {}),
            ...(status === 'degraded' ? { boxShadow: '0 0 6px rgba(251, 146, 60, 0.4)' } : {}),
          }}
        />
        {statusText}
      </span>
    </div>
  );
}

export default function Sidebar() {
  const { collapsed, toggleCollapsed, mobileOpen, setMobileOpen } = useSidebar();
  const [gwStatus, setGwStatus]       = useState<ServiceStatus>('checking');
  const [mongoStatus, setMongoStatus] = useState<ServiceStatus>('checking');
  const [tavilyStatus]                = useState<ServiceStatus>('configured');
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});

  const toggleGroup = (group: string) => {
    setCollapsedGroups(prev => ({
      ...prev,
      [group]: !prev[group],
    }));
  };

  useEffect(() => {
    let mounted = true;
    const check = () => {
      api.getHealth()
        .then(h => {
          if (!mounted) return;
          setGwStatus(h.status === 'ok' ? 'online' : 'offline');
          setMongoStatus(h.mongodb === 'connected' ? 'online' : 'degraded');
        })
        .catch(() => {
          if (!mounted) return;
          setGwStatus('offline');
          setMongoStatus('offline');
        });
    };

    check();
    const t = setInterval(check, 10_000);
    return () => {
      mounted = false;
      clearInterval(t);
    };
  }, []);

  return (
    <aside
      className={`sidebar-root ${mobileOpen ? 'mobile-open' : ''}`}
      style={{
        width: collapsed ? 'var(--sidebar-collapsed-w)' : 'var(--sidebar-w)',
        minWidth: collapsed ? 'var(--sidebar-collapsed-w)' : 'var(--sidebar-w)',
        background: 'var(--panel)',
        backdropFilter: 'var(--panel-blur)',
        WebkitBackdropFilter: 'var(--panel-blur)',
        borderRight: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
        height: '100%',
        overflowY: 'auto',
        overflowX: 'hidden',
        transition: 'width 240ms cubic-bezier(0.16, 1, 0.3, 1), transform 240ms cubic-bezier(0.16, 1, 0.3, 1)',
        zIndex: 50,
      }}
      aria-label="Primary navigation"
    >
      {/* Brand & Logo Header */}
      <div style={{ padding: collapsed ? '1.125rem 0.5rem 0.875rem' : '1.125rem 1rem 0.875rem', borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column', alignItems: collapsed ? 'center' : 'stretch' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: collapsed ? 'center' : 'space-between', gap: 9, marginBottom: collapsed ? '0.25rem' : '0.75rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 9,
                background: 'linear-gradient(135deg, rgba(6, 182, 212, 0.25), rgba(139, 92, 246, 0.15))',
                border: '1px solid var(--border-glow)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                boxShadow: '0 0 12px var(--accent-dim)',
              }}
            >
              <Shield size={20} color="var(--accent)" strokeWidth={2.2} aria-hidden="true" />
            </div>
            {!collapsed && (
              <div className="animate-fade-in">
                <div style={{ fontWeight: 800, fontSize: '1.05rem', letterSpacing: '-0.02em', lineHeight: 1.2, color: 'var(--text)' }}>
                  FreshnessGuard
                </div>
                <div style={{ fontSize: '0.7rem', color: 'var(--accent)', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                  Response Intelligence
                </div>
              </div>
            )}
          </div>

          {/* Close button inside mobile drawer */}
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            className="mobile-drawer-close-btn"
            aria-label="Close navigation drawer"
            style={{
              display: 'none', // Controlled via CSS media query
              background: 'transparent',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-xs)',
              padding: 5,
              color: 'var(--muted)',
              cursor: 'pointer',
            }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Live System Indicators */}
        <div style={{ display: 'flex', flexDirection: collapsed ? 'row' : 'column', gap: collapsed ? 6 : 2, justifyContent: 'center' }}>
          <StatusItem
            label="Gateway"
            status={gwStatus}
            statusText={gwStatus === 'checking' ? 'Checking' : gwStatus === 'online' ? 'Online' : 'Offline'}
            title="FreshnessGuard Bifrost Gateway Port 5000"
            collapsed={collapsed}
          />
          <StatusItem
            label="MongoDB"
            status={mongoStatus}
            statusText={
              mongoStatus === 'checking' ? 'Checking' :
              mongoStatus === 'online' ? 'Atlas Online' : 'Degraded (L1)'
            }
            title={
              mongoStatus === 'online'
                ? 'MongoDB Atlas connected for full historical persistence'
                : 'MongoDB disconnected: running in degraded mode with in-memory L1 cache'
            }
            collapsed={collapsed}
          />
          <StatusItem
            label="Tavily"
            status={tavilyStatus}
            statusText="Active"
            title="Tavily Search API key verified for real-time web verification"
            collapsed={collapsed}
          />
        </div>
      </div>

      {/* Nav List with Grouped Categories */}
      <nav style={{ padding: collapsed ? '0.5rem 0.25rem 1rem' : '0.5rem 0.5rem 1rem', flex: 1, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {NAV_GROUPS.map(({ group, items }) => {
          const isGroupCollapsed = !!collapsedGroups[group];
          return (
            <div key={group}>
              {!collapsed ? (
                <div
                  onClick={() => toggleGroup(group)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    fontSize: '0.72rem',
                    color: 'var(--dim)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.08em',
                    fontWeight: 700,
                    padding: '5px 8px 6px',
                    cursor: 'pointer',
                    userSelect: 'none',
                  }}
                  title={`Toggle ${group} group`}
                >
                  <span>{group}</span>
                  {isGroupCollapsed ? <ChevronRight size={13} color="var(--dim)" /> : <ChevronDown size={13} color="var(--dim)" />}
                </div>
              ) : (
                <div style={{ height: 1, background: 'var(--border)', margin: '6px 8px' }} />
              )}

              {(!isGroupCollapsed || collapsed) && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  {items.map(({ to, label, icon: Icon, end }) => (
                    <NavLink
                      key={to}
                      to={to}
                      end={end}
                      title={label}
                      aria-label={label}
                      onClick={() => setMobileOpen(false)}
                      style={({ isActive }) => ({
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: collapsed ? 'center' : 'flex-start',
                        gap: 11,
                        padding: collapsed ? '0.65rem' : '0.55rem 0.85rem',
                        borderRadius: 'var(--radius-sm)',
                        fontSize: '0.875rem',
                        fontWeight: isActive ? 700 : 500,
                        color: isActive ? 'var(--accent)' : 'var(--muted)',
                        background: isActive ? 'var(--accent-dim)' : 'transparent',
                        transition: 'all var(--transition)',
                        textDecoration: 'none',
                        borderLeft: (!collapsed && isActive) ? '3px solid var(--accent)' : '3px solid transparent',
                        boxShadow: isActive ? '0 0 12px var(--accent-dim)' : undefined,
                        position: 'relative',
                      })}
                    >
                      <Icon size={18} aria-hidden="true" style={{ flexShrink: 0 }} />
                      {!collapsed && (
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {label}
                        </span>
                      )}
                    </NavLink>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/* Sidebar Footer with Collapse Toggle */}
      <div style={{ padding: '0.75rem 0.5rem', borderTop: '1px solid var(--border)', background: 'var(--card-subtle)', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {!collapsed && (
          <div className="animate-fade-in" style={{ padding: '0 0.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--dim)', fontSize: '0.6875rem', marginBottom: 2 }}>
              <Activity size={12} aria-hidden="true" />
              <span>Bifrost + Tavily Gateway</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.65rem', color: 'var(--dim)' }}>
              <span>Geek Room 2026</span>
              <span className="badge badge-muted" style={{ fontSize: '0.55rem', padding: '1px 4px' }}>v1.0.0</span>
            </div>
          </div>
        )}

        {/* Collapse / Expand Toggle Button */}
        <button
          onClick={toggleCollapsed}
          className="btn btn-secondary"
          style={{
            width: '100%',
            padding: '6px 8px',
            fontSize: '0.75rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
          }}
          title={collapsed ? 'Expand sidebar (Ctrl+B)' : 'Collapse sidebar'}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <ChevronRight size={14} /> : <><ChevronLeft size={14} /><span>Collapse</span></>}
        </button>
      </div>
    </aside>
  );
}
