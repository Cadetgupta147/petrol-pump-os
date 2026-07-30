import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { TopBar } from '../components/layout/TopBar';
import { NavBar } from '../components/layout/NavBar';
import { getDayBook } from '../api/vouchers';
import { ApiError } from '../api/client';
import { formatRupees, formatDateTime, todayIsoDate } from '../utils/format';
import type { DayBookLedgerSection, DayBookReport } from '../api/types';

function balanceLabel(section: DayBookLedgerSection['openingBalance']): string {
  return `${formatRupees(section.amount)} ${section.side === 'DR' ? 'Dr' : 'Cr'}`;
}

// Section 12 — Day Book: every ledger touched on the selected date (Cash,
// Bank, Sales, and any dealer-created heads — parties, personal draws,
// expense categories), each with its opening balance, the day's entries
// against it, and closing balance — the same shape as the dealer's Tally
// printout (opening/closing per ledger, counterparty name per entry). Plus
// a flat chronological voucher list underneath (the "vanilla" Day Book
// view). Replaces the earlier cash-flow-only Day Book — see DayBookReport's
// doc comment (api/types.ts) for why a real chart-of-accounts was needed.
export function DayBookPage() {
  const [date, setDate] = useState(todayIsoDate());
  const [report, setReport] = useState<DayBookReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setReport(null);
    setError(null);
    getDayBook(date)
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
  }, [date]);

  return (
    <>
      <TopBar />
      <NavBar />
      <div className="content">
        <div className="content-header">
          <div className="section-title">
            <h3>Day book</h3>
            <span className="section-note">
              GET /vouchers/day-book — every ledger touched this date, with opening/closing
              balances (Section 12)
            </span>
          </div>
          <div className="content-header-right">
            <Link to="/vouchers" className="btn-secondary">
              Voucher entry &rsaquo;
            </Link>
            <Link to="/ledger-accounts" className="btn-secondary">
              Ledger Master &rsaquo;
            </Link>
          </div>
        </div>

        <div className="form-field" style={{ maxWidth: 220, marginBottom: 20 }}>
          <label htmlFor="day-book-date">Date</label>
          <input
            id="day-book-date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>

        {error && <div className="error-box">{error}</div>}
        {!error && !report && <div className="loading">Loading day book…</div>}

        {!error && report && report.ledgers.length === 0 && (
          <div className="empty-box">No vouchers posted on this date.</div>
        )}

        {!error && report && report.ledgers.length > 0 && (
          <>
            {report.ledgers.map((section) => (
              <div className="section" key={section.ledgerAccountId}>
                <div className="section-title">
                  <h3>{section.name}</h3>
                  <span className="section-note">
                    O/B {balanceLabel(section.openingBalance)} &nbsp;·&nbsp; C/B{' '}
                    {balanceLabel(section.closingBalance)}
                  </span>
                </div>
                <div className="table-card">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Voucher #</th>
                        <th>Particulars</th>
                        <th className="num">Debit</th>
                        <th className="num">Credit</th>
                      </tr>
                    </thead>
                    <tbody>
                      {section.entries.map((entry, i) => (
                        <tr key={`${entry.voucherId}-${i}`}>
                          <td>{entry.voucherNumber}</td>
                          <td>
                            {entry.counterpartyNames.join(', ') || '—'}
                            {entry.narration && (
                              <div className="card-sub">{entry.narration}</div>
                            )}
                          </td>
                          <td className="num">
                            {entry.drCr === 'DEBIT' ? formatRupees(entry.amount) : ''}
                          </td>
                          <td className="num">
                            {entry.drCr === 'CREDIT' ? formatRupees(entry.amount) : ''}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}

            <div className="section">
              <div className="section-title">
                <h3>All vouchers this date</h3>
                <span className="section-note">chronological, every ledger involved</span>
              </div>
              <div className="table-card">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Voucher #</th>
                      <th>Time</th>
                      <th>Type</th>
                      <th>Source</th>
                      <th>Lines</th>
                      <th>Narration</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.vouchers.map((v) => (
                      <tr key={v.id}>
                        <td>{v.voucherNumber}</td>
                        <td>{formatDateTime(v.date)}</td>
                        <td>{v.voucherType}</td>
                        <td>{v.source}</td>
                        <td>
                          {v.lines
                            .map(
                              (l) =>
                                `${l.drCr === 'DEBIT' ? 'Dr' : 'Cr'} ${l.ledgerAccountName} ${formatRupees(l.amount)}`,
                            )
                            .join(' · ')}
                        </td>
                        <td>{v.narration ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}
