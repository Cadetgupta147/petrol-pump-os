import { useEffect, useState, type FormEvent } from 'react';
import { TopBar } from '../components/layout/TopBar';
import { NavBar } from '../components/layout/NavBar';
import { getCreditConfig, updateCreditConfig } from '../api/creditConfig';
import { ApiError } from '../api/client';
import { useAuth } from '../context/useAuth';
import type { CreditConfig, CreditEnforcementMode } from '../api/types';

// Section 3.4A — dealer-configurable credit limit enforcement policy:
// enforcementMode (NOTIFY/BLOCK) and the default credit limit auto-applied
// to quick-added (informal) customers. Unlike /loyalty-config, GET
// /credit-config never 404s (CreditConfigService.getOrCreate() is an
// upsert-on-read singleton) — there is no "not configured yet" empty state
// to render here.
//
// The edit form is only rendered for OWNER — but that's cosmetic; the real
// enforcement is @Roles(Role.OWNER) on both routes of
// CreditConfigController (Section 2: credit enforcement policy is
// business-settings policy, one of Accountant's carve-outs — narrowed from
// Owner/Accountant, same category as loyalty rates and bill delete).
export function CreditSettingsPage() {
  const { staff } = useAuth();
  const isOwner = staff?.role === 'OWNER';

  const [loaded, setLoaded] = useState(false);
  const [config, setConfig] = useState<CreditConfig | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [enforcementMode, setEnforcementMode] = useState<CreditEnforcementMode>('NOTIFY');
  const [defaultLimit, setDefaultLimit] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getCreditConfig()
      .then((result) => {
        if (cancelled) return;
        setConfig(result);
        setEnforcementMode(result.enforcementMode);
        setDefaultLimit(String(result.defaultInformalCreditLimit));
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
      const limit = Number(defaultLimit.trim());
      const saved = await updateCreditConfig({
        enforcementMode,
        defaultInformalCreditLimit: limit,
      });
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
          <h3>Credit settings</h3>
          <span className="section-note">
            informal credit limit + enforcement mode (Section 3.4A)
          </span>
        </div>

        {error && <div className="error-box">{error}</div>}
        {!error && !loaded && <div className="loading">Loading credit config…</div>}

        {!error && loaded && config && (
          <>
            <div className="section">
              <div className="grid grid-2">
                <div className="card">
                  <div className="card-label">ENFORCEMENT MODE</div>
                  <div className="card-value">
                    {config.enforcementMode === 'NOTIFY' ? 'Notify' : 'Block'}
                  </div>
                  <div className="card-sub">
                    {config.enforcementMode === 'NOTIFY'
                      ? 'Over-limit bills still go through; the dealer gets an immediate alert with a one-tap payment reminder option'
                      : 'Over-limit bills are rejected at the point of sale'}
                  </div>
                </div>
                <div className="card">
                  <div className="card-label">DEFAULT INFORMAL CREDIT LIMIT</div>
                  <div className="card-value">{config.defaultInformalCreditLimit}</div>
                  <div className="card-sub">
                    auto-applied to quick-added (informal) customers; editable per-customer once
                    verified
                  </div>
                </div>
              </div>
            </div>

            {isOwner ? (
              <form className="section" onSubmit={(e) => { void handleSubmit(e); }}>
                <div className="section-title">
                  <h3>Change credit config</h3>
                  <span className="section-note">Owner-only — enforced by the backend</span>
                </div>
                <div className="form-field">
                  <label htmlFor="cs-mode">Enforcement mode</label>
                  <select
                    id="cs-mode"
                    value={enforcementMode}
                    onChange={(e) => setEnforcementMode(e.target.value as CreditEnforcementMode)}
                  >
                    <option value="NOTIFY">Notify — bill goes through, dealer is alerted</option>
                    <option value="BLOCK">Block — bill is rejected over the limit</option>
                  </select>
                </div>
                <div className="form-field">
                  <label htmlFor="cs-limit">Default informal credit limit</label>
                  <input
                    id="cs-limit"
                    type="number"
                    min="0"
                    step="any"
                    value={defaultLimit}
                    onChange={(e) => setDefaultLimit(e.target.value)}
                    required
                  />
                </div>

                {saveError && <div className="form-error">{saveError}</div>}
                {savedAt && <div className="section-note">Saved at {savedAt}.</div>}

                <div className="modal-actions">
                  <button type="submit" className="export-btn" disabled={saving}>
                    {saving ? 'Saving…' : 'Save credit config'}
                  </button>
                </div>
              </form>
            ) : (
              <div className="section-note">
                Only the Owner can change credit enforcement policy (Section 2) — this view is
                read-only for your role.
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
