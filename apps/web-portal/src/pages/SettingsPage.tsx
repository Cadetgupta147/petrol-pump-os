import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { TopBar } from '../components/layout/TopBar';
import { NavBar } from '../components/layout/NavBar';
import {
  getBusinessProfile,
  updateBusinessProfile,
  uploadBusinessLogo,
  uploadBusinessLetterhead,
} from '../api/businessProfile';
import { downloadTallyExport } from '../api/tallyExport';
import { ApiError } from '../api/client';
import { useAuth } from '../context/useAuth';
import { todayIsoDate } from '../utils/format';
import { ItemSettings } from '../components/settings/ItemSettings';
import { LubricantStockSettings } from '../components/settings/LubricantStockSettings';
import { TankSettings } from '../components/settings/TankSettings';
import { NozzleSettings } from '../components/settings/NozzleSettings';
import { ShiftScheduleSettings } from '../components/settings/ShiftScheduleSettings';
import type { BusinessProfile, OmcBrand } from '../api/types';

const OMC_OPTIONS: { value: OmcBrand; label: string }[] = [
  { value: 'NONE', label: 'None / independent' },
  { value: 'IOCL', label: 'Indian Oil (IOCL)' },
  { value: 'BPCL', label: 'Bharat Petroleum (BPCL)' },
  { value: 'HPCL', label: 'Hindustan Petroleum (HPCL)' },
  { value: 'OTHER', label: 'Other' },
];

const ROLE_REFERENCE: { role: string; canDo: string; cannotDo: string }[] = [
  { role: 'Owner', canDo: 'Everything — settings, loyalty/gift config, staff, all reports, all edits', cannotDo: 'Nothing restricted' },
  { role: 'Accountant', canDo: 'Full manual bill/meter entry, credit ledger, cash reconciliation, view all reports, export to Tally', cannotDo: 'Change loyalty rates, edit staff PINs, change business settings, delete bills, change credit enforcement policy' },
  { role: 'Manager', canDo: 'Day-to-day ops: bills, meter readings, staff attendance, cash handover entry', cannotDo: 'View full P&L, change settings or loyalty config' },
  { role: 'DSM / Cashier', canDo: 'DSM app only: their own shift’s bills, meter readings, cash handover', cannotDo: 'No web portal access at all' },
  { role: 'Read-only', canDo: 'View dashboards and reports only', cannotDo: 'Edit or enter anything' },
];

// Section 3.9 — Settings. Every sub-section here is either genuinely built
// against a real backend, or explicitly labeled as not built (never a fake
// toggle/button standing in for something that doesn't work) — see the
// Notifications and Backup/export sections below.
export function SettingsPage() {
  const { staff } = useAuth();
  const isOwner = staff?.role === 'OWNER';
  const canManageNozzles = staff?.role === 'OWNER' || staff?.role === 'ACCOUNTANT';
  const canManageTanks = staff?.role === 'OWNER' || staff?.role === 'ACCOUNTANT';
  const canManageItems =
    staff?.role === 'OWNER' || staff?.role === 'ACCOUNTANT' || staff?.role === 'MANAGER';

  const [profile, setProfile] = useState<BusinessProfile | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [businessName, setBusinessName] = useState('');
  const [gstin, setGstin] = useState('');
  const [pumpLicenseNo, setPumpLicenseNo] = useState('');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [omcBrand, setOmcBrand] = useState<OmcBrand>('NONE');
  const [useUploadedLetterhead, setUseUploadedLetterhead] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileSaveError, setProfileSaveError] = useState<string | null>(null);
  const [profileSavedAt, setProfileSavedAt] = useState<string | null>(null);

  // Section 5B.2 — logo/letterhead upload. Separate from the text-field
  // save above since these hit their own POST endpoints (multipart, not
  // PATCH JSON) and succeed/fail independently.
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [logoError, setLogoError] = useState<string | null>(null);
  const [uploadingLetterhead, setUploadingLetterhead] = useState(false);
  const [letterheadError, setLetterheadError] = useState<string | null>(null);

  const [exportFrom, setExportFrom] = useState(todayIsoDate());
  const [exportTo, setExportTo] = useState(todayIsoDate());
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  // TanksPage's first-time-user empty state links here as
  // `/settings#tank-master` (Section 7.1) — React Router doesn't auto-scroll
  // to a hash on client-side navigation the way a real page load would, so
  // this does it manually once the section it's targeting has rendered.
  useEffect(() => {
    if (!window.location.hash) return;
    const target = document.getElementById(window.location.hash.slice(1));
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  useEffect(() => {
    let cancelled = false;
    getBusinessProfile()
      .then((result) => {
        if (cancelled) return;
        setProfile(result);
        setBusinessName(result.businessName ?? '');
        setGstin(result.gstin ?? '');
        setPumpLicenseNo(result.pumpLicenseNo ?? '');
        setAddress(result.address ?? '');
        setPhone(result.phone ?? '');
        setOmcBrand(result.omcBrand);
        setUseUploadedLetterhead(result.useUploadedLetterhead);
      })
      .catch((err) => {
        if (!cancelled) {
          setProfileError(err instanceof ApiError ? err.message : "Can't reach the backend.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSaveProfile(event: FormEvent) {
    event.preventDefault();
    setProfileSaveError(null);
    setProfileSavedAt(null);
    setSavingProfile(true);
    try {
      const saved = await updateBusinessProfile({
        businessName: businessName.trim(),
        gstin: gstin.trim(),
        pumpLicenseNo: pumpLicenseNo.trim(),
        address: address.trim(),
        phone: phone.trim(),
        omcBrand,
        useUploadedLetterhead,
      });
      setProfile(saved);
      setProfileSavedAt(new Date().toLocaleTimeString());
    } catch (err) {
      setProfileSaveError(err instanceof ApiError ? err.message : "Can't reach the backend.");
    } finally {
      setSavingProfile(false);
    }
  }

  async function handleLogoUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = ''; // allow re-selecting the same file next time
    if (!file) return;
    setLogoError(null);
    setUploadingLogo(true);
    try {
      const saved = await uploadBusinessLogo(file);
      setProfile(saved);
    } catch (err) {
      setLogoError(err instanceof ApiError ? err.message : "Can't reach the backend.");
    } finally {
      setUploadingLogo(false);
    }
  }

  async function handleLetterheadUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setLetterheadError(null);
    setUploadingLetterhead(true);
    try {
      const saved = await uploadBusinessLetterhead(file);
      setProfile(saved);
    } catch (err) {
      setLetterheadError(err instanceof ApiError ? err.message : "Can't reach the backend.");
    } finally {
      setUploadingLetterhead(false);
    }
  }

  async function handleExport(event: FormEvent) {
    event.preventDefault();
    setExportError(null);
    setExporting(true);
    try {
      await downloadTallyExport(exportFrom, exportTo);
    } catch (err) {
      setExportError(err instanceof ApiError ? err.message : 'Export failed.');
    } finally {
      setExporting(false);
    }
  }

  return (
    <>
      <TopBar />
      <NavBar />
      <div className="content">
        <div className="section-title">
          <h3>Settings</h3>
          <span className="section-note">Section 3.9</span>
        </div>

        <div className="section">
          <div className="section-title">
            <h3>Business profile</h3>
            <span className="section-note">Business name, GSTIN, pump license — shown on exports and reports where relevant.</span>
          </div>

          {profileError && <div className="error-box">{profileError}</div>}
          {!profileError && !profile && <div className="loading">Loading business profile…</div>}

          {!profileError && profile && (
            isOwner ? (
              <form onSubmit={(e) => { void handleSaveProfile(e); }}>
                <div className="grid grid-2" style={{ gap: 12 }}>
                  <div className="form-field">
                    <label htmlFor="bp-name">Business name</label>
                    <input id="bp-name" value={businessName} onChange={(e) => setBusinessName(e.target.value)} />
                  </div>
                  <div className="form-field">
                    <label htmlFor="bp-gstin">GSTIN</label>
                    <input id="bp-gstin" value={gstin} onChange={(e) => setGstin(e.target.value)} />
                  </div>
                  <div className="form-field">
                    <label htmlFor="bp-license">Pump license number</label>
                    <input id="bp-license" value={pumpLicenseNo} onChange={(e) => setPumpLicenseNo(e.target.value)} />
                  </div>
                  <div className="form-field">
                    <label htmlFor="bp-address">Address</label>
                    <input id="bp-address" value={address} onChange={(e) => setAddress(e.target.value)} />
                  </div>
                  <div className="form-field">
                    <label htmlFor="bp-phone">Phone</label>
                    <input id="bp-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
                  </div>
                  <div className="form-field">
                    <label htmlFor="bp-omc">OMC affiliation</label>
                    <select id="bp-omc" value={omcBrand} onChange={(e) => setOmcBrand(e.target.value as OmcBrand)}>
                      {OMC_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {profileSaveError && <div className="form-error">{profileSaveError}</div>}
                {profileSavedAt && <div className="section-note">Saved at {profileSavedAt}.</div>}

                <div className="modal-actions">
                  <button type="submit" className="export-btn" disabled={savingProfile}>
                    {savingProfile ? 'Saving…' : 'Save business profile'}
                  </button>
                </div>
              </form>
            ) : (
              <div className="grid grid-2">
                <div className="card">
                  <div className="card-label">BUSINESS NAME</div>
                  <div className="card-value" style={{ fontSize: 16 }}>{profile.businessName ?? '—'}</div>
                </div>
                <div className="card">
                  <div className="card-label">GSTIN</div>
                  <div className="card-value" style={{ fontSize: 16 }}>{profile.gstin ?? '—'}</div>
                </div>
                <div className="card">
                  <div className="card-label">PUMP LICENSE NO.</div>
                  <div className="card-value" style={{ fontSize: 16 }}>{profile.pumpLicenseNo ?? '—'}</div>
                </div>
                <div className="card">
                  <div className="card-label">ADDRESS</div>
                  <div className="card-value" style={{ fontSize: 16 }}>{profile.address ?? '—'}</div>
                </div>
                <div className="section-note">Only the Owner can edit the business profile — this view is read-only for your role.</div>
              </div>
            )
          )}
        </div>

        {!profileError && profile && (
          <div className="section">
            <div className="section-title">
              <h3>Credit statement letterhead</h3>
              <span className="section-note">
                Section 5B — used when printing a credit customer&rsquo;s outstanding statement.
              </span>
            </div>
            <div className="grid grid-2">
              <div className="card">
                <div className="card-label">LOGO</div>
                {profile.logoImageData ? (
                  <img
                    src={profile.logoImageData}
                    alt="Business logo"
                    style={{ width: 64, height: 64, objectFit: 'contain', marginBottom: 8, display: 'block' }}
                  />
                ) : (
                  <div className="card-sub" style={{ marginBottom: 8 }}>No logo uploaded yet.</div>
                )}
                {isOwner && (
                  <>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => { void handleLogoUpload(e); }}
                      disabled={uploadingLogo}
                    />
                    {uploadingLogo && <div className="section-note">Uploading…</div>}
                    {logoError && <div className="form-error">{logoError}</div>}
                    <div className="section-note" style={{ marginTop: 6 }}>
                      Upload your business logo, or — if you&rsquo;re an authorized OMC dealer — your OMC&rsquo;s
                      own logo. This software never bundles BPCL/IOCL/HPCL artwork itself (§17.26).
                    </div>
                  </>
                )}
              </div>
              <div className="card">
                <div className="card-label">CUSTOM LETTERHEAD</div>
                {profile.letterheadImageData ? (
                  <img
                    src={profile.letterheadImageData}
                    alt="Custom letterhead"
                    style={{ width: '100%', maxHeight: 100, objectFit: 'contain', marginBottom: 8, display: 'block' }}
                  />
                ) : (
                  <div className="card-sub" style={{ marginBottom: 8 }}>No custom letterhead uploaded yet.</div>
                )}
                {isOwner && (
                  <>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => { void handleLetterheadUpload(e); }}
                      disabled={uploadingLetterhead}
                    />
                    {uploadingLetterhead && <div className="section-note">Uploading…</div>}
                    {letterheadError && <div className="form-error">{letterheadError}</div>}
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8 }}>
                      <input
                        type="checkbox"
                        checked={useUploadedLetterhead}
                        onChange={(e) => setUseUploadedLetterhead(e.target.checked)}
                      />
                      Print statements on this letterhead instead of the generated header
                      {useUploadedLetterhead !== profile.useUploadedLetterhead && ' (save business profile above to apply)'}
                    </label>
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        <ItemSettings canManage={canManageItems} />

        <LubricantStockSettings canManage={canManageItems} />

        <TankSettings canManage={canManageTanks} />

        <NozzleSettings canManage={canManageNozzles} />

        <ShiftScheduleSettings canManage={canManageNozzles} />

        <div className="section">
          <div className="section-title">
            <h3>User roles &amp; permissions</h3>
            <span className="section-note">Section 2 — reference only. To assign a role to a specific person, see Staff.</span>
          </div>
          <div className="table-card">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Role</th>
                  <th>Can do</th>
                  <th>Cannot do</th>
                </tr>
              </thead>
              <tbody>
                {ROLE_REFERENCE.map((r) => (
                  <tr key={r.role}>
                    <td style={{ fontWeight: 700 }}>{r.role}</td>
                    <td>{r.canDo}</td>
                    <td>{r.cannotDo}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="footnote">
            Permissions are enforced in the backend's route guards, not a database-editable config
            table — adjusting who-can-do-what for a role requires a code change, not a setting here.
          </div>
        </div>

        <div className="section">
          <div className="section-title">
            <h3>Tally export</h3>
            <span className="section-note">Section 10 — export Sales/Purchase/Payment vouchers as a Tally-importable XML file for a chosen date range.</span>
          </div>
          <form onSubmit={(e) => { void handleExport(e); }}>
            <div className="grid grid-2" style={{ gap: 12 }}>
              <div className="form-field" style={{ marginBottom: 0 }}>
                <label htmlFor="te-from">From</label>
                <input id="te-from" type="date" value={exportFrom} onChange={(e) => setExportFrom(e.target.value)} required />
              </div>
              <div className="form-field" style={{ marginBottom: 0 }}>
                <label htmlFor="te-to">To</label>
                <input id="te-to" type="date" value={exportTo} onChange={(e) => setExportTo(e.target.value)} required />
              </div>
            </div>
            {exportError && <div className="form-error">{exportError}</div>}
            <div className="modal-actions">
              <button type="submit" className="export-btn" disabled={exporting}>
                {exporting ? 'Exporting…' : 'Export to Tally ↓'}
              </button>
            </div>
          </form>
        </div>

        <div className="section">
          <div className="section-title">
            <h3>Notifications</h3>
            <span className="section-note">Section 11 — push / SMS / WhatsApp toggles</span>
          </div>
          <div className="banner">
            Not built. No push (FCM), SMS, or WhatsApp sending is wired up anywhere in this codebase
            yet, and the WhatsApp Business API provider is still an open decision
            (docs/master-plan.md §17.8). Toggles here would control channels that don't send
            anything — flagged instead of built as inert UI.
          </div>
        </div>

        <div className="section">
          <div className="section-title">
            <h3>Backup / export data</h3>
          </div>
          <div className="banner">
            Not built. No backup/export-data endpoint exists in the backend yet — flagged instead of
            a button that wouldn't do anything.
          </div>
        </div>
      </div>
    </>
  );
}
