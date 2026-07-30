import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { TopBar } from '../components/layout/TopBar';
import { NavBar } from '../components/layout/NavBar';
import { getLedgerAccounts } from '../api/ledgerAccounts';
import { createVoucher, deleteVoucher, getVouchers } from '../api/vouchers';
import { ApiError } from '../api/client';
import { useAuth } from '../context/useAuth';
import { formatRupees, formatDateTime, todayIsoDate } from '../utils/format';
import type { DrCr, LedgerAccount, VoucherListItem, VoucherType } from '../api/types';

const EPSILON = 0.01;
const VOUCHER_TYPES: VoucherType[] = ['PAYMENT', 'RECEIPT', 'CONTRA', 'JOURNAL', 'SALES'];

type LineDraft = { ledgerAccountId: string; drCr: DrCr; amount: string };

function emptyLine(): LineDraft {
  return { ledgerAccountId: '', drCr: 'DEBIT', amount: '' };
}

// Manual voucher entry (Section 12 Day Book) — Payment/Receipt/Contra/
// Journal, against Ledger Master's account heads. This is the "owner sets
// it up themselves" half of the ledger design (auto-posting from Bills/
// Expenses/Cash Custody/Shift Sales is the other half, and never appears
// here — see LedgerPostingService).
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

  function updateLine(index: number, patch: Partial<LineDraft>) {
    setLines((prev) => prev.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  }

  function addLine() {
    setLines((prev) => [...prev, emptyLine()]);
  }

  function removeLine(index: number) {
    setLines((prev) => (prev.length > 2 ? prev.filter((_, i) => i !== index) : prev));
  }

  const debitTotal = lines
    .filter((l) => l.drCr === 'DEBIT')
    .reduce((sum, l) => sum + (Number(l.amount) || 0), 0);
  const creditTotal = lines
    .filter((l) => l.drCr === 'CREDIT')
    .reduce((sum, l) => sum + (Number(l.amount) || 0), 0);
  const balanced = Math.abs(debitTotal - creditTotal) <= EPSILON;

  const linesFilled = lines.every((l) => l.ledgerAccountId && Number(l.amount) > 0);
  const canAttemptSubmit = canSubmit && !submitting && linesFilled && balanced && date.trim() !== '';

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
        lines: lines.map((l) => ({
          ledgerAccountId: l.ledgerAccountId,
          drCr: l.drCr,
          amount: Number(l.amount),
        })),
      });
      setSaved(result);
      setNarration('');
      setLines([emptyLine(), emptyLine()]);
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
              <span className="section-note">debits must equal credits</span>
            </div>
            {lines.map((line, index) => (
              <div className="grid grid-3" key={index} style={{ marginBottom: 10 }}>
                <div className="form-field">
                  <label htmlFor={`v-ledger-${index}`}>Ledger account</label>
                  <select
                    id={`v-ledger-${index}`}
                    value={line.ledgerAccountId}
                    onChange={(e) => updateLine(index, { ledgerAccountId: e.target.value })}
                    disabled={!ledgerAccounts}
                    required
                  >
                    <option value="" disabled>
                      {ledgerAccounts ? 'Select a ledger' : 'Loading…'}
                    </option>
                    {ledgerAccounts?.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-field">
                  <label htmlFor={`v-drcr-${index}`}>Dr / Cr</label>
                  <select
                    id={`v-drcr-${index}`}
                    value={line.drCr}
                    onChange={(e) => updateLine(index, { drCr: e.target.value as DrCr })}
                  >
                    <option value="DEBIT">Debit</option>
                    <option value="CREDIT">Credit</option>
                  </select>
                </div>
                <div className="form-field">
                  <label htmlFor={`v-amount-${index}`}>Amount (Rs.)</label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input
                      id={`v-amount-${index}`}
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={line.amount}
                      onChange={(e) => updateLine(index, { amount: e.target.value })}
                      required
                    />
                    {lines.length > 2 && (
                      <button
                        type="button"
                        className="card-sub clickable"
                        onClick={() => removeLine(index)}
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
            <button type="button" className="btn-secondary" onClick={addLine} style={{ marginBottom: 14 }}>
              + Add line
            </button>

            <div className={`banner ${balanced ? 'ok' : ''}`}>
              {balanced
                ? `Balanced — Dr ${formatRupees(debitTotal)} = Cr ${formatRupees(creditTotal)}`
                : `Off by ${formatRupees(Math.abs(debitTotal - creditTotal))} — Dr ${formatRupees(debitTotal)} vs Cr ${formatRupees(creditTotal)}`}
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
                          .map((l) => `${l.drCr === 'DEBIT' ? 'Dr' : 'Cr'} ${l.ledgerAccount.name} ${formatRupees(l.amount)}`)
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
