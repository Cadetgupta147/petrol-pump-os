import { useEffect, useState } from 'react';
import { getCreditAgingReport } from '../../api/creditAging';
import { ApiError } from '../../api/client';
import { formatRupees, formatDateTime } from '../../utils/format';
import type { CreditAgingReport } from '../../api/types';

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

  return (
    <div>
      <div className="section-note" style={{ marginBottom: 14 }}>
        as of {formatDateTime(report.asOf)}
      </div>
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
                    <span
                      className="badge"
                      style={{
                        background: row.hasOutstandingBalance ? 'var(--red-bg)' : 'var(--green-bg)',
                        color: row.hasOutstandingBalance ? 'var(--red)' : 'var(--green)',
                      }}
                    >
                      {formatRupees(row.totalOutstanding)}
                    </span>
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
