import React from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';

export interface DonutSegment {
  name: string;
  value: number;
  color: string;
}

interface DonutChartProps {
  title?: string;
  centerLabel?: string;
  centerValue?: string | number;
  data: DonutSegment[];
  emptyText?: string;
}

export const DonutChart: React.FC<DonutChartProps> = ({
  title = 'Claims Breakdown',
  centerLabel = 'Freshness',
  centerValue,
  data,
  emptyText = 'No claims data recorded yet',
}) => {
  const total = data.reduce((acc, cur) => acc + cur.value, 0);

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
      {/* Title */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: '#8b5cf6', fontSize: '1rem' }}>◎</span>
          <span style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text)', letterSpacing: '-0.01em' }}>
            {title}
          </span>
        </div>
        <span style={{ fontSize: '0.6875rem', color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
          Total: {total}
        </span>
      </div>

      {total === 0 ? (
        <div
          style={{
            height: 180,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--dim)',
            fontSize: '0.8125rem',
          }}
        >
          {emptyText}
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, margin: '8px 0' }}>
          {/* Donut Area with Center Badge */}
          <div style={{ position: 'relative', width: 140, height: 140, flexShrink: 0 }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Tooltip
                  content={({ payload }) => {
                    if (!payload || !payload[0]) return null;
                    const item = payload[0];
                    const pct = total > 0 ? Math.round(((item.value as number) / total) * 100) : 0;
                    return (
                      <div
                        style={{
                          background: 'var(--panel)',
                          border: '1px solid var(--border)',
                          borderRadius: 6,
                          padding: '6px 10px',
                          fontSize: '0.75rem',
                          color: 'var(--text)',
                          boxShadow: 'var(--panel-shadow)',
                        }}
                      >
                        <span style={{ color: item.payload?.color, fontWeight: 700 }}>● {item.name}:</span>{' '}
                        {item.value} ({pct}%)
                      </div>
                    );
                  }}
                />
                <Pie
                  data={data}
                  cx="50%"
                  cy="50%"
                  innerRadius={46}
                  outerRadius={65}
                  paddingAngle={3}
                  dataKey="value"
                  stroke="none"
                >
                  {data.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>

            {/* Center label */}
            <div
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                pointerEvents: 'none',
              }}
            >
              <div
                style={{
                  fontSize: '1.25rem',
                  fontWeight: 800,
                  color: 'var(--text)',
                  fontFamily: 'var(--font-mono)',
                  lineHeight: 1,
                }}
              >
                {centerValue ?? `${total}`}
              </div>
              <div
                style={{
                  fontSize: '0.5625rem',
                  color: 'var(--muted)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  marginTop: 2,
                }}
              >
                {centerLabel}
              </div>
            </div>
          </div>

          {/* Legend Items (matching Image 5) */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
            {data.map((item, idx) => {
              const pct = total > 0 ? Math.round((item.value / total) * 100) : 0;
              return (
                <div
                  key={idx}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    fontSize: '0.75rem',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        background: item.color,
                        flexShrink: 0,
                        boxShadow: `0 0 8px ${item.color}`,
                      }}
                    />
                    <span style={{ color: 'var(--text-soft)', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                      {item.name}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontFamily: 'var(--font-mono)' }}>
                    <span style={{ fontWeight: 700, color: 'var(--text)' }}>{item.value}</span>
                    <span style={{ color: 'var(--muted)', fontSize: '0.6875rem' }}>({pct}%)</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
export default DonutChart;
