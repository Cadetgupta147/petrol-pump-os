import { useState, type FormEvent } from 'react';
import { createVehicleBlacklistEntry } from '../../api/vehicleBlacklist';
import { ApiError } from '../../api/client';
import type { BlacklistScope, VehicleBlacklistEntry } from '../../api/types';

interface VehicleBlacklistFormModalProps {
  onClose: () => void;
  onSaved: (entry: VehicleBlacklistEntry) => void;
}

// Section 3.4B — POST /vehicle-blacklist (create only; there is no edit —
// a blacklist entry is either active or resolved, see
// ResolveVehicleBlacklistModal for the other half). Owner-only server-side;
// CustomersPage/NavBar already hide the "+ Add entry" trigger for
// non-owners, same pattern as CreditSettingsPage's edit form.
export function VehicleBlacklistFormModal({ onClose, onSaved }: VehicleBlacklistFormModalProps) {
  const [scope, setScope] = useState<BlacklistScope>('VEHICLE');
  const [vehicleNumber, setVehicleNumber] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [reason, setReason] = useState('');
  const [outstandingAmount, setOutstandingAmount] = useState('');
  const [referencePhotoUrl, setReferencePhotoUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const trimmedOutstanding = outstandingAmount.trim();
      const saved = await createVehicleBlacklistEntry({
        scope,
        vehicleNumber: scope === 'VEHICLE' ? vehicleNumber.trim() : undefined,
        companyName: scope === 'COMPANY' ? companyName.trim() : undefined,
        customerId: customerId.trim() === '' ? undefined : customerId.trim(),
        reason: reason.trim(),
        outstandingAmount: trimmedOutstanding === '' ? undefined : Number(trimmedOutstanding),
        referencePhotoUrl: referencePhotoUrl.trim() === '' ? undefined : referencePhotoUrl.trim(),
      });
      onSaved(saved);
    } catch (err) {
      // Backend validation (scope/field pairing, duplicate-active guard) is
      // the real enforcement — surface whatever message it sends back.
      setError(err instanceof ApiError ? err.message : "Can't reach the backend.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <form
        className="modal-card"
        onClick={(event) => event.stopPropagation()}
        onSubmit={(e) => { void handleSubmit(e); }}
      >
        <div className="section-title">
          <h3>Blacklist a vehicle or company</h3>
          <span className="section-note">
            Blocks new CREDIT bills outright — cash/UPI/card are never affected (Section 3.4B)
          </span>
        </div>

        <div className="form-field">
          <label htmlFor="vb-scope">Scope</label>
          <select id="vb-scope" value={scope} onChange={(e) => setScope(e.target.value as BlacklistScope)}>
            <option value="VEHICLE">One vehicle</option>
            <option value="COMPANY">Entire company/fleet</option>
          </select>
        </div>

        {scope === 'VEHICLE' ? (
          <div className="form-field">
            <label htmlFor="vb-vehicle">Vehicle number</label>
            <input
              id="vb-vehicle"
              value={vehicleNumber}
              onChange={(e) => setVehicleNumber(e.target.value)}
              placeholder="MH12AB1234"
              autoCapitalize="characters"
              required
            />
          </div>
        ) : (
          <div className="form-field">
            <label htmlFor="vb-company">Company name</label>
            <input
              id="vb-company"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder="Sharma Transport Co."
              required
            />
          </div>
        )}

        <div className="form-field">
          <label htmlFor="vb-customer">Linked customer id (optional)</label>
          <input
            id="vb-customer"
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
            placeholder="Leave blank if there's no existing Customer record"
          />
        </div>

        <div className="form-field">
          <label htmlFor="vb-reason">Reason</label>
          <input
            id="vb-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Left ₹4,500 unpaid credit tab on 12 Jul"
            required
          />
        </div>

        <div className="form-field">
          <label htmlFor="vb-outstanding">Outstanding amount (Rs., optional)</label>
          <input
            id="vb-outstanding"
            type="number"
            min="0"
            step="any"
            value={outstandingAmount}
            onChange={(e) => setOutstandingAmount(e.target.value)}
            placeholder="0"
          />
        </div>

        <div className="form-field">
          <label htmlFor="vb-photo">Reference photo URL (optional)</label>
          <input
            id="vb-photo"
            value={referencePhotoUrl}
            onChange={(e) => setReferencePhotoUrl(e.target.value)}
            placeholder="For staff to manually compare at the pump — never automated matching"
          />
        </div>

        {error && <div className="form-error">{error}</div>}

        <div className="modal-actions">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button type="submit" className="export-btn" disabled={submitting}>
            {submitting ? 'Saving…' : 'Add to blacklist'}
          </button>
        </div>
      </form>
    </div>
  );
}
