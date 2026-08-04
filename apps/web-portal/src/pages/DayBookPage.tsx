import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { TopBar } from '../components/layout/TopBar';
import { NavBar } from '../components/layout/NavBar';
import { getDayBook } from '../api/vouchers';
import { getLedgerAccounts } from '../api/ledgerAccounts';
import { ApiError } from '../api/client';
import { formatRupees, formatDateTime, todayIsoDate } from '../utils/format';
import type {
  DayBookChronologicalReport,
  DayBookLedgerSection,
  DayBookReport,
  LedgerAccount,
  PaymentModeLabel,
  VoucherType,
} from '../api/types';

function balanceLabel(section: { side: 'DR' | 'CR'; amount: number }): string {
  return `${formatRupees(section.amount)} ${section.side === 'DR' ? 'Dr' : 'Cr'}`;
}

type View = 'ledger' | 'chronological';

const VOUCHER_TYPES: VoucherType[] = ['SALES', 'PURCHASE', 'RECEIPT', 'PAYMENT', 'CONTRA', 'JOURNAL'];
const PAYMENT_MODES: PaymentModeLabel[] = ['CASH', 'CARD', 'UPI', 'CREDIT', 'OTHER'];

// Section 12 / 12A — Day Book. Two views over the same Voucher/VoucherLine
// data: the Ledger View (every ledger touched this date, O/B, entries, C/B
// — the dealer's Tally-shaped printout) and the Chronological View (the
// same day's vouchers grouped by shift and sorted in time order instead,
// with a single running cash balance — see docs/master-plan.md Section
// 12A for why petrol pumps need this second lens, not just the first).
export function DayBookPage() {
  const [date, setDate] = useState(todayIsoDate());
  const [view, setView] = useState<View>('ledger');
  const [voucherTypeFilter, setVoucherTypeFilter] = useState('');
  const [paymentModeFilter, setPaymentModeFilter] = useState('');
  const [partyFilter, setPartyFilter] = useState('');
  const [report, setReport] = useState<DayBookReport | DayBookChronologicalReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [partyOptions, setPartyOptions] = useState<LedgerAccount[]>([]);

  // Party filter options — customer/supplier ledgers only (the common case
  // for "who was this voucher with"); fetched once, independent of the
  // Day Book's own date/view/filter state.
  useEffect(() => {
    getLedgerAccounts()
      .then((accounts) =>
        setPartyOptions(
          accounts.filter((a) => a.group === 'SUNDRY_DEBTOR' || a.group === 'SUNDRY_CREDITOR'),
        ),
      )
      .catch(() => setPartyOptions([]));
  }, []);

  useEffect(() => {
    let cancelled = false;
    setReport(null);
    setError(null);
    getDayBook({
      date,
      view,
      voucherType: view === 'chronological' && voucherTypeFilter ? (voucherTypeFilter as VoucherType) : undefined,
      paymentMode:
        view === 'chronological' && paymentModeFilter ? (paymentModeFilter as PaymentModeLabel) : undefined,
      partyLedgerAccountId: view === 'chronological' && partyFilter ? partyFilter : undefined,
    })
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
  }, [date, view, voucherTypeFilter, paymentModeFilter, partyFilter]);

  return (
    <>
      <TopBar />
      <NavBar />
      <div className="content">
        <div className="content-header">
          <div className="section-title">
            <h3>Day book</h3>
            <span className="section-note">
              GET /vouchers/day-book — every ledger touched this date, or the same day
              chronologically by shift (Section 12 / 12A)
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

        <div style={{ display: 'flex', gap: 20, alignItems: 'flex-end', marginBottom: 20 }}>
          <div className="form-field" style={{ maxWidth: 220 }}>
            <label htmlFor="day-book-date">Date</label>
            <input
              id="day-book-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <div className="form-field" style={{ maxWidth: 320 }}>
            <label>View</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                className={view === 'ledger' ? 'btn-primary' : 'btn-secondary'}
                onClick={() => setView('ledger')}
              >
                Ledger
              </button>
              <button
                type="button"
                className={view === 'chronological' ? 'btn-primary' : 'btn-secondary'}
                onClick={() => setView('chronological')}
              >
                Chronological (shift-wise)
              </button>
            </div>
          </div>

          {view === 'chronological' && (
            <>
              <div className="form-field" style={{ maxWidth: 180 }}>
                <label htmlFor="day-book-voucher-type">Voucher type</label>
                <select
                  id="day-book-voucher-type"
                  value={voucherTypeFilter}
                  onChange={(e) => setVoucherTypeFilter(e.target.value)}
                >
                  <option value="">All</option>
                  {VOUCHER_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-field" style={{ maxWidth: 180 }}>
                <label htmlFor="day-book-payment-mode">Payment mode</label>
                <select
                  id="day-book-payment-mode"
                  value={paymentModeFilter}
                  onChange={(e) => setPaymentModeFilter(e.target.value)}
                >
                  <option value="">All</option>
                  {PAYMENT_MODES.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-field" style={{ maxWidth: 220 }}>
                <label htmlFor="day-book-party">Party</label>
                <select
                  id="day-book-party"
                  value={partyFilter}
                  onChange={(e) => setPartyFilter(e.target.value)}
                >
                  <option value="">All</option>
                  {partyOptions.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}
        </div>

        {error && <div className="error-box">{error}</div>}
        {!error && !report && <div className="loading">Loading day book…</div>}

        {!error && report && view === 'ledger' && 'ledgers' in report && (
          <LedgerView report={report} />
        )}

        {!error && report && view === 'chronological' && 'shifts' in report && (
          <ChronologicalView report={report} />
        )}
      </div>
    </>
  );
}

function LedgerView({ report }: { report: DayBookReport }) {
  if (report.ledgers.length === 0) {
    return <div className="empty-box">No vouchers posted on this date.</div>;
  }

  return (
    <>
      {report.ledgers.map((section: DayBookLedgerSection) => (
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
                      {entry.narration && <div className="card-sub">{entry.narration}</div>}
                    </td>
                    <td className="num">{entry.drCr === 'DEBIT' ? formatRupees(entry.amount) : ''}</td>
                    <td className="num">{entry.drCr === 'CREDIT' ? formatRupees(entry.amount) : ''}</td>
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
  );
}

function ChronologicalView({ report }: { report: DayBookChronologicalReport }) {
  const { cashMismatch } = report;
  const hasMismatchData =
    cashMismatch.cashCustodyLogs.length > 0 || cashMismatch.shiftSalesVariances.length > 0;

  if (report.shifts.length === 0) {
    return <div className="empty-box">No vouchers posted on this date.</div>;
  }

  return (
    <>
      {report.shifts.map((shift) => (
        <div className="section" key={shift.shiftDefinitionId ?? 'unassigned'}>
          <div className="section-title">
            <h3>{shift.label}</h3>
            <span className="section-note">
              {shift.windowStart && shift.windowEnd && (
                <>
                  {formatDateTime(shift.windowStart)} &ndash; {formatDateTime(shift.windowEnd)}
                  &nbsp;·&nbsp;
                </>
              )}
              Opening cash {balanceLabel(shift.openingCashBalance)} &nbsp;·&nbsp; Closing cash{' '}
              {balanceLabel(shift.closingCashBalance)}
            </span>
          </div>
          <div className="table-card">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Voucher #</th>
                  <th>Type</th>
                  <th>Payment mode</th>
                  <th>Party</th>
                  <th>Particulars</th>
                  <th>Source</th>
                  <th className="num">Cash balance</th>
                </tr>
              </thead>
              <tbody>
                {shift.entries.map((entry) => (
                  <tr key={entry.voucherId}>
                    <td>{formatDateTime(entry.time)}</td>
                    <td>{entry.voucherNumber}</td>
                    <td>{entry.voucherType}</td>
                    <td>{entry.paymentMode}</td>
                    <td>{entry.partyName ?? '—'}</td>
                    <td>
                      {entry.lines
                        .map(
                          (l) =>
                            `${l.drCr === 'DEBIT' ? 'Dr' : 'Cr'} ${l.ledgerAccountName} ${formatRupees(l.amount)}`,
                        )
                        .join(' · ')}
                      {entry.narration && <div className="card-sub">{entry.narration}</div>}
                    </td>
                    <td>
                      {/* Drill-down: every entry already shows its full lines[]
                          above, so there's nothing further to expand — this
                          is just a pointer back to the source screen. Only
                          BILL has a confirmed detail route today
                          (/bills/:id); other source types (Expense, Cash
                          Custody, Shift Sales, Payment, Purchase, Manual,
                          Opening Balance) don't have one yet, so they show
                          as plain text rather than a guessed URL. */}
                      {entry.source === 'BILL' && entry.sourceKey ? (
                        <Link to={`/bills/${entry.sourceKey.split(':')[1]}`}>{entry.source}</Link>
                      ) : (
                        entry.source
                      )}
                    </td>
                    <td className="num">{balanceLabel(entry.runningCashBalance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      {hasMismatchData && (
        <div className="section">
          <div className="section-title">
            <h3>Cash reconciliation</h3>
            <span className="section-note">
              day-end custody handovers and shift-sales variance for this date, as recorded — not
              recomputed here
            </span>
          </div>
          {cashMismatch.cashCustodyLogs.length > 0 && (
            <div className="table-card" style={{ marginBottom: 12 }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Handled by</th>
                    <th className="num">Total collected</th>
                    <th className="num">Deposited to bank</th>
                    <th className="num">Kept in locker</th>
                    <th className="num">Taken home</th>
                    <th className="num">New outstanding</th>
                  </tr>
                </thead>
                <tbody>
                  {cashMismatch.cashCustodyLogs.map((log) => (
                    <tr key={log.id}>
                      <td>{log.handledByName}</td>
                      <td className="num">{formatRupees(log.totalCashCollected)}</td>
                      <td className="num">{formatRupees(log.depositedToBank)}</td>
                      <td className="num">{formatRupees(log.keptInLocker)}</td>
                      <td className="num">{formatRupees(log.takenHome)}</td>
                      <td className="num">{formatRupees(log.newOutstanding)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {cashMismatch.shiftSalesVariances.length > 0 && (
            <div className="table-card">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Shift</th>
                    <th>Nozzle</th>
                    <th className="num">Expected value</th>
                    <th className="num">Variance</th>
                  </tr>
                </thead>
                <tbody>
                  {cashMismatch.shiftSalesVariances.map((v) => (
                    <tr key={v.id}>
                      <td>{v.shiftId}</td>
                      <td>{v.nozzleId}</td>
                      <td className="num">{formatRupees(v.expectedValue)}</td>
                      <td className="num">{formatRupees(v.variance)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </>
  );
}
