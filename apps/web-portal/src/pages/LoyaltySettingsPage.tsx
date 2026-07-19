import { useEffect, useState, type FormEvent } from 'react';
import { TopBar } from '../components/layout/TopBar';
import { NavBar } from '../components/layout/NavBar';
import { getLoyaltyConfig, upsertLoyaltyConfig } from '../api/loyalty';
import { ApiError } from '../api/client';
import { useAuth } from '../context/useAuth';
import type { EarningBasis, LoyaltyConfig } from '../api/types';

// Section 6.2 — the dealer-level loyalty earning config (basis + default
// rate). There are NO hardcoded defaults (open decision, Section 17): until
// the Owner saves a config here, GET /loyalty-config answers 404 (surfaced
// as null by api/loyalty.ts) and the backend refuses to calculate points at
// all.
//
// The edit form is only rendered for OWNER — but that's cosmetic; the real
// enforcement is @Roles(Role.OWNER) on PUT /loyalty-config (Section 2:
// "Accountant cannot change loyalty rates").
export function LoyaltySettingsPage() {
  const { staff } = useAuth();
  const isOwner = staff?.role === 'OWNER';

  const [loaded, setLoaded] = useState(false);
  const [config, setConfig] = useState<LoyaltyConfig | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [earningBasis, setEarningBasis] = useState<EarningBasis>('RUPEE');
  const [defaultRate, setDefaultRate] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getLoyaltyConfig()
      .then((result) => {
        if (cancelled) return;
        setConfig(result);
        if (result) {
          setEarningBasis(result.earningBasis);
          setDefaultRate(String(result.defaultRate));
        }
        setLoaded(true);
      })
      .catch((err) => {
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
      const rate = Number(defaultRate.trim());
      const saved = await upsertLoyaltyConfig({ earningBasis, defaultRate: rate });
      setConfig(saved);
      setSavedAt(new Date().toLocaleTimeString());
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
          <h3>Loyalty settings</h3>
          <span className="section-note">
            earning basis + default rate (Section 6.2) — the QR card itself never stores these
          </span>
        </div>

        {error && <div className="error-box">{error}</div>}
        {!error && !loaded && <div className="loading">Loading loyalty config…</div>}

        {!error && loaded && (
          <>
            {!config && (
              <div className="empty-box">
                Loyalty is not configured yet. Points cannot be calculated until the earning basis
                and default rate are set — there is deliberately no built-in default (open decision,
                master plan Section 17).
              </div>
            )}

            {config && (
              <div className="section">
                <div className="grid grid-2">
                  <div className="card">
                    <div className="card-label">EARNING BASIS</div>
                    <div className="card-value">
                      {config.earningBasis === 'RUPEE' ? 'Rupee-based' : 'Litre-based'}
                    </div>
                    <div className="card-sub">
                      {config.earningBasis === 'RUPEE'
                        ? 'points = (bill amount / 100) × rate'
                        : 'points = litres × rate'}
                    </div>
                  </div>
                  <div className="card">
                    <div className="card-label">DEFAULT RATE</div>
                    <div className="card-value">{config.defaultRate}</div>
                    <div className="card-sub">
                      per-customer overrides (set on a customer&apos;s page) take precedence
                    </div>
                  </div>
                </div>
              </div>
            )}

            {isOwner ? (
              <form className="section" onSubmit={(e) => { void handleSubmit(e); }}>
                <div className="section-title">
                  <h3>{config ? 'Change earning config' : 'Set earning config'}</h3>
                  <span className="section-note">Owner-only — enforced by the backend</span>
                </div>
                <div className="form-field">
                  <label htmlFor="ls-basis">Earning basis</label>
                  <select
                    id="ls-basis"
                    value={earningBasis}
                    onChange={(e) => setEarningBasis(e.target.value as EarningBasis)}
                  >
                    <option value="RUPEE">Rupee-based — points = (bill amount / 100) × rate</option>
                    <option value="LITRE">Litre-based — points = litres × rate</option>
                  </select>
                </div>
                <div className="form-field">
                  <label htmlFor="ls-rate">Default rate</label>
                  <input
                    id="ls-rate"
                    type="number"
                    min="0"
                    step="any"
                    value={defaultRate}
                    onChange={(e) => setDefaultRate(e.target.value)}
                    required
                  />
                </div>

                {saveError && <div className="form-error">{saveError}</div>}
                {savedAt && <div className="section-note">Saved at {savedAt}.</div>}

                <div className="modal-actions">
                  <button type="submit" className="export-btn" disabled={saving}>
                    {saving ? 'Saving…' : 'Save loyalty config'}
                  </button>
                </div>
              </form>
            ) : (
              <div className="section-note">
                Only the Owner can change loyalty rates (Section 2) — this view is read-only for
                your role.
              </div>
            )}

            <div className="section-note">
              Redemption settings (cash/gift/both, ratio, minimum points — Section 6.4) are a later
              slice; the launch redemption policy is still an open decision (Section 17).
            </div>
          </>
        )}
      </div>
    </>
  );
}
