import { Outlet, useLocation } from 'react-router-dom';
import React, { useState, createContext, useContext, useCallback, useEffect } from 'react';
import Sidebar from './Sidebar';
import TopHeader from './TopHeader';
import MobileBottomNav from './MobileBottomNav';
import ErrorToast from './ErrorToast';

interface Toast { id: number; message: string; type?: 'error' | 'success' | 'info'; }
interface ToastCtx {
  showError: (msg: string) => void;
  showToast: (msg: string, type?: 'error' | 'success' | 'info') => void;
}

export const ToastContext = createContext<ToastCtx>({
  showError: () => {},
  showToast: () => {},
});
export const useToast = () => useContext(ToastContext);

interface SidebarCtx {
  collapsed: boolean;
  setCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  toggleCollapsed: () => void;
  mobileOpen: boolean;
  setMobileOpen: React.Dispatch<React.SetStateAction<boolean>>;
  toggleMobile: () => void;
}

export const SidebarContext = createContext<SidebarCtx>({
  collapsed: false,
  setCollapsed: () => {},
  toggleCollapsed: () => {},
  mobileOpen: false,
  setMobileOpen: () => {},
  toggleMobile: () => {},
});
export const useSidebar = () => useContext(SidebarContext);

export default function Layout() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const location = useLocation();

  // Auto-close mobile drawer when route changes
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  // Prevent background scrolling when mobile drawer is open
  useEffect(() => {
    if (mobileOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [mobileOpen]);

  const toggleCollapsed = useCallback(() => setCollapsed(c => !c), []);
  const toggleMobile = useCallback(() => setMobileOpen(m => !m), []);

  const showToast = useCallback((message: string, type: 'error' | 'success' | 'info' = 'error') => {
    const id = Date.now();
    setToasts(t => [...t, { id, message, type }]);
  }, []);

  const showError = useCallback((message: string) => {
    showToast(message, 'error');
  }, [showToast]);

  const dismiss = useCallback((id: number) => {
    setToasts(t => t.filter(x => x.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ showError, showToast }}>
      <SidebarContext.Provider value={{ collapsed, setCollapsed, toggleCollapsed, mobileOpen, setMobileOpen, toggleMobile }}>
        <div style={{ display: 'flex', height: '100%', width: '100%', minWidth: '100%', overflow: 'hidden', background: 'transparent', position: 'relative' }}>
          {/* Mobile Overlay Backdrop */}
          {mobileOpen && (
            <div
              onClick={() => setMobileOpen(false)}
              aria-label="Close navigation drawer"
              style={{
                position: 'fixed',
                inset: 0,
                background: 'rgba(0, 0, 0, 0.70)',
                backdropFilter: 'blur(6px)',
                WebkitBackdropFilter: 'blur(6px)',
                zIndex: 45,
                transition: 'opacity 0.24s cubic-bezier(0.16, 1, 0.3, 1)',
              }}
            />
          )}

          <Sidebar />

          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', width: '100%', minWidth: 0, height: '100%', overflow: 'hidden' }}>
            <TopHeader />
            <main
              id="main-content"
              className="main-layout-scroll"
              tabIndex={-1}
            >
              <div key={location.pathname} className="page-entrance" style={{ width: '100%', minWidth: 0, boxSizing: 'border-box' }}>
                <Outlet />
              </div>
            </main>
          </div>

          {/* Primary Mobile Bottom Navigation Bar */}
          <MobileBottomNav />
        </div>
        {toasts.map(t => (
          <ErrorToast key={t.id} message={t.message} type={t.type} onClose={() => dismiss(t.id)} />
        ))}
      </SidebarContext.Provider>
    </ToastContext.Provider>
  );
}
