import { useEffect, useState, type FormEvent } from 'react';
import { TopBar } from '../components/layout/TopBar';
import { NavBar } from '../components/layout/NavBar';
import { getDensityRangeConfigs, upsertDensityRangeConfig } from '../api/densityRangeConfig';
import { getItems } from '../api/items';
import { ApiError } from '../api/client';
import { useAuth } from '../context/useAuth';
import { formatDateTime } from '../utils/format';
import type { DensityRangeConfig, Item } from '../api/types';

// Section 17.19 — dealer-configurable acceptable density range per product,
// replacing the backend's hardcoded placeholder (DEFAULT_DENSITY_RANGE_BY_PRODUCT
// in density-logs.service.ts) with real, pump-specific numbers an Owner
// enters (ideally sourced from their OMC's quoted range). A product with no
// row here just keeps using the built-in placeholder — this page is purely
// additive, it can't "unset" the default. Same settings-editor shape as
// RateMasterPage/CreditSettingsPage. Read is Owner/Accountant; write
// (PUT) is Owner-only server-side (DensityRangeConfigController) — this
// form is only hidden client-side as a courtesy for non-Owner roles.
export function DensityRangeSettingsPage() {
  const { staff } = useAuth();
  const canEdit = staff?.role === 'OWNER';

  const [configs, setConfigs] = useState<DensityRangeConfig[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<Item[]>([]);

  const [productType, setProductType] = useState('');
  const [minDensity, setMinDensity] = useState('');
  const [maxDensity, setMaxDensity] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  function load(): Promise<void> {
    return getDensityRangeConfigs().then(setConfigs);
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
      await upsertDensityRangeConfig({
        productType: productType.trim(),
        minDensity: Number(minDensity.trim()),
        maxDensity: Number(maxDensity.trim()),
      });
      setProductType('');
      setMinDensity('');
      setMaxDensity('');
      setSavedAt(new Date().toLocaleTimeString());
      await load();
    } catch (err) {
      // Covers the 400 minDensity >= maxDensity check, surfaced verbatim
      // (DensityRangeConfigService.upsert()).
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
          <h3>Density/quality thresholds</h3>
          <span className="section-note">
            per-product acceptable density range for out-of-range flagging (Section 17.19)
          </span>
        </div>

        <div className="section">
          <div className="card">
            <div className="card-sub">
              A product with no configured range below still uses the built-in placeholder bands
              (petrol 0.72&ndash;0.775 g/mL, diesel 0.82&ndash;0.87 g/mL). Enter your OMC&rsquo;s
              actual quoted range here to replace it for that product.
            </div>
          </div>
        </div>

        {error && <div className="error-box">{error}</div>}
        {!error && !configs && <div className="loading">Loading density thresholds…</div>}

        {!error && configs && (
          <>
            <div className="section">
              {configs.length === 0 ? (
                <div className="empty-box">
                  No dealer-configured ranges yet — every product is using the built-in placeholder.
                </div>
              ) : (
                <div className="table-card">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Product</th>
                        <th className="num">Min density (g/mL)</th>
                        <th className="num">Max density (g/mL)</th>
                        <th>Last updated</th>
                      </tr>
                    </thead>
                    <tbody>
                      {configs.map((row) => (
                        <tr key={row.id}>
                          <td>{row.productType}</td>
                          <td className="num">{row.minDensity.toFixed(3)}</td>
                          <td className="num">{row.maxDensity.toFixed(3)}</td>
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
                  <h3>Set range</h3>
                  <span className="section-note">
                    Owner-only — enforced by the backend. Re-submitting an existing product updates it.
                  </span>
                </div>
                <div className="form-field">
                  <label htmlFor="drc-product">Product type</label>
                  <input
                    id="drc-product"
                    list="drc-item-master"
                    value={productType}
                    onChange={(e) => setProductType(e.target.value)}
                    placeholder="e.g. Petrol, Diesel"
                    required
                  />
                  <datalist id="drc-item-master">
                    {items.map((item) => (
                      <option key={item.id} value={item.name} />
                    ))}
                  </datalist>
                </div>
                <div className="form-field">
                  <label htmlFor="drc-min">Min density (g/mL)</label>
                  <input
                    id="drc-min"
                    type="number"
                    min="0"
                    step="any"
                    value={minDensity}
                    onChange={(e) => setMinDensity(e.target.value)}
                    required
                  />
                </div>
                <div className="form-field">
                  <label htmlFor="drc-max">Max density (g/mL)</label>
                  <input
                    id="drc-max"
                    type="number"
                    min="0"
                    step="any"
                    value={maxDensity}
                    onChange={(e) => setMaxDensity(e.target.value)}
                    required
                  />
                </div>

                {saveError && <div className="form-error">{saveError}</div>}
                {savedAt && <div className="section-note">Saved at {savedAt}.</div>}

                <div className="modal-actions">
                  <button type="submit" className="export-btn" disabled={saving}>
                    {saving ? 'Saving…' : 'Save range'}
                  </button>
                </div>
              </form>
            ) : (
              <div className="section-note">
                Only Owner can set density thresholds (Section 2) — this view is read-only for your
                role.
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
