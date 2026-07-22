import { Fuel } from 'lucide-react';
import {
  Bar,
  BarChart,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { TankStock } from '../../api/types';
import { formatLitres, formatSignedLitres } from '../../utils/format';

interface StockPanelProps {
  tanks: TankStock[];
}

// Reorder threshold is a UI-only judgment call (45% of capacity) — there is
// no ReorderThreshold field on Tank in the schema, so this isn't read from
// anywhere real; it just mirrors the number used in the earlier mockups.
const REORDER_THRESHOLD_PCT = 45;
// Same story: no VarianceTolerance field on Tank. This threshold is a
// display convenience, not a configured business rule like CreditConfig is.
const VARIANCE_OK_LITRES = 100;

interface TankRow {
  tank: TankStock;
  pct: number;
  status: 'good' | 'warning' | 'critical';
}

// Status (not categorical) color — a tank's fill level is a single
// magnitude with a good/low/critical reading, reusing the app's existing
// status colors rather than a sequential ramp, so it reads consistently
// with every other flagged/ok badge in this app.
const STATUS_COLOR: Record<TankRow['status'], string> = {
  good: 'var(--green)',
  warning: 'var(--amber)',
  critical: 'var(--red)',
};

export function StockPanel({ tanks }: StockPanelProps) {
  if (tanks.length === 0) {
    return <div className="card-sub">No tanks recorded yet.</div>;
  }

  const rows: TankRow[] = tanks.map((tank) => {
    const pct = tank.capacityLitres > 0 ? (tank.currentStockLitres / tank.capacityLitres) * 100 : 0;
    const hasDip = tank.lastDipReading !== null;
    const variance = hasDip ? tank.lastDipReading! - tank.currentStockLitres : null;
    const varianceOk = variance === null || Math.abs(variance) <= VARIANCE_OK_LITRES;
    const belowReorder = pct < REORDER_THRESHOLD_PCT;
    const status: TankRow['status'] = !varianceOk ? 'critical' : belowReorder ? 'warning' : 'good';
    return { tank, pct: Math.min(100, Math.max(0, pct)), status };
  });

  const chartData = rows.map((r) => ({
    productType: r.tank.productType,
    pct: Number(r.pct.toFixed(1)),
    status: r.status,
  }));

  return (
    <div className="card">
      <h3 style={{ fontSize: 13, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
        <Fuel size={15} strokeWidth={2.25} style={{ color: 'var(--navy)' }} />
        Stock levels
      </h3>
      <ResponsiveContainer width="100%" height={rows.length * 42 + 16}>
        <BarChart data={chartData} layout="vertical" margin={{ top: 0, right: 28, bottom: 0, left: 4 }}>
          <XAxis type="number" domain={[0, 100]} hide />
          <YAxis
            type="category"
            dataKey="productType"
            width={70}
            axisLine={false}
            tickLine={false}
            tick={{ fontSize: 12, fontWeight: 600, fill: 'var(--text-dark)' }}
          />
          <ReferenceLine x={REORDER_THRESHOLD_PCT} stroke="var(--chart-neutral)" strokeDasharray="3 3" />
          <Tooltip
            cursor={{ fill: 'var(--page-bg)' }}
            formatter={(value) => [`${Number(value).toFixed(0)}% full`, 'Stock level']}
            contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid var(--border)' }}
          />
          <Bar dataKey="pct" radius={[4, 4, 4, 4]} barSize={16} isAnimationActive={false}>
            {chartData.map((row) => (
              <Cell key={row.productType} fill={STATUS_COLOR[row.status]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      {rows.map(({ tank, status }) => {
        const hasDip = tank.lastDipReading !== null;
        const variance = hasDip ? tank.lastDipReading! - tank.currentStockLitres : null;
        return (
          <div className="stock-row-detail" key={tank.id}>
            <span style={{ fontWeight: 600 }}>{tank.productType}</span>
            <span style={{ color: 'var(--gray)' }}>
              system {formatLitres(tank.currentStockLitres)} / {formatLitres(tank.capacityLitres)}
              {hasDip ? ` · DIP ${formatLitres(tank.lastDipReading!)}` : ' · no DIP recorded'}
            </span>
            {hasDip && (
              <span style={{ color: status === 'critical' ? 'var(--red)' : 'var(--green)' }}>
                variance {formatSignedLitres(variance!)}
                {status === 'critical' ? ' — check tank' : ' (within tolerance)'}
              </span>
            )}
            {status === 'warning' && (
              <span style={{ color: 'var(--amber)' }}>
                Below {REORDER_THRESHOLD_PCT}% reorder threshold (display-only judgment call — not a stored setting)
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
