import React from 'react';
import { AreaChart, Area, ResponsiveContainer, Tooltip } from 'recharts';

interface StatCardProps {
  label: string;
  value: string | number;
  sparkData?: number[];
  unit?: string;
  color?: string;
  icon?: React.ReactNode;
  trend?: 'up' | 'down' | 'neutral';
  trendLabel?: string;
  loading?: boolean;
  subtitle?: string;
}

export default function StatCard({
  label,
  value,
  sparkData,
  unit = '',
  color = '#2dd4bf',
  icon,
  trend,
  trendLabel,
  loading = false,
  subtitle,
}: StatCardProps) {
  // If sparkData is provided, map to objects; otherwise generate a nice gentle undulating wave
  const waveData = React.useMemo(() => {
    if (sparkData && sparkData.length > 0) {
      return sparkData.map((v, i) => ({ i, v }));
    }
    // Default organic wave for visual aesthetic (matching Reference Image 5)
    return [
      { i: 0, v: 20 },
      { i: 1, v: 45 },
      { i: 2, v: 30 },
      { i: 3, v: 65 },
      { i: 4, v: 40 },
      { i: 5, v: 80 },
      { i: 6, v: 55 },
      { i: 7, v: 90 },
    ];
  }, [sparkData]);

  const gradientId = `statGrad-${label.replace(/[^a-zA-Z0-9]/g, '')}-${color.replace(/[^a-zA-Z0-9]/g, '')}`;

  // Count-up animation on initial data load (respecting reduced motion, no repeated re-render triggers)
  const [displayValue, setDisplayValue] = React.useState(value);
  const hasAnimatedRef = React.useRef(false);

  React.useEffect(() => {
    if (loading || hasAnimatedRef.current) {
      setDisplayValue(value);
      return;
    }

    const numericStr = String(value).replace(/[^0-9.]/g, '');
    const num = parseFloat(numericStr);
    if (isNaN(num) || String(value).includes('/') || String(value).includes(':') || String(value).startsWith('v')) {
      setDisplayValue(value);
      return;
    }

    if (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setDisplayValue(value);
      hasAnimatedRef.current = true;
      return;
    }

    hasAnimatedRef.current = true;
    const isDecimal = String(value).includes('.');
    const startTime = performance.now();
    const duration = 600; // Calibrated 600ms count-up

    const step = (now: number) => {
      const progress = Math.min((now - startTime) / duration, 1);
      const ease = 1 - Math.pow(1 - progress, 3);
      const current = num * ease;
      setDisplayValue(isDecimal ? current.toFixed(1) : Math.round(current).toString());

      if (progress < 1) {
        requestAnimationFrame(step);
      } else {
        setDisplayValue(value);
      }
    };

    requestAnimationFrame(step);
  }, [value, loading]);

  return (
    <div
      className="panel"
      style={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: '0.8rem 0.9rem 0.65rem',
        background: 'var(--panel)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-md)',
        boxShadow: 'var(--panel-shadow)',
        position: 'relative',
        overflow: 'hidden',
        minWidth: 0,
        boxSizing: 'border-box',
        transition: 'transform var(--transition-hover), border-color var(--transition-hover), box-shadow var(--transition-hover)',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = 'translateY(-2px)';
        e.currentTarget.style.borderColor = color;
        e.currentTarget.style.boxShadow = `0 8px 24px -4px ${color}30`;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = 'translateY(0)';
        e.currentTarget.style.borderColor = 'var(--border)';
        e.currentTarget.style.boxShadow = 'var(--panel-shadow)';
      }}
    >
      {/* Top row: Icon on left + Trend Badge on right (Zero collision, ample space) */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, width: '100%', minWidth: 0 }}>
        {icon && (
          <div
            style={{
              width: 26,
              height: 26,
              borderRadius: 6,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: `${color}18`,
              color: color,
              border: `1px solid ${color}35`,
              fontSize: '0.8125rem',
              flexShrink: 0,
            }}
          >
            {icon}
          </div>
        )}

        {trendLabel && (
          <span
            style={{
              fontSize: '0.625rem',
              fontWeight: 600,
              padding: '2px 6px',
              borderRadius: 4,
              fontFamily: 'var(--font-mono)',
              flexShrink: 1,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              maxWidth: 'calc(100% - 32px)',
              background:
                trend === 'up'
                  ? 'var(--current-dim)'
                  : trend === 'down'
                  ? 'var(--stale-dim)'
                  : 'rgba(255, 255, 255, 0.05)',
              color:
                trend === 'up'
                  ? 'var(--current)'
                  : trend === 'down'
                  ? 'var(--stale)'
                  : 'var(--muted)',
              border: `1px solid ${
                trend === 'up'
                  ? 'var(--current-border)'
                  : trend === 'down'
                  ? 'var(--stale-border)'
                  : 'rgba(255, 255, 255, 0.1)'
              }`,
            }}
            title={trendLabel}
          >
            {trend ? (trend === 'up' ? '↑ ' : trend === 'down' ? '↓ ' : '• ') : ''}
            {trendLabel}
          </span>
        )}
      </div>

      {/* Second row: Clear, unconstrained Label */}
      <div style={{ marginTop: 8, marginBottom: 2 }}>
        <span
          style={{
            fontSize: '0.6875rem',
            fontWeight: 600,
            color: 'var(--muted)',
            letterSpacing: '0.03em',
            textTransform: 'uppercase',
            lineHeight: 1.25,
            display: 'block',
          }}
          title={label}
        >
          {label}
        </span>
      </div>

      {/* Main KPI Value */}
      <div style={{ marginTop: 4, marginBottom: 2 }}>
        {loading ? (
          <div
            style={{
              height: 38,
              width: 100,
              background: 'var(--border)',
              borderRadius: 4,
              animation: 'pulse 1.5s infinite',
            }}
          />
        ) : (
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
            <span
              style={{
                fontSize: '2rem',
                fontWeight: 800,
                color: 'var(--text)',
                fontFamily: 'var(--font-mono)',
                lineHeight: 1,
                letterSpacing: '-0.03em',
              }}
            >
              {displayValue}
            </span>
            {unit && (
              <span style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--muted)' }}>
                {unit}
              </span>
            )}
          </div>
        )}
        {subtitle && (
          <div style={{ fontSize: '0.6875rem', color: 'var(--dim)', marginTop: 4 }}>
            {subtitle}
          </div>
        )}
      </div>

      {/* Bottom Glowing Wave Sparkline (Image 5 style) */}
      <div style={{ width: '100%', height: 42, marginTop: 4, marginLeft: -8, marginRight: -8 }} aria-hidden="true">
        <ResponsiveContainer width="105%" height="100%">
          <AreaChart data={waveData} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.35} />
                <stop offset="100%" stopColor={color} stopOpacity={0.0} />
              </linearGradient>
            </defs>
            <Tooltip
              content={({ payload }) => {
                if (!payload || !payload[0]) return null;
                return (
                  <div
                    style={{
                      background: 'rgba(10, 15, 24, 0.95)',
                      border: `1px solid ${color}40`,
                      borderRadius: 4,
                      padding: '3px 6px',
                      fontSize: '0.6875rem',
                      color: '#fff',
                      fontFamily: 'var(--font-mono)',
                    }}
                  >
                    {payload[0].value} {unit}
                  </div>
                );
              }}
            />
            <Area
              type="monotone"
              dataKey="v"
              stroke={color}
              strokeWidth={2}
              fillOpacity={1}
              fill={`url(#${gradientId})`}
              dot={false}
              isAnimationActive={false}
              style={{ filter: `drop-shadow(0 0 5px ${color}80)` }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
