import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { Banknote, CreditCard, Smartphone, Wallet } from 'lucide-react';
import type { PaymentTypeTotals } from '../../api/types';
import { formatRupees } from '../../utils/format';

interface PaymentCollectionProps {
  totals: PaymentTypeTotals;
}

// Fixed category -> color mapping (not a swappable series order), validated
// with the dataviz skill's validator against a white chart surface — see
// tokens.css's --chart-cash/-card/-upi/-credit comment for why the app's
// original green/blue/purple/orange quad was replaced (it failed both the
// chroma-floor and CVD-separation checks).
const ROWS: { key: keyof PaymentTypeTotals; label: string; color: string; icon: typeof Banknote }[] = [
  { key: 'CASH', label: 'Cash', color: 'var(--chart-cash)', icon: Banknote },
  { key: 'CARD', label: 'POS / card', color: 'var(--chart-card)', icon: CreditCard },
  { key: 'UPI', label: 'UPI', color: 'var(--chart-upi)', icon: Smartphone },
  { key: 'CREDIT', label: 'Credit', color: 'var(--chart-credit)', icon: Wallet },
];

export function PaymentCollection({ totals }: PaymentCollectionProps) {
  const grandTotal = ROWS.reduce((sum, row) => sum + Math.max(0, totals[row.key]), 0);
  const chartData = ROWS.map((row) => ({ ...row, value: Math.max(0, totals[row.key]) })).filter(
    (row) => row.value > 0,
  );

  return (
    <div className="payment-collection">
      <div className="payment-donut">
        {chartData.length === 0 ? (
          <div className="payment-donut-empty">No collections yet today</div>
        ) : (
          <ResponsiveContainer width={148} height={148}>
            <PieChart>
              <Pie
                data={chartData}
                dataKey="value"
                nameKey="label"
                innerRadius={48}
                outerRadius={68}
                paddingAngle={chartData.length > 1 ? 2 : 0}
                stroke="var(--white)"
                strokeWidth={2}
                isAnimationActive={false}
              >
                {chartData.map((row) => (
                  <Cell key={row.key} fill={row.color} />
                ))}
              </Pie>
              {/* Hover layer per the dataviz skill's interaction rules — every
                  mark form except a bare stat tile ships a tooltip. */}
              <Tooltip
                formatter={(value, _name, entry) => [
                  formatRupees(Number(value)),
                  (entry.payload as { label: string }).label,
                ]}
                contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid var(--border)' }}
              />
            </PieChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Direct-labeled legend (≤4 series) — value, share, and an icon per
          row so identity never rests on the donut's color alone. */}
      <div className="payment-legend">
        {ROWS.map((row) => {
          const value = Math.max(0, totals[row.key]);
          const pct = grandTotal > 0 ? (value / grandTotal) * 100 : 0;
          const Icon = row.icon;
          return (
            <div className="payment-legend-row" key={row.key}>
              <Icon size={14} strokeWidth={2} style={{ color: row.color, flexShrink: 0 }} />
              <span className="payment-legend-label">{row.label}</span>
              <span className="payment-legend-value">{formatRupees(value)}</span>
              <span className="payment-legend-pct">{pct.toFixed(0)}%</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
