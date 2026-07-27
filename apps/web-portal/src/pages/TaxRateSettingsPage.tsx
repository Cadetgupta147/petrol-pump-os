import { useEffect, useState, type FormEvent } from 'react';
import { TopBar } from '../components/layout/TopBar';
import { NavBar } from '../components/layout/NavBar';
import { getTaxRateConfigs, upsertTaxRateConfig } from '../api/taxRateConfig';
import { getItems } from '../api/items';
import { ApiError } from '../api/client';
import { useAuth } from '../context/useAuth';
import { formatDateTime } from '../utils/format';
import type { Item, TaxRateConfig } from '../api/types';

// Section 17.22 — dealer-configurable GST rate per product, closing the "no
// tax field at all" gap in the GST-ready sales/purchase register. A product
// with no row here is treated as untaxed in that report (e.g. fuel grades,
// left unconfigured on purpose — motor fuel is outside GST in India, state
// VAT applies instead and is still unmodeled). Same settings-editor shape
// as RateMasterPage/DensityRangeSettingsPage. Read is Owner/Accountant/
// Read-only; write (PUT) is Owner-only server-side — this form is only
// hidden client-side as a courtesy for non-Owner roles.
export function TaxRateSettingsPage() {
  const { staff } = useAuth();
  const canEdit = staff?.role === 'OWNER';

  const [configs, setConfigs] = useState<TaxRateConfig[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<Item[]>([]);

  const [productType, setProductType] = useState('');
  const [taxRatePercent, setTaxRatePercent] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  function load(): Promise<void> {
    return getTaxRateConfigs().then(setConfigs);
  }

  useEffect(() => {
    let cancelled = false;
    load().catch((err) => {
      if (!cancelled) {
        setError(err instanceof ApiError ? err.message : "Can't reach the backend.");
      }
    });
    getItems()
      .then((result) => {
        if (!cancelled) setItems(result);
      })
      .catch(() => undefined);
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
      await upsertTaxRateConfig({
        productType: productType.trim(),
        taxRatePercent: Number(taxRatePercent.trim()),
      });
      setProductType('');
      setTaxRatePercent('');
      setSavedAt(new Date().toLocaleTimeString());
      await load();
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : "Can't reach the backend.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <TopBar />
      <NavBar />
      <div className="content">
        <div className="section-title">
          <h3>GST / tax rate settings</h3>
          <span className="section-note">
            per-product tax rate for the sales/purchase register (Section 17.22)
          </span>
        </div>

        <div className="section">
          <div className="card">
            <div className="card-sub">
              A product with no configured rate below is treated as <strong>untaxed</strong> in the
              sales/purchase register — this is correct for fuel (MS/HSD), which is outside GST in
              India (state VAT applies instead, not modeled here). Only configure a rate for products
              that genuinely attract GST, e.g. lubricants. Check with an accountant before relying on
              this for filing.
            </div>
          </div>
        </div>

        {error && <div className="error-box">{error}</div>}
        {!error && !configs && <div className="loading">Loading tax rates…</div>}

        {!error && configs && (
          <>
            <div className="section">
              {configs.length === 0 ? (
                <div className="empty-box">
                  No tax rates configured yet — every product is treated as untaxed.
                </div>
              ) : (
                <div className="table-card">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Product</th>
                        <th className="num">Tax rate (%)</th>
                        <th>Last updated</th>
                      </tr>
                    </thead>
                    <tbody>
                      {configs.map((row) => (
                        <tr key={row.id}>
                          <td>{row.productType}</td>
                          <td className="num">{row.taxRatePercent}%</td>
                          <td>{formatDateTime(row.updatedAt)}</td>
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
                  <h3>Set rate</h3>
                  <span className="section-note">
                    Owner-only — enforced by the backend. Re-submitting an existing product updates it.
                  </span>
                </div>
                <div className="form-field">
                  <label htmlFor="trc-product">Product type</label>
                  <input
                    id="trc-product"
                    list="trc-item-master"
                    value={productType}
                    onChange={(e) => setProductType(e.target.value)}
                    placeholder="e.g. Lubricant, Urea"
                    required
                  />
                  <datalist id="trc-item-master">
                    {items.map((item) => (
                      <option key={item.id} value={item.name} />
                    ))}
                  </datalist>
                </div>
                <div className="form-field">
                  <label htmlFor="trc-rate">Tax rate (%)</label>
                  <input
                    id="trc-rate"
                    type="number"
                    min="0"
                    step="any"
                    value={taxRatePercent}
                    onChange={(e) => setTaxRatePercent(e.target.value)}
                    required
                  />
                </div>

                {saveError && <div className="form-error">{saveError}</div>}
                {savedAt && <div className="section-note">Saved at {savedAt}.</div>}

                <div className="modal-actions">
                  <button type="submit" className="export-btn" disabled={saving}>
                    {saving ? 'Saving…' : 'Save rate'}
                  </button>
                </div>
              </form>
            ) : (
              <div className="section-note">
                Only Owner can set tax rates (Section 2) — this view is read-only for your role.
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
