interface ScoreRingProps {
  score: number;
  size?: number;
  strokeWidth?: number;
  label?: string;
}

export default function ScoreRing({ score, size = 60, strokeWidth = 5, label }: ScoreRingProps) {
  const r    = (size - strokeWidth) / 2;
  const circ = 2 * Math.PI * r;
  const pct  = Math.max(0, Math.min(1, score));
  const offset = circ * (1 - pct);

  const color =
    pct >= 0.70 ? 'var(--current)'    :
    pct >= 0.40 ? 'var(--unverified)' : 'var(--stale)';

  const pctLabel = `${Math.round(pct * 100)}%`;
  const ariaLabel = label ?? `Freshness score: ${pctLabel}`;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={ariaLabel}
      style={{ flexShrink: 0 }}
    >
      {/* Track */}
      <circle
        cx={size / 2} cy={size / 2} r={r}
        fill="none"
        stroke="var(--border)"
        strokeWidth={strokeWidth}
      />
      {/* Progress — rotated so it starts at top */}
      <circle
        cx={size / 2} cy={size / 2} r={r}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeDasharray={circ}
        strokeDashoffset={offset}
        strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: 'stroke-dashoffset var(--transition-gauge, 800ms) cubic-bezier(0.16, 1, 0.3, 1), stroke 300ms ease' }}
      />
      {/* Label */}
      <text
        x="50%" y="50%"
        textAnchor="middle"
        dominantBaseline="central"
        fill={color}
        style={{
          fontSize: size * 0.21,
          fontWeight: 600,
          fontFamily: 'var(--font-mono)',
        }}
      >
        {pctLabel}
      </text>
    </svg>
  );
}

