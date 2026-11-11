import { Inbox } from 'lucide-react';

interface EmptyStateProps { message?: string; detail?: string; }

export default function EmptyState({
  message = 'Nothing here yet',
  detail  = 'Results will appear as LLM responses are verified.',
}: EmptyStateProps) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      gap: 12, padding: '4rem 2rem', color: 'var(--muted)', textAlign: 'center',
    }}>
      <Inbox size={44} strokeWidth={1} aria-hidden="true" color="var(--dim)" />
      <div>
        <p style={{ color: 'var(--muted)', fontWeight: 500, marginBottom: 4 }}>{message}</p>
        <p style={{ color: 'var(--dim)', fontSize: '0.8125rem' }}>{detail}</p>
      </div>
    </div>
  );
}

