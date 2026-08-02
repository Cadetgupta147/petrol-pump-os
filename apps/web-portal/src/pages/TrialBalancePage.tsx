import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { TopBar } from '../components/layout/TopBar';
import { NavBar } from '../components/layout/NavBar';
import { getTrialBalance } from '../api/vouchers';
import { ApiError } from '../api/client';
import { formatRupees, todayIsoDate } from '../utils/format';
import type { LedgerGroup, TrialBalanceReport } from '../api/types';

function groupLabel(group: LedgerGroup): string {
  return group
    .split('_')
    .map((w) => w[0] + w.slice(1).toLowerCase())
    .join(' ');
}

// Section 12 fix (docs/ledger-accounting-review.md finding #8) — every
// active ledger's running balance as of a date, not just ledgers touched on
// one specific day like the Day Book. The report an accountant actually
// asks for first ("give me a Trial Balance") — this page is the closest
// sibling to DayBookPage.tsx, just a single flat balance-per-ledger table
// instead of per-ledger entry sections.
export function TrialBalancePage() {
  const [asOf, setAsOf] = useState(todayIsoDate());
  const [report, setReport] = useState<TrialBalanceReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getTrialBalance(asOf)
      .then((result) => {
        if (cancelled) return;
        setReport(result);
        setError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setReport(null);
        setError(err instanceof ApiError ? err.message : "Can't reach the backend.");
      });
    return () => {
      cancelled = true;
    };
  }, [asOf]);

  const balanced = report ? Math.abs(report.totals.dr - report.totals.cr) <= 0.01 : true;

  return (
    <>
      <TopBar />
      <NavBar />
      <div className="content">
        <div className="content-header">
          <div className="section-title">
            <h3>Trial balance</h3>
            <span className="section-note">
              GET /vouchers/trial-balance — every active ledger's balance as of a date (Section 12)
            </span>
          </div>
          <div className="content-header-right">
            <Link to="/day-book" className="btn-secondary">
              Day book &rsaquo;
            </Link>
            <Link to="/ledger-accounts" className="btn-secondary">
              Ledger Master &rsaquo;
            </Link>
          </div>
        </div>

        <div className="form-field" style={{ maxWidth: 220, marginBottom: 20 }}>
          <label htmlFor="trial-balance-date">As of</label>
          <input
            id="trial-balance-date"
            type="date"
            value={asOf}
            onChange={(e) => setAsOf(e.target.value)}
          />
        </div>

        {error && <div className="error-box">{error}</div>}
        {!error && !report && <div className="loading">Loading trial balance…</div>}

        {!error && report && report.rows.length === 0 && (
          <div className="empty-box">No ledger accounts yet.</div>
        )}

        {!error && report && report.rows.length > 0 && (
          <div className="section">
            <div className="table-card">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Ledger</th>
                    <th>Group</th>
                    <th className="num">Debit</th>
                    <th className="num">Credit</th>
                  </tr>
                </thead>
                <tbody>
                  {report.rows.map((row) => (
                    <tr key={row.ledgerAccountId}>
                      <td>{row.name}</td>
                      <td>{groupLabel(row.group)}</td>
                      <td className="num">
                        {row.balance.side === 'DR' ? formatRupees(row.balance.amount) : ''}
                      </td>
                      <td className="num">
                        {row.balance.side === 'CR' ? formatRupees(row.balance.amount) : ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={2} style={{ fontWeight: 700 }}>
                      Total
                    </td>
                    <td className="num" style={{ fontWeight: 700 }}>
                      {formatRupees(report.totals.dr)}
                    </td>
                    <td className="num" style={{ fontWeight: 700 }}>
                      {formatRupees(report.totals.cr)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <div className={`banner ${balanced ? 'ok' : ''}`} style={{ marginTop: 16 }}>
              {balanced
                ? 'Balanced — total debits equal total credits'
                : `Off by ${formatRupees(Math.abs(report.totals.dr - report.totals.cr))} — this should never happen with correctly double-entry-posted vouchers; flag for investigation`}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
