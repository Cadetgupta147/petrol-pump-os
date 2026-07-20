import { useEffect, useState, type FormEvent } from 'react';
import { TopBar } from '../components/layout/TopBar';
import { NavBar } from '../components/layout/NavBar';
import { getRateHistory, createRateHistory } from '../api/rateMaster';
import { ApiError } from '../api/client';
import { useAuth } from '../context/useAuth';
import { formatRatePerLitre, formatDateTime } from '../utils/format';
import type { RateHistory } from '../api/types';

// Section 7.4 — Rate Master: append-only, date-wise fuel pricing per
// product. Same settings-editor shape as CreditSettingsPage/
// LoyaltySettingsPage (load -> display -> edit form below), but the role
// gate here is Owner/Accountant, not Owner-only — RateMasterController is
// class-level @Roles(Role.OWNER, Role.ACCOUNTANT) with no narrower
// method-level override on POST, unlike credit-config/loyalty-config's
// Owner-only PUT/PATCH. The real enforcement is server-side either way;
// this form is only hidden client-side as a courtesy.
//
// Deliberately built on GET /rate-master (the full history), not GET
// /rate-master/current — the latter needs a productType per call, which
// would mean one request per distinct product just to render a "current
// rate" summary. "Current" below is instead derived client-side from the
// same history list already being displayed (computeCurrentRates mirrors
// RateMasterService.getCurrentRate()'s own "latest effectiveFrom <= now"
// logic), so the page only ever makes the one GET /rate-master call.
function computeCurrentRates(history: RateHistory[]): RateHistory[] {
  const now = Date.now();
  const current = new Map<string, RateHistory>();
  for (const row of history) {
    const effectiveAt = new Date(row.effectiveFrom).getTime();
    if (effectiveAt > now) continue; // future-dated, not yet in effect
    const existing = current.get(row.productType);
    if (!existing || effectiveAt > new Date(existing.effectiveFrom).getTime()) {
      current.set(row.productType, row);
    }
  }
  return Array.from(current.values()).sort((a, b) => a.productType.localeCompare(b.productType));
}

export function RateMasterPage() {
  const { staff } = useAuth();
  const canEdit = staff?.role === 'OWNER' || staff?.role === 'ACCOUNTANT';

  const [history, setHistory] = useState<RateHistory[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [productType, setProductType] = useState('');
  const [rate, setRate] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  function load(): Promise<void> {
    return getRateHistory().then(setHistory);
  }

  useEffect(() => {
    let cancelled = false;
    load().catch((err) => {
      if (!cancelled) {
        setError(err instanceof ApiError ? err.message : "Can't reach the backend.");
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSaveError(null);
    setSavedAt(null);
    setSaving(true);
    try {
      await createRateHistory({
        productType: productType.trim(),
        rate: Number(rate.trim()),
        effectiveFrom,
      });
      setProductType('');
      setRate('');
      setEffectiveFrom('');
      setSavedAt(new Date().toLocaleTimeString());
      await load();
    } catch (err) {
      // Covers the (productType, effectiveFrom) unique-constraint 400/409 —
      // surfaced verbatim (RateMasterService.create()).
      setSaveError(err instanceof ApiError ? err.message : "Can't reach the backend.");
    } finally {
      setSaving(false);
    }
  }

  const currentRates = history ? computeCurrentRates(history) : [];

  return (
    <>
      <TopBar />
      <NavBar />
      <div className="content">
        <div className="section-title">
          <h3>Rate Master</h3>
          <span className="section-note">
            date-wise fuel pricing per product, append-only (Section 7.4)
          </span>
        </div>

        {error && <div className="error-box">{error}</div>}
        {!error && !history && <div className="loading">Loading rate history…</div>}

        {!error && history && (
          <>
            {currentRates.length > 0 && (
              <div className="section">
                <div className="grid grid-3">
                  {currentRates.map((row) => (
                    <div className="card" key={row.productType}>
                      <div className="card-label">{row.productType.toUpperCase()} — CURRENT RATE</div>
                      <div className="card-value">{formatRatePerLitre(row.rate)}</div>
                      <div className="card-sub">effective from {formatDateTime(row.effectiveFrom)}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="section">
              <div className="section-title">
                <h3>Rate history</h3>
                <span className="section-note">most recent effectiveFrom first</span>
              </div>
              {history.length === 0 ? (
                <div className="empty-box">No rates configured yet.</div>
              ) : (
                <div className="table-card">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Product</th>
                        <th className="num">Rate</th>
                        <th>Effective from</th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.map((row) => (
                        <tr key={row.id}>
                          <td>{row.productType}</td>
                          <td className="num">{formatRatePerLitre(row.rate)}</td>
                          <td>{formatDateTime(row.effectiveFrom)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {canEdit ? (
              <form className="section" onSubmit={(e) => { void handleSubmit(e); }}>
                <div className="section-title">
                  <h3>Add rate</h3>
                  <span className="section-note">Owner/Accountant — enforced by the backend</span>
                </div>
                <div className="form-field">
                  <label htmlFor="rm-product">Product type</label>
                  <input
                    id="rm-product"
                    value={productType}
                    onChange={(e) => setProductType(e.target.value)}
                    placeholder="e.g. Petrol, Diesel"
                    required
                  />
                </div>
                <div className="form-field">
                  <label htmlFor="rm-rate">Rate (Rs./L)</label>
                  <input
                    id="rm-rate"
                    type="number"
                    min="0"
                    step="any"
                    value={rate}
                    onChange={(e) => setRate(e.target.value)}
                    required
                  />
                </div>
                <div className="form-field">
                  <label htmlFor="rm-effective">Effective from</label>
                  <input
                    id="rm-effective"
                    type="date"
                    value={effectiveFrom}
                    onChange={(e) => setEffectiveFrom(e.target.value)}
                    required
                  />
                </div>

                {saveError && <div className="form-error">{saveError}</div>}
                {savedAt && <div className="section-note">Saved at {savedAt}.</div>}

                <div className="modal-actions">
                  <button type="submit" className="export-btn" disabled={saving}>
                    {saving ? 'Saving…' : 'Add rate'}
                  </button>
                </div>
              </form>
            ) : (
              <div className="section-note">
                Only Owner/Accountant can add rates (Section 2) — this view is read-only for your
                role.
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
