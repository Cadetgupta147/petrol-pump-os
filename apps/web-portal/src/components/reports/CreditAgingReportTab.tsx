import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useEffect, useState } from 'react';
import { getCreditAgingReport } from '../../api/creditAging';
import { StatusBadge } from '../common/StatusBadge';
import { ApiError } from '../../api/client';
import { formatRupees, formatDateTime } from '../../utils/format';
import type { CreditAgingReport } from '../../api/types';

// Aging = risk: the further right, the more overdue, so this maps to the
// app's existing status colors (good/warning/critical) rather than a
// categorical or sequential ramp — three buckets, three severities, same
// meaning as every other flagged/ok badge in this app.
const BUCKETS = [
  { key: 'bucket0to15', label: '0-15 days', color: 'var(--green)' },
  { key: 'bucket15to30', label: '15-30 days', color: 'var(--amber)' },
  { key: 'bucket30Plus', label: '30+ days', color: 'var(--red)' },
] as const;

// GET /credit-aging/report — Section 12. Already sorted server-side
// (outstanding-first, biggest balance first) — don't re-sort.
export function CreditAgingReportTab() {
  const [report, setReport] = useState<CreditAgingReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getCreditAgingReport()
      .then((result) => {
        if (!cancelled) setReport(result);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : "Can't reach the backend.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return <div className="error-box">{error}</div>;
  if (!report) return <div className="loading">Loading credit aging report…</div>;

  const chartData = BUCKETS.map((b) => ({ label: b.label, amount: report.totals[b.key], color: b.color }));
  const hasAnyOutstanding = report.totals.total > 0;

  return (
    <div>
      <div className="section-note" style={{ marginBottom: 14 }}>
        as of {formatDateTime(report.asOf)}
      </div>

      {hasAnyOutstanding && (
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="card-label" style={{ marginBottom: 12 }}>OUTSTANDING BY AGE</div>
          <ResponsiveContainer width="100%" height={110}>
            <BarChart data={chartData} layout="vertical" margin={{ top: 0, right: 32, bottom: 0, left: 4 }}>
              <XAxis type="number" hide />
              <YAxis
                type="category"
                dataKey="label"
                width={70}
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 11.5, fontWeight: 600, fill: 'var(--text-dark)' }}
              />
              <Tooltip
                cursor={{ fill: 'var(--page-bg)' }}
                formatter={(value) => [formatRupees(Number(value)), 'Outstanding']}
                contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid var(--border)' }}
              />
              <Bar dataKey="amount" radius={[4, 4, 4, 4]} barSize={18} isAnimationActive={false}>
                {chartData.map((row) => (
                  <Cell key={row.label} fill={row.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="grid grid-4" style={{ marginBottom: 20 }}>
        <div className="card">
          <div className="card-label">0-15 DAYS</div>
          <div className="card-value">{formatRupees(report.totals.bucket0to15)}</div>
        </div>
        <div className="card">
          <div className="card-label">15-30 DAYS</div>
          <div className="card-value">{formatRupees(report.totals.bucket15to30)}</div>
        </div>
        <div className="card">
          <div className="card-label">30+ DAYS</div>
          <div className="card-value">{formatRupees(report.totals.bucket30Plus)}</div>
        </div>
        <div className="card">
          <div className="card-label">TOTAL OUTSTANDING</div>
          <div className="card-value">{formatRupees(report.totals.total)}</div>
        </div>
      </div>

      {report.customers.length === 0 ? (
        <div className="empty-box">No customers have ever used credit.</div>
      ) : (
        <div className="table-card">
          <table className="data-table">
            <thead>
              <tr>
                <th>Customer</th>
                <th>Phone</th>
                <th className="num">Credit limit</th>
                <th>Oldest unpaid bill</th>
                <th className="num">0-15 days</th>
                <th className="num">15-30 days</th>
                <th className="num">30+ days</th>
                <th className="num">Total outstanding</th>
              </tr>
            </thead>
            <tbody>
              {report.customers.map((row) => (
                <tr key={row.customerId}>
                  <td>{row.customerName}</td>
                  <td>{row.phone ?? '—'}</td>
                  <td className="num">{formatRupees(row.creditLimit)}</td>
                  <td>{row.oldestUnpaidBillDate ? formatDateTime(row.oldestUnpaidBillDate) : '—'}</td>
                  <td className="num">{formatRupees(row.bucket0to15)}</td>
                  <td className="num">{formatRupees(row.bucket15to30)}</td>
                  <td className="num">{formatRupees(row.bucket30Plus)}</td>
                  <td className="num">
                    <StatusBadge
                      tone={row.hasOutstandingBalance ? 'critical' : 'good'}
                      label={formatRupees(row.totalOutstanding)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
