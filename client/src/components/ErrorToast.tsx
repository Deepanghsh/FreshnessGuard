import { useEffect } from 'react';
import { X, AlertCircle, CheckCircle2, Info } from 'lucide-react';

interface ErrorToastProps {
  message: string;
  type?: 'error' | 'success' | 'info';
  onClose: () => void;
}

export default function ErrorToast({ message, type = 'error', onClose }: ErrorToastProps) {
  useEffect(() => {
    const t = setTimeout(onClose, 5000);
    return () => clearTimeout(t);
  }, [onClose]);

  const isSuccess = type === 'success';
  const isInfo = type === 'info';
  const borderColor = isSuccess ? 'var(--current)' : isInfo ? 'var(--accent)' : 'var(--stale)';

  return (
    <div
      role="alert"
      aria-live="assertive"
      aria-atomic="true"
      className="animate-slide-in"
      style={{
        position: 'fixed', bottom: 24, right: 24, zIndex: 9999,
        background: 'var(--panel)',
        border: `1px solid ${borderColor}`,
        borderRadius: 'var(--radius-md)',
        padding: '0.875rem 1rem',
        display: 'flex', alignItems: 'flex-start', gap: 10,
        maxWidth: 380,
        boxShadow: 'var(--panel-shadow)',
      }}
    >
      {isSuccess ? (
        <CheckCircle2 size={16} color="var(--current)" style={{ flexShrink: 0, marginTop: 1 }} aria-hidden="true" />
      ) : isInfo ? (
        <Info size={16} color="var(--accent)" style={{ flexShrink: 0, marginTop: 1 }} aria-hidden="true" />
      ) : (
        <AlertCircle size={16} color="var(--stale)" style={{ flexShrink: 0, marginTop: 1 }} aria-hidden="true" />
      )}
      <span style={{ color: 'var(--text)', fontSize: '0.875rem', flex: 1, lineHeight: 1.5 }}>
        {message}
      </span>
      <button
        onClick={onClose}
        aria-label="Dismiss notification"
        style={{ color: 'var(--muted)', padding: 0, lineHeight: 1, flexShrink: 0, background: 'none', border: 'none', cursor: 'pointer' }}
      >
        <X size={15} aria-hidden="true" />
      </button>
    </div>
  );
}

