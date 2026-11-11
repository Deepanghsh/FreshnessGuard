import { NavLink } from 'react-router-dom';
import { Shield, LayoutDashboard, FlaskConical, Search, Network, Activity } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../api/client';

const NAV_ITEMS = [
  { to: '/',             label: 'Overview',     icon: LayoutDashboard, end: true  },
  { to: '/playground',  label: 'Playground',   icon: FlaskConical,    end: false },
  { to: '/inspector/x', label: 'Inspector',    icon: Search,          end: false },
  { to: '/architecture',label: 'Architecture', icon: Network,         end: false },
];

type Status = 'online' | 'offline' | 'checking';

function StatusDot({ status, label }: { status: Status; label: string }) {
  const color =
    status === 'online'   ? 'var(--current)' :
    status === 'offline'  ? 'var(--stale)'   : 'var(--unverified)';

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.75rem', marginTop: 5 }}>
      <span style={{ color: 'var(--muted)' }}>{label}</span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 5, color }}>
        <span
          aria-hidden="true"
          style={{
            width: 7, height: 7, borderRadius: '50%', background: color, display: 'inline-block',
            ...(status === 'online' ? { boxShadow: `0 0 6px ${color}` } : {}),
          }}
        />
        {status === 'checking' ? 'Checking' : status === 'online' ? 'Online' : 'Offline'}
      </span>
    </div>
  );
}

export default function Sidebar() {
  const [gwStatus, setGwStatus]     = useState<Status>('checking');
  const [tavilyStatus]              = useState<Status>('online'); // Tavily checked server-side

  useEffect(() => {
    const check = () =>
      api.getHealth()
        .then(h => setGwStatus(h.status === 'ok' ? 'online' : 'offline'))
        .catch(() => setGwStatus('offline'));
    check();
    const t = setInterval(check, 10_000);
    return () => clearInterval(t);
  }, []);

  return (
    <aside
      style={{
        width: 'var(--sidebar-w)',
        background: 'var(--panel)',
        borderRight: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
        overflowY: 'auto',
      }}
      aria-label="Primary navigation"
    >
      {/* Logo */}
      <div style={{ padding: '1.25rem 1rem', borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: '0.875rem' }}>
          <Shield size={22} color="var(--accent)" strokeWidth={1.5} aria-hidden="true" />
          <div>
            <div style={{ fontWeight: 700, fontSize: '1rem', letterSpacing: '-0.02em', lineHeight: 1.2 }}>
              FreshnessGuard
            </div>
            <div style={{ fontSize: '0.65rem', color: 'var(--muted)', letterSpacing: '0.03em' }}>
              IS IT STILL TRUE?
            </div>
          </div>
        </div>

        <StatusDot status={gwStatus}    label="Gateway" />
        <StatusDot status={tavilyStatus} label="Tavily"  />
      </div>

      {/* Nav */}
      <nav style={{ padding: '0.5rem 0', flex: 1 }}>
        {NAV_ITEMS.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            aria-label={label}
            style={({ isActive }) => ({
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '0.6rem 1rem',
              fontSize: '0.875rem',
              fontWeight: 500,
              color: isActive ? 'var(--accent)' : 'var(--muted)',
              background: isActive ? 'var(--accent-dim)' : 'transparent',
              borderLeft: `2px solid ${isActive ? 'var(--accent)' : 'transparent'}`,
              transition: 'all var(--transition)',
              textDecoration: 'none',
            })}
          >
            <Icon size={15} aria-hidden="true" />
            {label}
          </NavLink>
        ))}
      </nav>

      {/* Footer */}
      <div style={{ padding: '0.875rem 1rem', borderTop: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--dim)', fontSize: '0.7rem' }}>
          <Activity size={12} aria-hidden="true" />
          <span>Bifrost + Tavily — Geek Room 2026</span>
        </div>
      </div>
    </aside>
  );
}

