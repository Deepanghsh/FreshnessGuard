import { LineChart, Line, ResponsiveContainer, Tooltip } from 'recharts';

interface StatCardProps {
  label: string;
  value: string | number;
  sparkData?: number[];
  unit?: string;
  color?: string;
  trend?: 'up' | 'down' | 'neutral';
  trendLabel?: string;
  loading?: boolean;
}

export default function StatCard({
  label, value, sparkData, unit = '', color = 'var(--accent)',
  trend, trendLabel, loading = false,
}: StatCardProps) {
  const data = (sparkData ?? Array(7).fill(0)).map((v, i) => ({ i, v }));

  return (
    <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      <span style={{
        fontSize: '0.6875rem', fontWeight: 600, color: 'var(--muted)',
        letterSpacing: '0.06em', textTransform: 'uppercase',
      }}>
        {label}
      </span>

      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 8 }}>
        {loading ? (
          <div style={{ height: 36, width: 80, background: 'var(--border)', borderRadius: 4, animation: 'pulse 2s infinite' }} />
        ) : (
          <span style={{
            fontSize: '1.875rem', fontWeight: 700, color,
            fontVariantNumeric: 'tabular-nums', lineHeight: 1,
          }}>
            {value}{unit}
          </span>
        )}

        {sparkData && sparkData.some(v => v > 0) && (
          <div style={{ width: 72, height: 32 }} aria-hidden="true">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data}>
                <Tooltip
                  contentStyle={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 4, fontSize: 11 }}
                  itemStyle={{ color }}
                  formatter={(v: number) => [`${v}${unit}`, label]}
                  labelFormatter={() => ''}
                />
                <Line type="monotone" dataKey="v" stroke={color} strokeWidth={1.5} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {trend && trendLabel && (
        <span style={{
          fontSize: '0.6875rem',
          color: trend === 'up' ? 'var(--current)' : trend === 'down' ? 'var(--stale)' : 'var(--muted)',
        }}>
          {trend === 'up' ? '↑' : trend === 'down' ? '↓' : '→'} {trendLabel}
        </span>
      )}
    </div>
  );
}

