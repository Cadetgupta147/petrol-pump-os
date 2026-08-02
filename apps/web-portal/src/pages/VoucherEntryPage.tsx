import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Link } from 'react-router-dom';
import { TopBar } from '../components/layout/TopBar';
import { NavBar } from '../components/layout/NavBar';
import { getLedgerAccounts } from '../api/ledgerAccounts';
import { createVoucher, deleteVoucher, getVouchers } from '../api/vouchers';
import { ApiError } from '../api/client';
import { useAuth } from '../context/useAuth';
import { formatRupees, formatDateTime, todayIsoDate } from '../utils/format';
import type { LedgerAccount, VoucherListItem, VoucherType } from '../api/types';

const EPSILON = 0.01;
const VOUCHER_TYPES: VoucherType[] = ['PAYMENT', 'RECEIPT', 'CONTRA', 'JOURNAL', 'SALES'];

// A row's amount lives in exactly one of paid/received — never both. Mirrors
// the old Ledger Master "Dr/Cr" dropdown, but in words a non-accountant
// dealer actually uses: an account either PAID value away (the old CREDIT)
// or RECEIVED value in (the old DEBIT) — same convention as a traditional
// two-column Indian cash book ("To Receipts" / "By Payments"), and the same
// one this pump's old legacy software used. "Paid"/"Received" read the same
// on every row regardless of which ledger it is (Cash, a supplier, an
// expense head, ...) — e.g. paying Toll in cash reads as CASH → Paid,
// TOLL → Received; collecting cash from a credit customer reads as
// CASH → Received, that customer → Paid ("customer paid us").
type LineDraft = { ledgerAccountId: string; paid: string; received: string };

function emptyLine(): LineDraft {
  return { ledgerAccountId: '', paid: '', received: '' };
}

function startedLine(line: LineDraft): boolean {
  return line.ledgerAccountId !== '' || line.paid !== '' || line.received !== '';
}

function lineValid(line: LineDraft): boolean {
  const paidNum = Number(line.paid) || 0;
  const receivedNum = Number(line.received) || 0;
  return line.ledgerAccountId !== '' && (paidNum > 0) !== (receivedNum > 0);
}

// Manual voucher entry (Section 12 Day Book) — Payment/Receipt/Contra/
// Journal, against Ledger Master's account heads. This is the "owner sets
// it up themselves" half of the ledger design (auto-posting from Bills/
// Expenses/Cash Custody/Shift Sales is the other half, and never appears
// here — see LedgerPostingService). Grid layout + Paid/Received columns are
// a pure frontend re-skin for fast multi-line entry; the wire format sent
// to POST /vouchers is unchanged (still ledgerAccountId/amount/drCr pairs —
// see buildLinePayload()).
export function VoucherEntryPage() {
  const { staff } = useAuth();
  const canSubmit = staff?.role === 'OWNER' || staff?.role === 'ACCOUNTANT' || staff?.role === 'MANAGER';
  const canDelete = staff?.role === 'OWNER';

  const [ledgerAccounts, setLedgerAccounts] = useState<LedgerAccount[] | null>(null);
  const [ledgerError, setLedgerError] = useState<string | null>(null);

  const [vouchers, setVouchers] = useState<VoucherListItem[] | null>(null);
  const [vouchersError, setVouchersError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [date, setDate] = useState(todayIsoDate());
  const [voucherType, setVoucherType] = useState<VoucherType>('PAYMENT');
  const [narration, setNarration] = useState('');
  const [lines, setLines] = useState<LineDraft[]>([emptyLine(), emptyLine()]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [saved, setSaved] = useState<VoucherListItem | null>(null);
  const firstRowRef = useRef<HTMLSelectElement>(null);

  function loadVouchers(): Promise<void> {
    return getVouchers().then(setVouchers);
  }

  useEffect(() => {
    let cancelled = false;
    getLedgerAccounts()
      .then((result) => {
        if (!cancelled) setLedgerAccounts(result);
      })
      .catch((err) => {
        if (!cancelled) {
          setLedgerError(err instanceof ApiError ? err.message : "Can't reach the backend.");
        }
      });
    loadVouchers().catch((err) => {
      if (!cancelled) {
        setVouchersError(err instanceof ApiError ? err.message : "Can't reach the backend.");
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Selecting an A/C on the currently-last row spawns a fresh blank row
  // below it, spreadsheet-style — so entering line after line never needs a
  // manual "+ Add line" click in the common case.
  function updateLine(index: number, patch: Partial<LineDraft>) {
    setLines((prev) => {
      const next = prev.map((line, i) => (i === index ? { ...line, ...patch } : line));
      const wasEmpty = prev[index].ledgerAccountId === '';
      const nowSet = next[index].ledgerAccountId !== '';
      if (index === prev.length - 1 && wasEmpty && nowSet) {
        next.push(emptyLine());
      }
      return next;
    });
  }

  // Paid and Received are mutually exclusive per row — typing in one clears
  // the other rather than letting a row claim to be both at once.
  function setPaid(index: number, value: string) {
    updateLine(index, { paid: value, received: value.trim() === '' ? lines[index].received : '' });
  }
  function setReceived(index: number, value: string) {
    updateLine(index, { received: value, paid: value.trim() === '' ? lines[index].paid : '' });
  }

  function addLine() {
    setLines((prev) => [...prev, emptyLine()]);
  }

  function removeLine(index: number) {
    setLines((prev) => (prev.length > 2 ? prev.filter((_, i) => i !== index) : prev));
  }

  // Enter in an amount cell jumps straight to the next row's A/C picker
  // instead of submitting the form — keeps a dealer's hands on the keyboard
  // through a whole multi-line voucher.
  function handleAmountKeyDown(index: number, event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    document.getElementById(`v-ledger-${index + 1}`)?.focus();
  }

  const startedLines = lines.filter(startedLine);
  const invalidStarted = startedLines.some((l) => !lineValid(l));
  const validLines = startedLines.filter(lineValid);

  const paidTotal = validLines.reduce((sum, l) => sum + (Number(l.paid) || 0), 0);
  const receivedTotal = validLines.reduce((sum, l) => sum + (Number(l.received) || 0), 0);
  const balanced = Math.abs(paidTotal - receivedTotal) <= EPSILON;

  const canAttemptSubmit =
    canSubmit && !submitting && !invalidStarted && validLines.length >= 2 && balanced && date.trim() !== '';

  // Paid -> CREDIT, Received -> DEBIT (see LineDraft's comment for why).
  function buildLinePayload(line: LineDraft) {
    const paidNum = Number(line.paid) || 0;
    return paidNum > 0
      ? { ledgerAccountId: line.ledgerAccountId, drCr: 'CREDIT' as const, amount: paidNum }
      : { ledgerAccountId: line.ledgerAccountId, drCr: 'DEBIT' as const, amount: Number(line.received) };
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitError(null);
    setSaved(null);
    setSubmitting(true);
    try {
      const result = await createVoucher({
        date,
        voucherType,
        narration: narration.trim() || undefined,
        lines: validLines.map(buildLinePayload),
      });
      setSaved(result);
      setNarration('');
      setLines([emptyLine(), emptyLine()]);
      firstRowRef.current?.focus();
      await loadVouchers();
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.message : "Can't reach the backend.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(id: string) {
    setDeleteError(null);
    setDeletingId(id);
    try {
      await deleteVoucher(id);
      await loadVouchers();
    } catch (err) {
      setDeleteError(err instanceof ApiError ? err.message : "Can't reach the backend.");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <>
      <TopBar />
      <NavBar />
      <div className="content">
        <div className="content-header">
          <div className="section-title">
            <h3>Voucher entry</h3>
            <span className="section-note">
              POST /vouchers — Payment/Receipt/Contra/Journal against Ledger Master accounts
              (Section 12)
            </span>
          </div>
          <div className="content-header-right">
            <Link to="/ledger-accounts" className="btn-secondary">
              Ledger Master &rsaquo;
            </Link>
            <Link to="/day-book" className="btn-secondary">
              Day book &rsaquo;
            </Link>
          </div>
        </div>

        {ledgerError && <div className="section-note">{ledgerError}</div>}

        {!canSubmit && (
          <div className="banner">
            Your role can view vouchers but not file new ones (Section 2) — enforced by the
            backend regardless of what this page shows.
          </div>
        )}

        {canSubmit && (
          <form className="section" onSubmit={(e) => { void handleSubmit(e); }}>
            <div className="grid grid-3">
              <div className="form-field">
                <label htmlFor="v-date">Date</label>
                <input
                  id="v-date"
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  required
                />
              </div>
              <div className="form-field">
                <label htmlFor="v-type">Voucher type</label>
                <select
                  id="v-type"
                  value={voucherType}
                  onChange={(e) => setVoucherType(e.target.value as VoucherType)}
                >
                  {VOUCHER_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t[0] + t.slice(1).toLowerCase()}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-field">
                <label htmlFor="v-narration">Narration (optional)</label>
                <input
                  id="v-narration"
                  value={narration}
                  onChange={(e) => setNarration(e.target.value)}
                  placeholder="e.g. Toll for JEEP 0711"
                />
              </div>
            </div>

            <div className="section-title">
              <h3>Lines</h3>
              <span className="section-note">
                one account per row — put the amount under Paid or Received, not both
              </span>
            </div>

            <div className="table-card" style={{ marginBottom: 0, padding: 0 }}>
              <table className="billing-grid-table">
                <thead>
                  <tr>
                    <th>A/C</th>
                    <th className="num">Paid (Rs.)</th>
                    <th className="num">Received (Rs.)</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line, index) => (
                    <tr key={index}>
                      <td>
                        <select
                          id={`v-ledger-${index}`}
                          ref={index === 0 ? firstRowRef : undefined}
                          value={line.ledgerAccountId}
                          onChange={(e) => updateLine(index, { ledgerAccountId: e.target.value })}
                          disabled={!ledgerAccounts}
                        >
                          <option value="">{ledgerAccounts ? '— select —' : 'Loading…'}</option>
                          {ledgerAccounts?.map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="num">
                        <input
                          id={`v-paid-${index}`}
                          type="number"
                          min="0"
                          step="0.01"
                          value={line.paid}
                          onChange={(e) => setPaid(index, e.target.value)}
                          onKeyDown={(e) => handleAmountKeyDown(index, e)}
                        />
                      </td>
                      <td className="num">
                        <input
                          id={`v-received-${index}`}
                          type="number"
                          min="0"
                          step="0.01"
                          value={line.received}
                          onChange={(e) => setReceived(index, e.target.value)}
                          onKeyDown={(e) => handleAmountKeyDown(index, e)}
                        />
                      </td>
                      <td>
                        {lines.length > 2 && (
                          <button
                            type="button"
                            className="row-remove-btn"
                            onClick={() => removeLine(index)}
                            title="Remove line"
                          >
                            &times;
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  <tr className="add-row">
                    <td colSpan={3}>
                      <button type="button" className="row-add-btn" onClick={addLine}>
                        + Add line
                      </button>
                    </td>
                    <td></td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="bill-total-bar" style={{ marginBottom: 16 }}>
              <div className="bill-total-bar-breakdown">
                Paid {formatRupees(paidTotal)} &nbsp;·&nbsp; Received {formatRupees(receivedTotal)}
              </div>
              <div
                className="bill-total-bar-value"
                style={{ fontSize: 15, color: balanced ? 'var(--green)' : 'var(--red)' }}
              >
                {balanced
                  ? 'Balanced'
                  : `Off by ${formatRupees(Math.abs(paidTotal - receivedTotal))}`}
              </div>
            </div>

            {submitError && <div className="form-error">{submitError}</div>}
            {saved && (
              <div className="banner ok">Saved as voucher {saved.voucherNumber}.</div>
            )}

            <div className="modal-actions">
              <button type="submit" className="export-btn" disabled={!canAttemptSubmit}>
                {submitting ? 'Saving…' : 'Save voucher'}
              </button>
            </div>
          </form>
        )}

        <div className="section" style={{ marginTop: 34 }}>
          <div className="section-title">
            <h3>Recent vouchers</h3>
            <span className="section-note">GET /vouchers — newest first, every source</span>
          </div>
          {vouchersError && <div className="error-box">{vouchersError}</div>}
          {!vouchersError && !vouchers && <div className="loading">Loading vouchers…</div>}
          {!vouchersError && vouchers && vouchers.length === 0 && (
            <div className="empty-box">No vouchers recorded yet.</div>
          )}
          {!vouchersError && vouchers && vouchers.length > 0 && (
            <div className="table-card">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Voucher #</th>
                    <th>Date</th>
                    <th>Type</th>
                    <th>Source</th>
                    <th>Lines</th>
                    <th>Narration</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {vouchers.map((v) => (
                    <tr key={v.id}>
                      <td>{v.voucherNumber}</td>
                      <td>{formatDateTime(v.date)}</td>
                      <td>{v.voucherType}</td>
                      <td>{v.source}</td>
                      <td>
                        {v.lines
                          .map(
                            (l) =>
                              `${l.drCr === 'DEBIT' ? 'Received' : 'Paid'} ${l.ledgerAccount.name} ${formatRupees(l.amount)}`,
                          )
                          .join(' · ')}
                      </td>
                      <td>{v.narration ?? '—'}</td>
                      <td>
                        {canDelete && v.source === 'MANUAL' && (
                          <button
                            type="button"
                            className="card-sub clickable"
                            disabled={deletingId === v.id}
                            onClick={() => {
                              void handleDelete(v.id);
                            }}
                          >
                            {deletingId === v.id ? 'Deleting…' : 'Delete'}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {deleteError && <div className="form-error">{deleteError}</div>}
        </div>
      </div>
    </>
  );
}
