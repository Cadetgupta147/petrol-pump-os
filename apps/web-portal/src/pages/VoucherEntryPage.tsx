import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Link } from 'react-router-dom';
import { TopBar } from '../components/layout/TopBar';
import { NavBar } from '../components/layout/NavBar';
import { getLedgerAccounts } from '../api/ledgerAccounts';
import { createVoucher, deleteVoucher, getVouchers } from '../api/vouchers';
import { ApiError } from '../api/client';
import { useAuth } from '../context/useAuth';
import { formatRupees, formatDateTime, todayIsoDate } from '../utils/format';
import type { LedgerAccount, VoucherLineInput, VoucherListItem, VoucherType } from '../api/types';

// Mirrors the legacy pump-software voucher grid: one fixed Account (the
// "C/B Code" — a single Cash/Bank ledger) for the whole voucher, then a
// Particulars grid below it where every row just names the OTHER party and
// picks Paid or Received — mixed freely within the same voucher (some rows
// paid, some received), same as that reference. The Account's own leg(s)
// are computed as the sum of each column rather than typed by hand, so nine
// times out of ten there's nothing to balance and no way to see an "off by"
// state. There's no separate "Voucher type" picker any more — Payment vs
// Receipt vs a mixed Journal-shaped voucher is derived from which of the two
// column totals are nonzero (see deriveVoucherType()).
type ParticularDraft = { ledgerAccountId: string; payment: string; receipt: string; narration: string };

function emptyParticular(): ParticularDraft {
  return { ledgerAccountId: '', payment: '', receipt: '', narration: '' };
}

function startedParticular(p: ParticularDraft): boolean {
  return p.ledgerAccountId !== '' || p.payment !== '' || p.receipt !== '' || p.narration !== '';
}

function particularValid(p: ParticularDraft): boolean {
  const paymentNum = Number(p.payment) || 0;
  const receiptNum = Number(p.receipt) || 0;
  return p.ledgerAccountId !== '' && (paymentNum > 0) !== (receiptNum > 0);
}

function isCashOrBank(a: LedgerAccount): boolean {
  return a.group === 'CASH_IN_HAND' || a.group === 'BANK';
}

function ledgerLabel(a: LedgerAccount): string {
  return `${a.code} — ${a.name}`;
}

// Payment: only the Payments column has amounts. Receipt: only Receipts.
// Both nonzero (some rows paid, some received against the same Account in
// one voucher) doesn't fit either label cleanly, so it's classified as a
// Journal — matches VoucherType's existing meaning (see CreateVoucherDto).
function deriveVoucherType(paymentsTotal: number, receiptsTotal: number): VoucherType {
  if (paymentsTotal > 0 && receiptsTotal > 0) return 'JOURNAL';
  if (receiptsTotal > 0) return 'RECEIPT';
  return 'PAYMENT';
}

// Manual voucher entry (Section 12 Day Book) — the "owner sets it up
// themselves" half of the ledger design (auto-posting from Bills/Expenses/
// Cash Custody/Shift Sales is the other half, and never appears here — see
// LedgerPostingService). The wire format sent to POST /vouchers is
// unchanged underneath (still ledgerAccountId/amount/drCr[/narration] pairs
// — see buildLines()).
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
  // Survives a save on purpose — a batch of same-account vouchers (several
  // Cash entries in a row) never needs re-picking it.
  const [accountLedgerId, setAccountLedgerId] = useState('');
  const [particulars, setParticulars] = useState<ParticularDraft[]>([emptyParticular()]);
  const firstParticularRef = useRef<HTMLSelectElement>(null);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [saved, setSaved] = useState<VoucherListItem | null>(null);

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

  const accountLedgers = (ledgerAccounts ?? []).filter(isCashOrBank);
  const particularLedgers = (ledgerAccounts ?? []).filter((a) => a.id !== accountLedgerId);
  const selectedAccount = ledgerAccounts?.find((a) => a.id === accountLedgerId);
  const codeOf = (ledgerAccountId: string) => ledgerAccounts?.find((a) => a.id === ledgerAccountId)?.code ?? '—';

  // Selecting an A/C on the currently-last row spawns a fresh blank row
  // below it, spreadsheet-style — so entering line after line never needs a
  // manual "+ Add line" click in the common case.
  function updateParticular(index: number, patch: Partial<ParticularDraft>) {
    setParticulars((prev) => {
      const next = prev.map((p, i) => (i === index ? { ...p, ...patch } : p));
      const wasEmpty = prev[index].ledgerAccountId === '';
      const nowSet = next[index].ledgerAccountId !== '';
      if (index === prev.length - 1 && wasEmpty && nowSet) {
        next.push(emptyParticular());
      }
      return next;
    });
  }

  // Payment and Receipt are mutually exclusive per row — typing in one
  // clears the other rather than letting a row claim to be both at once.
  function setPayment(index: number, value: string) {
    updateParticular(index, { payment: value, receipt: value.trim() === '' ? particulars[index].receipt : '' });
  }
  function setReceipt(index: number, value: string) {
    updateParticular(index, { receipt: value, payment: value.trim() === '' ? particulars[index].payment : '' });
  }

  function addParticular() {
    setParticulars((prev) => [...prev, emptyParticular()]);
  }

  function removeParticular(index: number) {
    setParticulars((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== index) : prev));
  }

  function handleAmountKeyDown(index: number, event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    document.getElementById(`p-ledger-${index + 1}`)?.focus();
  }

  const startedParticulars = particulars.filter(startedParticular);
  const invalidParticulars = startedParticulars.some((p) => !particularValid(p));
  const validParticulars = startedParticulars.filter(particularValid);

  const paymentsTotal = validParticulars.reduce((sum, p) => sum + (Number(p.payment) || 0), 0);
  const receiptsTotal = validParticulars.reduce((sum, p) => sum + (Number(p.receipt) || 0), 0);

  const canAttemptSubmit =
    canSubmit &&
    !submitting &&
    accountLedgerId !== '' &&
    !invalidParticulars &&
    validParticulars.length >= 1 &&
    date.trim() !== '';

  // Account's own leg(s): CREDIT for whatever it paid out, DEBIT for
  // whatever it received — one line each, only when that column has
  // anything in it (a pure-Payment voucher never gets a DEBIT Account line).
  // Each Particular becomes the mirror entry: DEBIT when it was paid
  // (received the value), CREDIT when it received (gave/reduced a balance) —
  // same Paid=CREDIT/Received=DEBIT convention as the rest of this ledger.
  function buildLines(): VoucherLineInput[] {
    const lines: VoucherLineInput[] = [];
    if (paymentsTotal > 0) {
      lines.push({ ledgerAccountId: accountLedgerId, amount: paymentsTotal, drCr: 'CREDIT' });
    }
    if (receiptsTotal > 0) {
      lines.push({ ledgerAccountId: accountLedgerId, amount: receiptsTotal, drCr: 'DEBIT' });
    }
    for (const p of validParticulars) {
      const narration = p.narration.trim() || undefined;
      const paymentNum = Number(p.payment) || 0;
      if (paymentNum > 0) {
        lines.push({ ledgerAccountId: p.ledgerAccountId, amount: paymentNum, drCr: 'DEBIT', narration });
      } else {
        lines.push({ ledgerAccountId: p.ledgerAccountId, amount: Number(p.receipt), drCr: 'CREDIT', narration });
      }
    }
    return lines;
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitError(null);
    setSaved(null);
    setSubmitting(true);
    try {
      const result = await createVoucher({
        date,
        voucherType: deriveVoucherType(paymentsTotal, receiptsTotal),
        lines: buildLines(),
      });
      setSaved(result);
      setParticulars([emptyParticular()]);
      firstParticularRef.current?.focus();
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
              POST /vouchers — one Cash/Bank Account, mixed Paid/Received particulars (Section 12)
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
                <label htmlFor="v-account">Account (C/B code)</label>
                <select
                  id="v-account"
                  value={accountLedgerId}
                  onChange={(e) => setAccountLedgerId(e.target.value)}
                  disabled={!ledgerAccounts}
                  required
                >
                  <option value="" disabled>
                    {ledgerAccounts ? '— select a Cash or Bank ledger —' : 'Loading…'}
                  </option>
                  {accountLedgers.map((a) => (
                    <option key={a.id} value={a.id}>
                      {ledgerLabel(a)}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="section-title">
              <h3>Particulars</h3>
              <span className="section-note">
                who the money went to or came from — one row per party, Paid or Received, not both
              </span>
            </div>

            <div className="table-card" style={{ marginBottom: 0, padding: 0 }}>
              <table className="billing-grid-table">
                <thead>
                  <tr>
                    <th>A/C</th>
                    <th>Description</th>
                    <th className="num">Payments (Rs.)</th>
                    <th className="num">Receipts (Rs.)</th>
                    <th>Narration</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {particulars.map((p, index) => (
                    <tr key={index}>
                      <td className="readonly-cell">{p.ledgerAccountId ? codeOf(p.ledgerAccountId) : '—'}</td>
                      <td>
                        <select
                          id={`p-ledger-${index}`}
                          ref={index === 0 ? firstParticularRef : undefined}
                          value={p.ledgerAccountId}
                          onChange={(e) => updateParticular(index, { ledgerAccountId: e.target.value })}
                          disabled={!ledgerAccounts || !accountLedgerId}
                        >
                          <option value="">
                            {!accountLedgerId ? 'Pick an Account first' : ledgerAccounts ? '— select —' : 'Loading…'}
                          </option>
                          {particularLedgers.map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="num">
                        <input
                          id={`p-payment-${index}`}
                          type="number"
                          min="0"
                          step="0.01"
                          value={p.payment}
                          onChange={(e) => setPayment(index, e.target.value)}
                          onKeyDown={(e) => handleAmountKeyDown(index, e)}
                        />
                      </td>
                      <td className="num">
                        <input
                          id={`p-receipt-${index}`}
                          type="number"
                          min="0"
                          step="0.01"
                          value={p.receipt}
                          onChange={(e) => setReceipt(index, e.target.value)}
                          onKeyDown={(e) => handleAmountKeyDown(index, e)}
                        />
                      </td>
                      <td>
                        <input
                          value={p.narration}
                          onChange={(e) => updateParticular(index, { narration: e.target.value })}
                          placeholder="e.g. Cash Deposited"
                        />
                      </td>
                      <td>
                        {particulars.length > 1 && (
                          <button
                            type="button"
                            className="row-remove-btn"
                            onClick={() => removeParticular(index)}
                            title="Remove line"
                          >
                            &times;
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  <tr className="add-row">
                    <td colSpan={5}>
                      <button type="button" className="row-add-btn" onClick={addParticular}>
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
                {selectedAccount ? ledgerLabel(selectedAccount) : 'Account'} — Payments{' '}
                {formatRupees(paymentsTotal)} &nbsp;·&nbsp; Receipts {formatRupees(receiptsTotal)}
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
                              `${l.drCr === 'DEBIT' ? 'Received' : 'Paid'} ${l.ledgerAccount.name} ${formatRupees(l.amount)}` +
                              (l.narration ? ` (${l.narration})` : ''),
                          )
                          .join(' · ')}
                        {v.narration ? ` — ${v.narration}` : ''}
                      </td>
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
