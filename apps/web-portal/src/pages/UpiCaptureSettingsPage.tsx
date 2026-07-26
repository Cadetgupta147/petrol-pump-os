import { useEffect, useState, type FormEvent } from 'react';
import { TopBar } from '../components/layout/TopBar';
import { NavBar } from '../components/layout/NavBar';
import { getUpiCaptureConfig, updateUpiCaptureConfig } from '../api/upiCaptureConfig';
import { ApiError } from '../api/client';
import { useAuth } from '../context/useAuth';
import type { UpiCaptureConfig, UpiMerchantProvider } from '../api/types';

// Section 8A.3 — dealer-configurable UPI auto-capture: whether this pump's
// walkInUpiCollected is filled by the PhonePe/Paytm webhook or entered
// manually by the DSM at shift end (see ShiftSalesSummaryScreen on the DSM
// app). Same singleton-upsert-on-read pattern as /credit-config — GET never
// 404s, so there's no "not configured yet" empty state to render.
//
// Credential fields are write-only: the GET response only ever tells you
// whether phonePeWebhookUsername/Password/paytmMerchantKey are SET, never
// their value (UpiCaptureConfigService.toSafeView()) — so this form's
// inputs start blank even when a credential already exists, and an empty
// input on submit means "leave it unchanged", not "clear it".
export function UpiCaptureSettingsPage() {
  const { staff } = useAuth();
  const isOwner = staff?.role === 'OWNER';

  const [loaded, setLoaded] = useState(false);
  const [config, setConfig] = useState<UpiCaptureConfig | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [autoCaptureEnabled, setAutoCaptureEnabled] = useState(false);
  const [provider, setProvider] = useState<UpiMerchantProvider>('PHONEPE');
  const [phonePeWebhookUsername, setPhonePeWebhookUsername] = useState('');
  const [phonePeWebhookPassword, setPhonePeWebhookPassword] = useState('');
  const [paytmMerchantKey, setPaytmMerchantKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getUpiCaptureConfig()
      .then((result) => {
        if (cancelled) return;
        setConfig(result);
        setAutoCaptureEnabled(result.autoCaptureEnabled);
        setProvider(result.provider ?? 'PHONEPE');
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
      const saved = await updateUpiCaptureConfig({
        autoCaptureEnabled,
        provider,
        // Blank input == "leave unchanged" — never send an empty string,
        // which would otherwise overwrite a real credential with nothing.
        ...(phonePeWebhookUsername.trim() && { phonePeWebhookUsername: phonePeWebhookUsername.trim() }),
        ...(phonePeWebhookPassword.trim() && { phonePeWebhookPassword: phonePeWebhookPassword.trim() }),
        ...(paytmMerchantKey.trim() && { paytmMerchantKey: paytmMerchantKey.trim() }),
      });
      setConfig(saved);
      setPhonePeWebhookUsername('');
      setPhonePeWebhookPassword('');
      setPaytmMerchantKey('');
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
          <h3>UPI capture settings</h3>
          <span className="section-note">
            automated vs. manual walk-in UPI collection (Section 8A.3)
          </span>
        </div>

        {error && <div className="error-box">{error}</div>}
        {!error && !loaded && <div className="loading">Loading UPI capture config…</div>}

        {!error && loaded && config && (
          <>
            <div className="section">
              <div className="grid grid-2">
                <div className="card">
                  <div className="card-label">AUTO-CAPTURE</div>
                  <div className="card-value">{config.autoCaptureEnabled ? 'On' : 'Off'}</div>
                  <div className="card-sub">
                    {config.autoCaptureEnabled
                      ? 'UPI is filled from the merchant webhook — DSMs cannot enter it manually'
                      : 'UPI is entered manually by the DSM at shift end, same as cash/card'}
                  </div>
                </div>
                <div className="card">
                  <div className="card-label">PROVIDER</div>
                  <div className="card-value">{config.provider ?? '—'}</div>
                  <div className="card-sub">
                    {config.provider === 'PHONEPE' &&
                      `Webhook username: ${config.phonePeWebhookUsernameSet ? 'set' : 'not set'}, password: ${config.phonePeWebhookPasswordSet ? 'set' : 'not set'}`}
                    {config.provider === 'PAYTM' &&
                      `Merchant key: ${config.paytmMerchantKeySet ? 'set' : 'not set'}`}
                    {!config.provider && 'No provider selected yet'}
                  </div>
                </div>
              </div>
            </div>

            {isOwner ? (
              <form className="section" onSubmit={(e) => { void handleSubmit(e); }}>
                <div className="section-title">
                  <h3>Change UPI capture config</h3>
                  <span className="section-note">Owner-only — enforced by the backend</span>
                </div>

                <div className="form-field">
                  <label htmlFor="upi-auto-capture">
                    <input
                      id="upi-auto-capture"
                      type="checkbox"
                      checked={autoCaptureEnabled}
                      onChange={(e) => setAutoCaptureEnabled(e.target.checked)}
                    />{' '}
                    Enable webhook auto-capture
                  </label>
                  <span className="section-note">
                    Requires the provider credentials below to already be set (this request or a
                    prior one) — the backend rejects turning this on otherwise.
                  </span>
                </div>

                <div className="form-field">
                  <label htmlFor="upi-provider">Provider</label>
                  <select
                    id="upi-provider"
                    value={provider}
                    onChange={(e) => setProvider(e.target.value as UpiMerchantProvider)}
                  >
                    <option value="PHONEPE">PhonePe Business</option>
                    <option value="PAYTM">Paytm Business</option>
                  </select>
                </div>

                {provider === 'PHONEPE' && (
                  <>
                    <div className="form-field">
                      <label htmlFor="upi-phonepe-username">
                        PhonePe webhook username{' '}
                        {config.phonePeWebhookUsernameSet && (
                          <span className="section-note">(already set — leave blank to keep it)</span>
                        )}
                      </label>
                      <input
                        id="upi-phonepe-username"
                        type="text"
                        value={phonePeWebhookUsername}
                        onChange={(e) => setPhonePeWebhookUsername(e.target.value)}
                        placeholder={config.phonePeWebhookUsernameSet ? '••••••••' : ''}
                        autoComplete="off"
                      />
                    </div>
                    <div className="form-field">
                      <label htmlFor="upi-phonepe-password">
                        PhonePe webhook password{' '}
                        {config.phonePeWebhookPasswordSet && (
                          <span className="section-note">(already set — leave blank to keep it)</span>
                        )}
                      </label>
                      <input
                        id="upi-phonepe-password"
                        type="password"
                        value={phonePeWebhookPassword}
                        onChange={(e) => setPhonePeWebhookPassword(e.target.value)}
                        placeholder={config.phonePeWebhookPasswordSet ? '••••••••' : ''}
                        autoComplete="off"
                      />
                    </div>
                  </>
                )}

                {provider === 'PAYTM' && (
                  <div className="form-field">
                    <label htmlFor="upi-paytm-key">
                      Paytm merchant key (exactly 16 characters){' '}
                      {config.paytmMerchantKeySet && (
                        <span className="section-note">(already set — leave blank to keep it)</span>
                      )}
                    </label>
                    <input
                      id="upi-paytm-key"
                      type="password"
                      value={paytmMerchantKey}
                      onChange={(e) => setPaytmMerchantKey(e.target.value)}
                      placeholder={config.paytmMerchantKeySet ? '••••••••' : ''}
                      autoComplete="off"
                      maxLength={16}
                    />
                  </div>
                )}

                {saveError && <div className="form-error">{saveError}</div>}
                {savedAt && <div className="section-note">Saved at {savedAt}.</div>}

                <div className="modal-actions">
                  <button type="submit" className="export-btn" disabled={saving}>
                    {saving ? 'Saving…' : 'Save UPI capture config'}
                  </button>
                </div>
              </form>
            ) : (
              <div className="section-note">
                Only the Owner can change UPI capture settings (Section 2) — this view is read-only
                for your role.
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
