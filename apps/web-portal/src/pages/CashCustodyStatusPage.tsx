import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { TopBar } from '../components/layout/TopBar';
import { NavBar } from '../components/layout/NavBar';
import { getCashCustodyReport } from '../api/cashCustody';
import { getShiftSalesSummaries } from '../api/shiftSales';
import { ApiError } from '../api/client';
import { formatRupees, formatLitres, formatDateTime } from '../utils/format';
import type { CashCustodyReportRow, ShiftSalesSummary } from '../api/types';

// Section 8 / 8A — read-only cash custody status dashboard. Per-person
// outstanding balance (Section 8.1 step 3) is the must-have; the walk-in
// shift sales variance list (Section 8A.2) is a secondary, read-only addition
// alongside it since both are "is cash actually where it should be" signals.
export function CashCustodyStatusPage() {
  const [rows, setRows] = useState<CashCustodyReportRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [shiftSales, setShiftSales] = useState<ShiftSalesSummary[] | null>(null);
  const [shiftSalesError, setShiftSalesError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getCashCustodyReport()
      .then((result) => {
        if (!cancelled) setRows(result);
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

  useEffect(() => {
    let cancelled = false;
    getShiftSalesSummaries()
      .then((result) => {
        if (!cancelled) setShiftSales(result);
      })
      .catch((err) => {
        if (!cancelled) {
          setShiftSalesError(
            err instanceof ApiError
              ? `Walk-in shift sales unavailable for your role: ${err.message}`
              : "Walk-in shift sales unavailable — can't reach the backend.",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      <TopBar />
      <NavBar />
      <div className="content">
        <div className="content-header">
          <div className="section-title">
            <h3>Cash custody status</h3>
            <span className="section-note">
              GET /cash-custody/report — who&rsquo;s holding pump cash outside the premises, and for
              how long (Section 8.1 step 3)
            </span>
          </div>
          <div className="content-header-right">
            <Link to="/cash-custody" className="btn-secondary">
              File a day-end entry &rsaquo;
            </Link>
          </div>
        </div>

        {error && <div className="error-box">{error}</div>}
        {!error && !rows && <div className="loading">Loading cash custody report…</div>}
        {!error && rows && rows.length === 0 && (
          <div className="empty-box">No cash custody entries recorded yet.</div>
        )}
        {!error && rows && rows.length > 0 && (
          <div className="table-card">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Staff</th>
                  <th>Status</th>
                  <th className="num">Outstanding</th>
                  <th>Held since</th>
                  <th className="num">Days held</th>
                  <th>Last entry</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.staffId}>
                    <td>{row.staffName}</td>
                    <td>
                      <span
                        className="badge"
                        style={{
                          background: row.isCurrentlyOutstanding ? 'var(--red-bg)' : 'var(--green-bg)',
                          color: row.isCurrentlyOutstanding ? 'var(--red)' : 'var(--green)',
                        }}
                      >
                        {row.isCurrentlyOutstanding ? 'Holding cash' : 'Settled'}
                      </span>
                    </td>
                    <td className="num">{formatRupees(row.currentOutstanding)}</td>
                    <td>
                      {row.outstandingSinceDate
                        ? new Date(row.outstandingSinceDate).toLocaleDateString('en-IN')
                        : '—'}
                    </td>
                    <td className="num">{row.isCurrentlyOutstanding ? row.daysHeld : '—'}</td>
                    <td>{new Date(row.lastEntryDate).toLocaleDateString('en-IN')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="section" style={{ marginTop: 34 }}>
          <div className="section-title">
            <h3>Walk-in shift sales (secondary)</h3>
            <span className="section-note">
              GET /shift-sales — expected walk-in value vs. cash + UPI + card actually collected
              (Section 8A.2)
            </span>
          </div>

          {shiftSalesError && <div className="section-note">{shiftSalesError}</div>}
          {!shiftSalesError && !shiftSales && <div className="loading">Loading shift sales…</div>}
          {!shiftSalesError && shiftSales && shiftSales.length === 0 && (
            <div className="empty-box">No walk-in shift sales summaries recorded yet.</div>
          )}
          {!shiftSalesError && shiftSales && shiftSales.length > 0 && (
            <div className="table-card">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Nozzle</th>
                    <th className="num">Walk-in litres</th>
                    <th className="num">Cash</th>
                    <th className="num">UPI (auto)</th>
                    <th className="num">Card</th>
                    <th className="num">Expected value</th>
                    <th className="num">Variance</th>
                    <th>Recorded at</th>
                  </tr>
                </thead>
                <tbody>
                  {shiftSales.map((row) => (
                    <tr key={row.id}>
                      <td>{row.nozzleId}</td>
                      <td className="num">{formatLitres(row.walkInLitres)}</td>
                      <td className="num">{formatRupees(row.walkInCashCollected)}</td>
                      <td className="num">{formatRupees(row.walkInUpiCollected)}</td>
                      <td className="num">{formatRupees(row.walkInCardCollected)}</td>
                      <td className="num">{formatRupees(row.expectedValue)}</td>
                      <td
                        className="num"
                        style={{ color: Math.abs(row.variance) > 0.01 ? 'var(--red)' : 'var(--green)' }}
                      >
                        {row.variance > 0 ? '+' : ''}
                        {formatRupees(row.variance)}
                      </td>
                      <td>{formatDateTime(row.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
