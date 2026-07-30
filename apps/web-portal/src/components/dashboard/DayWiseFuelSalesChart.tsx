import { useMemo } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { Bill } from '../../api/types';
import { formatLitres, formatRupees, localIsoDate } from '../../utils/format';

interface DayWiseFuelSalesChartProps {
  bills: Bill[];
}

// Fixed categorical order (never cycled/reassigned) — same validated
// --chart-cat-* ramp tokens.css already carries for exactly this purpose
// (see that file's comment); this is simply the first component to draw
// from it. Product types are whatever a DSM has typed as Bill.productType,
// so this maps in first-seen order rather than a hardcoded Petrol/Diesel
// enum — a 6th+ product folds into the last slot rather than cycling back
// to a color already in use.
const CATEGORICAL_COLORS = [
  'var(--chart-cat-1)',
  'var(--chart-cat-2)',
  'var(--chart-cat-3)',
  'var(--chart-cat-4)',
  'var(--chart-cat-5)',
];

interface DayRow {
  day: string;
  dayLabel: string;
  [productType: string]: string | number | { litres: number; amount: number };
}

function buildDayRows(bills: Bill[]): { rows: DayRow[]; productTypes: string[] } {
  const productTypes = Array.from(new Set(bills.map((b) => b.productType))).sort();
  const byDay = new Map<string, DayRow>();

  for (const bill of bills) {
    const day = localIsoDate(new Date(bill.timestamp));
    let row = byDay.get(day);
    if (!row) {
      row = {
        day,
        dayLabel: new Date(bill.timestamp).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }),
      };
      for (const pt of productTypes) row[pt] = { litres: 0, amount: 0 };
      byDay.set(day, row);
    }
    const existing = row[bill.productType] as { litres: number; amount: number };
    existing.litres += bill.litres;
    existing.amount += bill.amount;
  }

  const rows = Array.from(byDay.values()).sort((a, b) => a.day.localeCompare(b.day));
  // Flatten each product's {litres, amount} into a plain litres number for
  // the bar's dataKey (recharts needs a number to size the bar), keeping
  // the amount alongside under a `__amount_<productType>` key so the
  // tooltip can still show both.
  for (const row of rows) {
    for (const pt of productTypes) {
      const cell = row[pt] as { litres: number; amount: number };
      row[`__amount_${pt}`] = cell.amount;
      row[pt] = cell.litres;
    }
  }
  return { rows, productTypes };
}

function ChartTooltip({
  active,
  payload,
  label,
  productTypes,
}: {
  active?: boolean;
  payload?: { dataKey?: string | number; value?: number; color?: string; payload?: DayRow }[];
  label?: string;
  productTypes: string[];
}) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0].payload;
  if (!row) return null;
  return (
    <div style={{ background: 'var(--white)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', fontSize: 12 }}>
      <div style={{ fontWeight: 700, marginBottom: 6 }}>{label}</div>
      {productTypes.map((pt, i) => {
        const litres = row[pt] as number;
        if (!litres) return null;
        const amount = row[`__amount_${pt}`] as number;
        return (
          <div key={pt} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: CATEGORICAL_COLORS[i % CATEGORICAL_COLORS.length], flexShrink: 0 }} />
            <span style={{ color: 'var(--gray)', flex: 1 }}>{pt}</span>
            <span style={{ fontWeight: 600 }}>{formatLitres(litres)}</span>
            <span style={{ color: 'var(--gray)' }}>({formatRupees(amount)})</span>
          </div>
        );
      })}
    </div>
  );
}

// Section 3.1 dashboard addition — fuel sales (litres) broken down by
// calendar day and product type, for the currently selected date-range tab.
// A stacked bar per day: one series per fuel product, so a multi-day range
// (week/month) shows the day-over-day trend, not just the range total the
// KPI cards above already cover. See the dataviz skill: magnitude-by-day
// broken by identity is a stacked-bar job, categorical hues assigned in
// fixed order and validated against tokens.css's own palette check.
export function DayWiseFuelSalesChart({ bills }: DayWiseFuelSalesChartProps) {
  const { rows, productTypes } = useMemo(() => buildDayRows(bills), [bills]);

  if (rows.length === 0) {
    return <div className="empty-box">No fuel sales recorded for this range.</div>;
  }

  return (
    <div className="table-card">
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={rows} margin={{ top: 8, right: 8, left: 8, bottom: 0 }} barCategoryGap={rows.length <= 3 ? '30%' : '18%'}>
          <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
          <XAxis dataKey="dayLabel" tick={{ fontSize: 11, fill: 'var(--chart-axis)' }} axisLine={{ stroke: 'var(--chart-grid)' }} tickLine={false} />
          <YAxis
            tick={{ fontSize: 11, fill: 'var(--chart-axis)' }}
            axisLine={false}
            tickLine={false}
            width={48}
            tickFormatter={(v: number) => new Intl.NumberFormat('en-IN', { notation: 'compact' }).format(v)}
          />
          <Tooltip content={<ChartTooltip productTypes={productTypes} />} cursor={{ fill: 'var(--page-bg)' }} />
          <Legend
            wrapperStyle={{ fontSize: 11 }}
            formatter={(value: string) => <span style={{ color: 'var(--text-dark)' }}>{value}</span>}
          />
          {productTypes.map((pt, i) => (
            <Bar
              key={pt}
              dataKey={pt}
              name={pt}
              stackId="fuel"
              fill={CATEGORICAL_COLORS[i % CATEGORICAL_COLORS.length]}
              maxBarSize={24}
              radius={i === productTypes.length - 1 ? [4, 4, 0, 0] : undefined}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>

      {/* Table-view fallback for the chart above — the categorical palette's
          light-surface contrast check (tokens.css --chart-cat-*) comes back
          WARN for 3 of the 5 slots, which the dataviz skill treats as
          non-dismissable: it obligates either visible labels or a table
          view, not color alone. This is that table. */}
      <table className="data-table" style={{ marginTop: 16 }}>
        <thead>
          <tr>
            <th>Day</th>
            {productTypes.map((pt) => (
              <th className="num" key={pt}>
                {pt}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.day}>
              <td>{row.dayLabel}</td>
              {productTypes.map((pt) => (
                <td className="num" key={pt}>
                  {formatLitres(row[pt] as number)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      <div className="footnote">
        Litres sold per day, stacked by fuel product type, from the selected range&rsquo;s bills. Hover a bar for the
        exact litres and amount per product.
      </div>
    </div>
  );
}
