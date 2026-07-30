import { useMemo } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { MeterReading } from '../../api/types';
import { formatLitres, localIsoDate } from '../../utils/format';

interface DayWiseFuelSalesChartProps {
  readings: MeterReading[];
}

// Fixed categorical order (never cycled/reassigned) — same validated
// --chart-cat-* ramp tokens.css already carries for exactly this purpose
// (see that file's comment).
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
  [productType: string]: string | number;
}

// Fuel identity per nozzle, per productType (falls back to the nozzle's own
// item name, same convention MeterReadingsPage already uses for its Product
// column — productType is only null on legacy pre-Nozzle-master rows).
function fuelTypeOf(reading: MeterReading): string {
  return reading.productType ?? reading.nozzle.item.name;
}

// The physical litres actually dispensed, straight from the meter
// (closingReading - openingReading, i.e. MeterReading.litresSold) — NOT
// derived from Bill rows. A shift's billed total can under/over-count the
// meter (walk-in sales not yet itemized, variance not yet reconciled — see
// NozzleReadingsTable), so "how much fuel did we actually sell today" is
// the meter's own number, grouped by the nozzle's fuel type and the local
// calendar day the shift started on. Only closed shifts have a litresSold
// to count; a still-open shift hasn't dispensed a final figure yet.
function buildDayRows(readings: MeterReading[]): { rows: DayRow[]; productTypes: string[] } {
  const closed = readings.filter((r) => r.litresSold !== null);
  const productTypes = Array.from(new Set(closed.map(fuelTypeOf))).sort();
  const byDay = new Map<string, DayRow>();

  for (const reading of closed) {
    const day = localIsoDate(new Date(reading.shiftStart));
    let row = byDay.get(day);
    if (!row) {
      row = {
        day,
        dayLabel: new Date(reading.shiftStart).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }),
      };
      for (const pt of productTypes) row[pt] = 0;
      byDay.set(day, row);
    }
    row[fuelTypeOf(reading)] = (row[fuelTypeOf(reading)] as number) + (reading.litresSold as number);
  }

  const rows = Array.from(byDay.values()).sort((a, b) => a.day.localeCompare(b.day));
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
        return (
          <div key={pt} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: CATEGORICAL_COLORS[i % CATEGORICAL_COLORS.length], flexShrink: 0 }} />
            <span style={{ color: 'var(--gray)', flex: 1 }}>{pt}</span>
            <span style={{ fontWeight: 600 }}>{formatLitres(litres)}</span>
          </div>
        );
      })}
    </div>
  );
}

// Section 3.1 dashboard addition — fuel sales (litres) broken down by
// calendar day and fuel type, sourced from closed meter-reading shifts (not
// bills — see buildDayRows()'s comment) for the currently selected
// date-range tab. A stacked bar per day: one series per fuel, so a
// multi-day range (week/month) shows the day-over-day trend, not just the
// range total the KPI cards above already cover. See the dataviz skill:
// magnitude-by-day broken by identity is a stacked-bar job, categorical
// hues assigned in fixed order and validated against tokens.css's own
// palette check.
export function DayWiseFuelSalesChart({ readings }: DayWiseFuelSalesChartProps) {
  const { rows, productTypes } = useMemo(() => buildDayRows(readings), [readings]);

  if (rows.length === 0) {
    return <div className="empty-box">No closed meter-reading shifts for this range yet.</div>;
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
        Litres sold per day, stacked by fuel type, from closed meter-reading shifts (closing − opening reading) in
        the selected range — not from billed amounts, so uninvoiced walk-in litres still count.
      </div>
    </div>
  );
}
