import type { SummaryStatus } from '../types';
import { CheckCircle2, AlertTriangle, HelpCircle, ShieldOff, Check } from 'lucide-react';

interface SummaryBadgeProps {
  status?: SummaryStatus;
  message?: string;
  size?: 'sm' | 'md';
}

export default function SummaryBadge({ status = 'no_claims', message, size = 'sm' }: SummaryBadgeProps) {
  const configs: Record<SummaryStatus, { label: string; icon: typeof CheckCircle2; bg: string; color: string; border: string }> = {
    no_claims: {
      label: 'No Claims Requiring Verification',
      icon: Check,
      bg: 'rgba(148, 163, 184, 0.12)',
      color: '#94A3B8',
      border: 'rgba(148, 163, 184, 0.3)',
    },
    all_fresh: {
      label: 'All Claims Verified Fresh',
      icon: CheckCircle2,
      bg: 'var(--current-dim)',
      color: 'var(--current)',
      border: 'rgba(74, 222, 128, 0.35)',
    },
    stale_detected: {
      label: 'Stale Claims Detected',
      icon: AlertTriangle,
      bg: 'var(--stale-dim)',
      color: 'var(--stale)',
      border: 'rgba(255, 107, 107, 0.35)',
    },
    unverified: {
      label: 'Unverified Evidence',
      icon: HelpCircle,
      bg: 'var(--unverified-dim)',
      color: 'var(--unverified)',
      border: 'rgba(251, 191, 36, 0.35)',
    },
    bypassed: {
      label: 'Bypassed FreshnessGuard',
      icon: ShieldOff,
      bg: 'rgba(168, 85, 247, 0.12)',
      color: '#C084FC',
      border: 'rgba(168, 85, 247, 0.35)',
    },
  };

  const config = configs[status] ?? configs.no_claims;
  const Icon = config.icon;
  const displayLabel = message ?? config.label;
  const iconSize = size === 'sm' ? 12 : 14;

  return (
    <span
      className="summary-badge"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: size === 'sm' ? '2px 8px' : '4px 10px',
        borderRadius: 4,
        background: config.bg,
        color: config.color,
        border: `1px solid ${config.border}`,
        fontSize: size === 'sm' ? '0.75rem' : '0.8125rem',
        fontWeight: 600,
        letterSpacing: '0.02em',
        lineHeight: 1.4,
      }}
    >
      <Icon size={iconSize} aria-hidden="true" style={{ flexShrink: 0 }} />
      <span>{displayLabel}</span>
    </span>
  );
}

