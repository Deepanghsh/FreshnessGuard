import { Outlet } from 'react-router-dom';
import { useState, createContext, useContext, useCallback } from 'react';
import Sidebar from './Sidebar';
import ErrorToast from './ErrorToast';

interface Toast { id: number; message: string; }
interface ToastCtx { showError: (msg: string) => void; }

export const ToastContext = createContext<ToastCtx>({ showError: () => {} });
export const useToast = () => useContext(ToastContext);

export default function Layout() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useState(0);

  const showError = useCallback((message: string) => {
    const id = Date.now();
    setToasts(t => [...t, { id, message }]);
  }, []);

  const dismiss = useCallback((id: number) => {
    setToasts(t => t.filter(x => x.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ showError }}>
      <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
        <Sidebar />
        <main
          id="main-content"
          style={{ flex: 1, overflowY: 'auto', padding: '1.5rem' }}
          tabIndex={-1}
        >
          <Outlet />
        </main>
      </div>
      {toasts.map(t => (
        <ErrorToast key={t.id} message={t.message} onClose={() => dismiss(t.id)} />
      ))}
    </ToastContext.Provider>
  );
}

