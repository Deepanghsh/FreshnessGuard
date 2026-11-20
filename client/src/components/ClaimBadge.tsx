import type { Verdict } from '../types';

interface ClaimBadgeProps { verdict: Verdict; }

export default function ClaimBadge({ verdict }: ClaimBadgeProps) {
  const cls =
    verdict === 'current'    ? 'badge badge-current'    :
    verdict === 'stale' || verdict === 'false' ? 'badge badge-stale' :
                               'badge badge-unverified';
  const label =
    verdict === 'current'    ? 'Current'    :
    verdict === 'stale'      ? 'Stale'      :
    verdict === 'false'      ? 'False'      : 'Unverified';
  return <span className={cls}>{label}</span>;
}

