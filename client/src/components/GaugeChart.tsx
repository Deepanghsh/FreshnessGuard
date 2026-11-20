import React from 'react';

interface GaugeSubMetric {
  label: string;
  value: string | number;
}

interface GaugeStatusItem {
  label: string;
  value: string;
  status: 'online' | 'degraded' | 'offline';
}

interface GaugeChartProps {
  score: number;
  title?: string;
  subtitle?: string;
  subMetrics?: GaugeSubMetric[];
  statusItems?: GaugeStatusItem[];
  onActionClick?: () => void;
  actionLabel?: string;
}

export const GaugeChart: React.FC<GaugeChartProps> = ({
  score,
  title = 'System Freshness & Integrity',
  subtitle = 'Overall Freshness Score',
  subMetrics,
  statusItems,
  onActionClick,
  actionLabel = 'Diagnostics',
}) => {
  const clampedScore = Math.min(Math.max(score || 0, 0), 100);

  // Semicircle dimensions:
  // SVG viewBox: 0 0 220 125
  // Center (110, 110), Radius = 85
  // Arc path from (25, 110) to (195, 110)
  const radius = 80;
  const strokeWidth = 14;
  const circumference = Math.PI * radius; // ~251.32
  const dashOffset = circumference * (1 - clampedScore / 100);

  const getScoreColor = (val: number) => {
    if (val >= 80) return '#2dd4bf'; // teal / cyan
    if (val >= 50) return '#f59e0b'; // amber
    return '#f43f5e'; // rose / crimson
  };

  return (
    <div
      className="panel"
      style={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        background: 'var(--panel)',
        border: '1px solid var(--border)',
        boxShadow: 'var(--panel-shadow)',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Background glow accent */}
      <div
        style={{
          position: 'absolute',
          top: -40,
          right: -40,
          width: 140,
          height: 140,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(139, 92, 246, 0.15) 0%, transparent 70%)',
          pointerEvents: 'none',
        }}
      />

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: 'var(--accent)', fontSize: '1rem' }}>⚡</span>
          <span style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text)', letterSpacing: '-0.01em' }}>
            {title}
          </span>
        </div>
        {actionLabel && (
          <button
            onClick={onActionClick}
            style={{
              padding: '3px 10px',
              fontSize: '0.6875rem',
              fontWeight: 600,
              background: 'rgba(56, 189, 248, 0.12)',
              color: '#38bdf8',
              border: '1px solid rgba(56, 189, 248, 0.3)',
              borderRadius: 4,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            {actionLabel}
          </button>
        )}
      </div>

      {/* Sub metrics row */}
      {subMetrics && subMetrics.length > 0 && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${subMetrics.length}, 1fr)`,
            gap: 8,
            marginBottom: 16,
            padding: '8px 12px',
            background: 'var(--card-subtle)',
            borderRadius: 6,
            border: '1px solid var(--border)',
          }}
        >
          {subMetrics.map((sm, i) => (
            <div key={i} style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>
                {sm.value}
              </div>
              <div style={{ fontSize: '0.625rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {sm.label}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Semicircle Gauge Area */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', position: 'relative', margin: '4px 0 12px' }}>
        <svg viewBox="0 0 200 115" width="200" height="115" style={{ overflow: 'visible' }}>
          <defs>
            <linearGradient id="gaugeGradient" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#8b5cf6" />
              <stop offset="60%" stopColor="#38bdf8" />
              <stop offset="100%" stopColor={getScoreColor(clampedScore)} />
            </linearGradient>
            <filter id="gaugeGlow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* Background track */}
          <path
            d="M 20 100 A 80 80 0 0 1 180 100"
            fill="none"
            stroke="var(--border)"
            strokeWidth={strokeWidth}
            strokeLinecap="round"
          />

          {/* Animated Value Arc */}
          <path
            d="M 20 100 A 80 80 0 0 1 180 100"
            fill="none"
            stroke="url(#gaugeGradient)"
            strokeWidth={strokeWidth}
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            strokeLinecap="round"
            filter="url(#gaugeGlow)"
            style={{ transition: 'stroke-dashoffset 0.8s cubic-bezier(0.16, 1, 0.3, 1)' }}
          />
        </svg>

        {/* Center Text */}
        <div
          style={{
            position: 'absolute',
            bottom: 6,
            left: 0,
            right: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            textAlign: 'center',
          }}
        >
          <div
            style={{
              fontSize: '2.25rem',
              fontWeight: 800,
              lineHeight: 1,
              color: 'var(--text)',
              fontFamily: 'var(--font-mono)',
              textShadow: 'var(--gauge-text-shadow)',
            }}
          >
            {score === 0 && subtitle?.includes('Awaiting') ? '—' : `${clampedScore}%`}
          </div>
          <div style={{ fontSize: '0.6875rem', color: 'var(--muted)', marginTop: 4, letterSpacing: '0.02em' }}>
            {subtitle}
          </div>
        </div>
      </div>

      {/* Bottom Status Checklist */}
      {statusItems && statusItems.length > 0 && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '6px 12px',
            marginTop: 8,
            paddingTop: 10,
            borderTop: '1px solid var(--border)',
            fontSize: '0.6875rem',
          }}
        >
          {statusItems.map((item, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: 'var(--muted)' }}>{item.label}:</span>
              <span
                style={{
                  fontWeight: 600,
                  fontFamily: 'var(--font-mono)',
                  color:
                    item.status === 'online'
                      ? 'var(--current)'
                      : item.status === 'degraded'
                      ? 'var(--degraded)'
                      : 'var(--stale)',
                }}
              >
                {item.value}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
export default GaugeChart;
