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

const EPSILON = 0.01;

// SALES is deliberately excluded — it's reserved for the auto-posted bill/
// shift-sales vouchers (see LedgerPostingService), never a manual pick here.
const VOUCHER_TYPES: VoucherType[] = ['PAYMENT', 'RECEIPT', 'CONTRA', 'JOURNAL'];
const ACCOUNT_MODE_TYPES: VoucherType[] = ['PAYMENT', 'RECEIPT', 'CONTRA'];

// --- Journal mode: the old free-form grid (no fixed account; every line is
// typed by hand and the whole set must balance) -----------------------------
//
// A row's amount lives in exactly one of paid/received — never both. An
// account either PAID value away (CREDIT) or RECEIVED value in (DEBIT) —
// same convention as a traditional two-column Indian cash book ("To
// Receipts" / "By Payments").
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

// --- Payment/Receipt/Contra mode: one fixed Account + Particulars ----------
//
// Mirrors how Tally's Payment/Receipt/Contra vouchers actually work: you
// pick ONE Cash/Bank ledger as the voucher's "Account" once, then every
// Particulars row below only needs to name the OTHER party — the software
// silently pairs each row against the Account, so nothing needs to balance
// by hand (the Account's own leg is just the sum of the Particulars, computed
// automatically) and there's no "off by" state to hit. A dealer moving to a
// different Cash/Bank ledger (e.g. SBI instead of Cash) starts a new voucher
// with that ledger as its Account, rather than mixing ledgers into one.
//
// Direction (which side is Paid vs Received) is fixed for the whole voucher
// by its type, not chosen per row:
//   PAYMENT/CONTRA — Account pays out (CREDIT), each Particular receives
//     (DEBIT). E.g. "Cash Paid, Toll Received" / "Cash Paid, SBI Received"
//     (a deposit) — same wording the Recent Vouchers list already uses.
//   RECEIPT — Account receives (DEBIT), each Particular pays (CREDIT). E.g.
//     "Cash Received, Babu Ji Paid" ("Babu Ji paid us").
type ParticularDraft = { ledgerAccountId: string; amount: string };

function emptyParticular(): ParticularDraft {
  return { ledgerAccountId: '', amount: '' };
}

function startedParticular(p: ParticularDraft): boolean {
  return p.ledgerAccountId !== '' || p.amount !== '';
}

function particularValid(p: ParticularDraft): boolean {
  return p.ledgerAccountId !== '' && (Number(p.amount) || 0) > 0;
}

function isCashOrBank(a: LedgerAccount): boolean {
  return a.group === 'CASH_IN_HAND' || a.group === 'BANK';
}

// Manual voucher entry (Section 12 Day Book) — Payment/Receipt/Contra/
// Journal, against Ledger Master's account heads. This is the "owner sets
// it up themselves" half of the ledger design (auto-posting from Bills/
// Expenses/Cash Custody/Shift Sales is the other half, and never appears
// here — see LedgerPostingService). The wire format sent to POST /vouchers
// is unchanged either way (still ledgerAccountId/amount/drCr pairs).
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

  // Account-mode state (Payment/Receipt/Contra) — accountLedgerId survives a
  // save on purpose, so a batch of same-account vouchers (e.g. several Cash
  // Payments in a row) never needs re-picking it.
  const [accountLedgerId, setAccountLedgerId] = useState('');
  const [particulars, setParticulars] = useState<ParticularDraft[]>([emptyParticular()]);
  const firstParticularRef = useRef<HTMLSelectElement>(null);

  // Journal-mode state (the old free-form grid).
  const [lines, setLines] = useState<LineDraft[]>([emptyLine(), emptyLine()]);
  const firstLineRef = useRef<HTMLSelectElement>(null);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [saved, setSaved] = useState<VoucherListItem | null>(null);

  const isAccountMode = ACCOUNT_MODE_TYPES.includes(voucherType);

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

  // --- Account-mode handlers ---

  const accountLedgers = (ledgerAccounts ?? []).filter(isCashOrBank);
  // Contra's whole point is a transfer between two Cash/Bank ledgers, so its
  // Particulars are restricted the same way Account is; Payment/Receipt
  // Particulars can be any ledger (typically a party/expense head, not
  // another Cash/Bank account).
  const particularLedgers = (ledgerAccounts ?? []).filter(
    (a) => a.id !== accountLedgerId && (voucherType !== 'CONTRA' || isCashOrBank(a)),
  );

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

  function addParticular() {
    setParticulars((prev) => [...prev, emptyParticular()]);
  }

  function removeParticular(index: number) {
    setParticulars((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== index) : prev));
  }

  function handleParticularAmountKeyDown(index: number, event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    document.getElementById(`p-ledger-${index + 1}`)?.focus();
  }

  const startedParticulars = particulars.filter(startedParticular);
  const invalidParticulars = startedParticulars.some((p) => !particularValid(p));
  const validParticulars = startedParticulars.filter(particularValid);
  const particularsTotal = validParticulars.reduce((sum, p) => sum + Number(p.amount), 0);

  const canAttemptSubmitAccountMode =
    canSubmit &&
    !submitting &&
    accountLedgerId !== '' &&
    !invalidParticulars &&
    validParticulars.length >= 1 &&
    date.trim() !== '';

  // PAYMENT/CONTRA: Account pays out (CREDIT), Particulars receive (DEBIT).
  // RECEIPT: Account receives (DEBIT), Particulars pay (CREDIT).
  function buildAccountModeLines(): VoucherLineInput[] {
    const accountDrCr = voucherType === 'RECEIPT' ? ('DEBIT' as const) : ('CREDIT' as const);
    const particularDrCr = voucherType === 'RECEIPT' ? ('CREDIT' as const) : ('DEBIT' as const);
    return [
      { ledgerAccountId: accountLedgerId, amount: particularsTotal, drCr: accountDrCr },
      ...validParticulars.map((p) => ({
        ledgerAccountId: p.ledgerAccountId,
        amount: Number(p.amount),
        drCr: particularDrCr,
      })),
    ];
  }

  // --- Journal-mode handlers (unchanged free-form grid) ---

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

  const canAttemptSubmitJournal =
    canSubmit && !submitting && !invalidStarted && validLines.length >= 2 && balanced && date.trim() !== '';

  // Paid -> CREDIT, Received -> DEBIT (see LineDraft's comment for why).
  function buildJournalModeLines(): VoucherLineInput[] {
    return validLines.map((line) => {
      const paidNum = Number(line.paid) || 0;
      return paidNum > 0
        ? { ledgerAccountId: line.ledgerAccountId, drCr: 'CREDIT' as const, amount: paidNum }
        : { ledgerAccountId: line.ledgerAccountId, drCr: 'DEBIT' as const, amount: Number(line.received) };
    });
  }

  // --- Shared submit ---

  const canAttemptSubmit = isAccountMode ? canAttemptSubmitAccountMode : canAttemptSubmitJournal;

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
        lines: isAccountMode ? buildAccountModeLines() : buildJournalModeLines(),
      });
      setSaved(result);
      setNarration('');
      setParticulars([emptyParticular()]);
      setLines([emptyLine(), emptyLine()]);
      if (isAccountMode) {
        firstParticularRef.current?.focus();
      } else {
        firstLineRef.current?.focus();
      }
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

  const particularsColumnLabel = voucherType === 'RECEIPT' ? 'Paid (Rs.)' : 'Received (Rs.)';
  const accountRoleHint = voucherType === 'RECEIPT' ? 'money received into this account' : 'money paid out of this account';

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

            {isAccountMode ? (
              <>
                <div className="grid grid-3">
                  <div className="form-field">
                    <label htmlFor="v-account">Account ({accountRoleHint})</label>
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
                          {a.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="section-title">
                  <h3>Particulars</h3>
                  <span className="section-note">
                    who the money went to or came from — one row per party, {particularsColumnLabel} only
                  </span>
                </div>

                <div className="table-card" style={{ marginBottom: 0, padding: 0 }}>
                  <table className="billing-grid-table">
                    <thead>
                      <tr>
                        <th>A/C</th>
                        <th className="num">{particularsColumnLabel}</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {particulars.map((p, index) => (
                        <tr key={index}>
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
                              id={`p-amount-${index}`}
                              type="number"
                              min="0"
                              step="0.01"
                              value={p.amount}
                              onChange={(e) => updateParticular(index, { amount: e.target.value })}
                              onKeyDown={(e) => handleParticularAmountKeyDown(index, e)}
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
                        <td colSpan={2}>
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
                    {ledgerAccounts?.find((a) => a.id === accountLedgerId)?.name ?? 'Account'} —{' '}
                    {voucherType === 'RECEIPT' ? 'Received' : 'Paid'}
                  </div>
                  <div className="bill-total-bar-value" style={{ fontSize: 15 }}>
                    {formatRupees(particularsTotal)}
                  </div>
                </div>
              </>
            ) : (
              <>
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
                              ref={index === 0 ? firstLineRef : undefined}
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
              </>
            )}

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
