import { useEffect } from 'react';
import { X, AlertCircle } from 'lucide-react';

interface ErrorToastProps { message: string; onClose: () => void; }

export default function ErrorToast({ message, onClose }: ErrorToastProps) {
  useEffect(() => {
    const t = setTimeout(onClose, 5000);
    return () => clearTimeout(t);
  }, [onClose]);

  return (
    <div
      role="alert"
      aria-live="assertive"
      aria-atomic="true"
      className="animate-slide-in"
      style={{
        position: 'fixed', bottom: 24, right: 24, zIndex: 9999,
        background: 'var(--panel)',
        border: '1px solid var(--stale)',
        borderRadius: 'var(--radius-md)',
        padding: '0.875rem 1rem',
        display: 'flex', alignItems: 'flex-start', gap: 10,
        maxWidth: 380,
        boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
      }}
    >
      <AlertCircle size={16} color="var(--stale)" style={{ flexShrink: 0, marginTop: 1 }} aria-hidden="true" />
      <span style={{ color: 'var(--text)', fontSize: '0.875rem', flex: 1, lineHeight: 1.5 }}>
        {message}
      </span>
      <button
        onClick={onClose}
        aria-label="Dismiss error notification"
        style={{ color: 'var(--muted)', padding: 0, lineHeight: 1, flexShrink: 0 }}
      >
        <X size={15} aria-hidden="true" />
      </button>
    </div>
  );
}

