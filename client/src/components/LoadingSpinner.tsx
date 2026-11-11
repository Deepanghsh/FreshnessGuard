export default function LoadingSpinner({ size = 32, label = 'Loading' }: { size?: number; label?: string }) {
  return (
    <div role="status" aria-label={label} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: '2.5rem', color: 'var(--muted)' }}>
      <div style={{
        width: size, height: size,
        border: `2px solid var(--border)`,
        borderTop: `2px solid var(--accent)`,
        borderRadius: '50%',
        animation: 'spin 0.75s linear infinite',
      }} />
      <span style={{ fontSize: '0.8125rem' }}>{label}…</span>
    </div>
  );
}

