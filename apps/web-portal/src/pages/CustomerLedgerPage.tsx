import { useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { TopBar } from '../components/layout/TopBar';
import { NavBar } from '../components/layout/NavBar';
import { QrCardModal } from '../components/customers/QrCardModal';
import {
  getCustomerLedger,
  setLoyaltyRateOverride,
  recordCustomerConsent,
  exportCustomerData,
  requestCustomerDeletion,
  addCustomerOpeningBalance,
} from '../api/customers';
import { ApiError } from '../api/client';
import { useAuth } from '../context/useAuth';
import { formatRupees, formatDateTime } from '../utils/format';
import type { CustomerLedger } from '../api/types';

export function CustomerLedgerPage() {
  const { id } = useParams<{ id: string }>();
  const { staff } = useAuth();
  const isOwner = staff?.role === 'OWNER';
  const [ledger, setLedger] = useState<CustomerLedger | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showQrCard, setShowQrCard] = useState(false);
  // Section 6.2 — Owner-only per-customer rate override editing. Kept as a
  // string so an empty input can mean "clear the override" (null).
  const [overrideInput, setOverrideInput] = useState('');
  const [overrideSaving, setOverrideSaving] = useState(false);
  const [overrideError, setOverrideError] = useState<string | null>(null);

  // Section 17.11 — DPDP Act compliance scaffolding. Owner/Accountant can
  // record consent + export data; deletion is Owner-only (irreversible).
  const isOwnerOrAccountant = staff?.role === 'OWNER' || staff?.role === 'ACCOUNTANT';
  const [consentSaving, setConsentSaving] = useState(false);
  const [consentError, setConsentError] = useState<string | null>(null);
  const [exportLoading, setExportLoading] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  // Two-step confirm instead of a native confirm() dialog — irreversible
  // action, so the first click just arms it rather than firing immediately.
  const [confirmingDeletion, setConfirmingDeletion] = useState(false);
  const [deletionSaving, setDeletionSaving] = useState(false);
  const [deletionError, setDeletionError] = useState<string | null>(null);

  // Section 3.4 — onboarding an existing (pre-system) credit customer with a
  // real outstanding balance. Collapsed behind a toggle since most customers
  // are created fresh and never need this.
  const [showOpeningBalanceForm, setShowOpeningBalanceForm] = useState(false);
  const [obAmount, setObAmount] = useState('');
  const [obNote, setObNote] = useState('');
  const [obEffectiveAt, setObEffectiveAt] = useState('');
  const [obSaving, setObSaving] = useState(false);
  const [obError, setObError] = useState<string | null>(null);

  // No privacy-policy content management exists in this codebase yet (see
  // BusinessProfile — no such field). This is a placeholder version string
  // to record consent against until a real one exists — replace once a
  // policy document is actually published.
  const CONSENT_VERSION = 'v1-placeholder';

  async function handleRecordConsent() {
    if (!id || !ledger) return;
    setConsentError(null);
    setConsentSaving(true);
    try {
      const saved = await recordCustomerConsent(id, CONSENT_VERSION);
      setLedger({ ...ledger, customer: saved });
    } catch (err) {
      setConsentError(err instanceof ApiError ? err.message : "Can't reach the backend.");
    } finally {
      setConsentSaving(false);
    }
  }

  async function handleExportData() {
    if (!id) return;
    setExportError(null);
    setExportLoading(true);
    try {
      const data = await exportCustomerData(id);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `customer-${id}-data-export.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      setExportError(err instanceof ApiError ? err.message : "Can't reach the backend.");
    } finally {
      setExportLoading(false);
    }
  }

  async function handleRequestDeletion() {
    if (!id || !ledger) return;
    setDeletionError(null);
    setDeletionSaving(true);
    try {
      const saved = await requestCustomerDeletion(id);
      setLedger({ ...ledger, customer: saved });
      setConfirmingDeletion(false);
    } catch (err) {
      setDeletionError(err instanceof ApiError ? err.message : "Can't reach the backend.");
    } finally {
      setDeletionSaving(false);
    }
  }

  async function handleOverrideSubmit(event: FormEvent) {
    event.preventDefault();
    if (!id || !ledger) return;
    setOverrideError(null);
    setOverrideSaving(true);
    try {
      const trimmed = overrideInput.trim();
      const value = trimmed === '' ? null : Number(trimmed);
      const saved = await setLoyaltyRateOverride(id, value);
      setLedger({ ...ledger, customer: saved });
    } catch (err) {
      // The backend is the real gate — e.g. a 403 for a non-owner, or a 400
      // for a negative rate — we just surface its message.
      setOverrideError(err instanceof ApiError ? err.message : "Can't reach the backend.");
    } finally {
      setOverrideSaving(false);
    }
  }

  async function handleAddOpeningBalance(event: FormEvent) {
    event.preventDefault();
    if (!id) return;
    setObError(null);
    const amount = Number(obAmount);
    if (!obAmount.trim() || Number.isNaN(amount) || amount === 0) {
      setObError('Enter a non-zero amount.');
      return;
    }
    setObSaving(true);
    try {
      await addCustomerOpeningBalance(id, {
        amount,
        note: obNote.trim() === '' ? undefined : obNote.trim(),
        effectiveAt: obEffectiveAt === '' ? undefined : new Date(obEffectiveAt).toISOString(),
      });
      // outstandingBalance/entries all shift — simplest to reload the whole
      // ledger rather than hand-merge the new row into running balances.
      const refreshed = await getCustomerLedger(id);
      setLedger(refreshed);
      setObAmount('');
      setObNote('');
      setObEffectiveAt('');
      setShowOpeningBalanceForm(false);
    } catch (err) {
      setObError(err instanceof ApiError ? err.message : "Can't reach the backend.");
    } finally {
      setObSaving(false);
    }
  }

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    getCustomerLedger(id)
      .then((result) => {
        if (!cancelled) {
          setLedger(result);
          setOverrideInput(
            result.customer.loyaltyRateOverride === null
              ? ''
              : String(result.customer.loyaltyRateOverride),
          );
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : "Can't reach the backend.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  return (
    <>
      <TopBar />
      <NavBar />
      <div className="content">
        <Link to="/customers" className="back-link">
          &lsaquo; Back to customers
        </Link>

        {error && <div className="error-box">{error}</div>}
        {!error && !ledger && <div className="loading">Loading ledger…</div>}

        {!error && ledger && (
          <>
            <div className="section-title">
              <h3>{ledger.customer.name}</h3>
              <span className="section-note">
                {ledger.customer.verificationStatus === 'VERIFIED' ? 'Verified' : 'Informal'} &middot;{' '}
                {ledger.customer.vehicleNumber ?? 'no vehicle on file'} &middot; {ledger.customer.phone ?? 'no phone on file'}
                {ledger.customer.idDocumentType && (
                  <> &middot; {ledger.customer.idDocumentType}: {ledger.customer.idDocumentNumber}</>
                )}
              </span>
            </div>

            <div className="section">
              <div className="grid grid-2">
                <div
                  className="card"
                  style={
                    ledger.outstandingBalance > ledger.creditLimit
                      ? { background: 'var(--red-bg)', borderColor: '#f3c9c9' }
                      : undefined
                  }
                >
                  <div className="card-label">OUTSTANDING BALANCE</div>
                  <div
                    className="card-value"
                    style={{ color: ledger.outstandingBalance > ledger.creditLimit ? 'var(--red)' : undefined }}
                  >
                    {formatRupees(ledger.outstandingBalance)}
                  </div>
                  {ledger.outstandingBalance > ledger.creditLimit && (
                    <div className="card-sub" style={{ color: 'var(--red)' }}>
                      over the {formatRupees(ledger.creditLimit)} limit
                    </div>
                  )}
                </div>
                <div className="card">
                  <div className="card-label">CREDIT LIMIT</div>
                  <div className="card-value">{formatRupees(ledger.creditLimit)}</div>
                </div>
              </div>
            </div>

            <div className="section">
              <div className="section-title">
                <h3>Loyalty</h3>
                <span className="section-note">
                  Section 6.1/6.2 — the QR card only points at this customer; rate and points live
                  here, server-side
                </span>
              </div>
              <div className="grid grid-2">
                <div className="card">
                  <div className="card-label">EARNING RATE</div>
                  <div className="card-value">
                    {ledger.customer.loyaltyRateOverride === null
                      ? 'Dealer default'
                      : ledger.customer.loyaltyRateOverride}
                  </div>
                  <div className="card-sub">
                    {ledger.customer.loyaltyRateOverride === null
                      ? 'no per-customer override set'
                      : 'per-customer override — beats the dealer default'}
                  </div>
                  {isOwner && (
                    <form
                      onSubmit={(e) => {
                        void handleOverrideSubmit(e);
                      }}
                      style={{ display: 'flex', gap: 8, marginTop: 8 }}
                    >
                      <input
                        type="number"
                        min="0"
                        step="any"
                        value={overrideInput}
                        onChange={(e) => setOverrideInput(e.target.value)}
                        placeholder="empty = dealer default"
                        aria-label="Loyalty rate override"
                      />
                      <button type="submit" className="export-btn" disabled={overrideSaving}>
                        {overrideSaving ? 'Saving…' : 'Save'}
                      </button>
                    </form>
                  )}
                  {overrideError && <div className="form-error">{overrideError}</div>}
                </div>
                <div className="card">
                  <div className="card-label">QR CARD</div>
                  <div className="card-sub" style={{ marginBottom: 8 }}>
                    Member ID: {ledger.customer.qrMemberId}
                  </div>
                  <button type="button" className="export-btn" onClick={() => setShowQrCard(true)}>
                    View / print QR card
                  </button>
                </div>
              </div>
            </div>

            {isOwnerOrAccountant && (
              <div className="section">
                <div className="section-title">
                  <h3>Opening balance</h3>
                  <span className="section-note">
                    Section 3.4 — onboarding a customer who already owed money before this system
                    was used
                  </span>
                </div>
                {!showOpeningBalanceForm ? (
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => setShowOpeningBalanceForm(true)}
                  >
                    Record a pre-existing due
                  </button>
                ) : (
                  <form
                    onSubmit={(e) => {
                      void handleAddOpeningBalance(e);
                    }}
                    className="grid grid-2"
                    style={{ alignItems: 'end', gap: 8 }}
                  >
                    <label>
                      Amount owed (₹)
                      <input
                        type="number"
                        step="any"
                        value={obAmount}
                        onChange={(e) => setObAmount(e.target.value)}
                        placeholder="e.g. 5000"
                        aria-label="Opening balance amount"
                      />
                    </label>
                    <label>
                      As of (optional, defaults to today)
                      <input
                        type="date"
                        value={obEffectiveAt}
                        onChange={(e) => setObEffectiveAt(e.target.value)}
                        aria-label="Opening balance effective date"
                      />
                    </label>
                    <label style={{ gridColumn: '1 / -1' }}>
                      Note (optional)
                      <input
                        type="text"
                        value={obNote}
                        onChange={(e) => setObNote(e.target.value)}
                        placeholder="e.g. carried over from paper ledger"
                        aria-label="Opening balance note"
                      />
                    </label>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button type="submit" className="export-btn" disabled={obSaving}>
                        {obSaving ? 'Saving…' : 'Save'}
                      </button>
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => setShowOpeningBalanceForm(false)}
                        disabled={obSaving}
                      >
                        Cancel
                      </button>
                    </div>
                    {obError && <div className="form-error">{obError}</div>}
                  </form>
                )}
              </div>
            )}

            <div className="section">
              <div className="section-title">
                <h3>Ledger</h3>
                <span className="section-note">every bill and payment, oldest first, running balance</span>
              </div>
              {ledger.entries.length === 0 ? (
                <div className="empty-box">No bills or payments recorded for this customer yet.</div>
              ) : (
                <div className="table-card">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Type</th>
                        <th className="num">Net credit impact</th>
                        <th className="num">Running balance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ledger.entries.map((entry) => (
                        <tr key={`${entry.type}-${entry.id}`}>
                          <td>{formatDateTime(entry.timestamp)}</td>
                          <td>
                            <span
                              className="badge"
                              style={{
                                background:
                                  entry.type === 'BILL'
                                    ? 'var(--amber-bg)'
                                    : entry.type === 'PAYMENT'
                                      ? 'var(--green-bg)'
                                      : 'var(--red-bg)',
                                color:
                                  entry.type === 'BILL'
                                    ? 'var(--amber)'
                                    : entry.type === 'PAYMENT'
                                      ? 'var(--green)'
                                      : 'var(--red)',
                              }}
                            >
                              {entry.type === 'BILL'
                                ? 'Bill'
                                : entry.type === 'PAYMENT'
                                  ? 'Payment'
                                  : 'Opening balance'}
                            </span>
                          </td>
                          <td className="num">
                            {entry.netCreditImpact > 0 ? '+' : ''}
                            {formatRupees(entry.netCreditImpact)}
                          </td>
                          <td className="num">{formatRupees(entry.runningBalance)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            <div className="section">
              <div className="section-title">
                <h3>Data privacy</h3>
                <span className="section-note">
                  Section 17.11 — DPDP Act compliance scaffolding, not a legal certification
                </span>
              </div>
              {ledger.customer.dataDeletedAt ? (
                <div className="empty-box">
                  This customer&rsquo;s personal data was anonymized on{' '}
                  {formatDateTime(ledger.customer.dataDeletedAt)}.
                </div>
              ) : (
                <div className="grid grid-2">
                  <div className="card">
                    <div className="card-label">CONSENT</div>
                    <div className="card-value">
                      {ledger.customer.dataConsentAt ? 'Recorded' : 'Not recorded'}
                    </div>
                    <div className="card-sub">
                      {ledger.customer.dataConsentAt
                        ? `${formatDateTime(ledger.customer.dataConsentAt)} · policy ${ledger.customer.dataConsentVersion}`
                        : 'No consent on file for this customer — a real, visible gap, not assumed'}
                    </div>
                    {isOwnerOrAccountant && (
                      <button
                        type="button"
                        className="export-btn"
                        style={{ marginTop: 8 }}
                        onClick={() => {
                          void handleRecordConsent();
                        }}
                        disabled={consentSaving}
                      >
                        {consentSaving ? 'Saving…' : 'Record consent'}
                      </button>
                    )}
                    {consentError && <div className="form-error">{consentError}</div>}
                  </div>
                  <div className="card">
                    <div className="card-label">DATA SUBJECT RIGHTS</div>
                    <div className="card-sub" style={{ marginBottom: 8 }}>
                      Export every piece of personal data on file, or request erasure (anonymizes
                      name/phone/vehicle — bills/payments are kept for financial audit retention).
                    </div>
                    {isOwnerOrAccountant && (
                      <button
                        type="button"
                        className="export-btn"
                        onClick={() => {
                          void handleExportData();
                        }}
                        disabled={exportLoading}
                      >
                        {exportLoading ? 'Exporting…' : 'Export data'}
                      </button>
                    )}
                    {exportError && <div className="form-error">{exportError}</div>}
                    {isOwner && (
                      <div style={{ marginTop: 8 }}>
                        {!confirmingDeletion ? (
                          <button
                            type="button"
                            className="btn-secondary"
                            onClick={() => setConfirmingDeletion(true)}
                          >
                            Request deletion
                          </button>
                        ) : (
                          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                            <span className="section-note">Irreversible — anonymize this customer?</span>
                            <button
                              type="button"
                              className="export-btn"
                              style={{ background: 'var(--red)' }}
                              onClick={() => {
                                void handleRequestDeletion();
                              }}
                              disabled={deletionSaving}
                            >
                              {deletionSaving ? 'Deleting…' : 'Confirm'}
                            </button>
                            <button
                              type="button"
                              className="btn-secondary"
                              onClick={() => setConfirmingDeletion(false)}
                              disabled={deletionSaving}
                            >
                              Cancel
                            </button>
                          </div>
                        )}
                        {deletionError && <div className="form-error">{deletionError}</div>}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </>
        )}

        {showQrCard && id && <QrCardModal customerId={id} onClose={() => setShowQrCard(false)} />}
      </div>
    </>
  );
}
