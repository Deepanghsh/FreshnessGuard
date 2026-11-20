import { NavLink } from 'react-router-dom';
import { LayoutDashboard, FlaskConical, Search, Layers, Menu } from 'lucide-react';
import { useSidebar } from './Layout';

export default function MobileBottomNav() {
  const { toggleMobile } = useSidebar();

  const navItems = [
    { to: '/', label: 'Overview', icon: LayoutDashboard, end: true },
    { to: '/playground', label: 'Playground', icon: FlaskConical },
    { to: '/inspector', label: 'Inspector', icon: Search },
    { to: '/evidence', label: 'Evidence', icon: Layers },
  ];

  return (
    <nav
      className="mobile-bottom-nav"
      aria-label="Mobile primary navigation"
      style={{
        display: 'none', // Controlled via CSS media query (@media max-width: 1023px)
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        height: 'calc(58px + env(safe-area-inset-bottom, 0px))',
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        background: 'var(--panel)',
        backdropFilter: 'var(--panel-blur)',
        WebkitBackdropFilter: 'var(--panel-blur)',
        borderTop: '1px solid var(--border)',
        zIndex: 40,
        boxShadow: '0 -4px 20px rgba(0, 0, 0, 0.35)',
        boxSizing: 'border-box',
      }}
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(5, 1fr)',
          height: '100%',
          width: '100%',
          alignItems: 'center',
        }}
      >
        {navItems.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) => `mobile-bottom-nav-item ${isActive ? 'active' : ''}`}
            style={({ isActive }) => ({
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 3,
              height: '100%',
              textDecoration: 'none',
              color: isActive ? 'var(--accent)' : 'var(--muted)',
              fontSize: '0.6875rem',
              fontWeight: isActive ? 700 : 500,
              transition: 'color var(--transition)',
              position: 'relative',
              padding: '4px 0',
            })}
          >
            {({ isActive }) => (
              <>
                {isActive && (
                  <span
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: '25%',
                      right: '25%',
                      height: 3,
                      background: 'var(--accent)',
                      borderRadius: '0 0 3px 3px',
                      boxShadow: '0 2px 8px var(--accent-glow)',
                    }}
                  />
                )}
                <Icon size={19} strokeWidth={isActive ? 2.3 : 1.8} />
                <span>{label}</span>
              </>
            )}
          </NavLink>
        ))}

        {/* 'More' / Menu Drawer Trigger */}
        <button
          type="button"
          onClick={toggleMobile}
          aria-label="Open full menu"
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 3,
            height: '100%',
            background: 'transparent',
            border: 'none',
            color: 'var(--muted)',
            fontSize: '0.6875rem',
            fontWeight: 500,
            cursor: 'pointer',
            padding: '4px 0',
          }}
        >
          <Menu size={19} strokeWidth={1.8} />
          <span>More</span>
        </button>
      </div>
    </nav>
  );
}
