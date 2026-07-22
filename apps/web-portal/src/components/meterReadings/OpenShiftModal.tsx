import { useState, type FormEvent } from 'react';
import { openShift } from '../../api/meterReadings';
import { ApiError } from '../../api/client';
import type { MeterReading, StaffListItem, StaffSummary, Tank } from '../../api/types';

interface OpenShiftModalProps {
  staff: StaffListItem[];
  tanks: Tank[];
  currentStaff: StaffSummary | null;
  onClose: () => void;
  onSaved: (reading: MeterReading) => void;
}

// Section 3.3/4 — manual opening-reading entry (fallback if the DSM app
// fails, or a back-office correction). Same POST /meter-readings the DSM
// app's own shift-start screen calls.
//
// Finding A1 (docs/production-readiness.md) — MeterReadingsService.
// openShift() now rejects (403) a DSM caller assigning the shift to a
// different staffId (resolveAssignableActorId()); a DSM can only open a
// shift for themselves, so the dropdown below is locked to self for that
// role instead of letting them pick someone else and hit an avoidable error.
export function OpenShiftModal({ staff, tanks, currentStaff, onClose, onSaved }: OpenShiftModalProps) {
  const isDsm = currentStaff?.role === 'DSM';
  const [nozzleId, setNozzleId] = useState('');
  const [staffId, setStaffId] = useState(isDsm ? currentStaff.id : '');
  const [openingReading, setOpeningReading] = useState('');
  const [productType, setProductType] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Distinct product types already configured as tanks (Section 7.1) — used
  // as a datalist so this free-text field still autocompletes toward a
  // value closeShift() can actually match against a Tank, without forcing a
  // hard-coded product list here.
  const knownProductTypes = Array.from(new Set(tanks.map((t) => t.productType)));

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const saved = await openShift({
        nozzleId: nozzleId.trim(),
        staffId,
        openingReading: Number(openingReading),
        productType: productType.trim(),
      });
      onSaved(saved);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Can't reach the backend.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <form className="modal-card" onClick={(event) => event.stopPropagation()} onSubmit={(e) => { void handleSubmit(e); }}>
        <div className="section-title">
          <h3>Open shift</h3>
        </div>

        <div className="form-field">
          <label htmlFor="os-nozzle">Nozzle</label>
          <input
            id="os-nozzle"
            value={nozzleId}
            onChange={(e) => setNozzleId(e.target.value)}
            placeholder="e.g. N1"
            required
          />
        </div>
        <div className="form-field">
          <label htmlFor="os-staff">DSM / staff</label>
          <select
            id="os-staff"
            value={staffId}
            onChange={(e) => setStaffId(e.target.value)}
            required
            disabled={isDsm}
          >
            <option value="" disabled>
              Select staff
            </option>
            {staff.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
              </option>
            ))}
          </select>
          {isDsm && <div className="card-sub">DSM staff can only open a shift for themselves.</div>}
        </div>
        <div className="form-field">
          <label htmlFor="os-product">Product type</label>
          <input
            id="os-product"
            list="os-product-types"
            value={productType}
            onChange={(e) => setProductType(e.target.value)}
            placeholder="e.g. Petrol"
            required
          />
          <datalist id="os-product-types">
            {knownProductTypes.map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
        </div>
        <div className="form-field">
          <label htmlFor="os-opening">Opening reading</label>
          <input
            id="os-opening"
            type="number"
            min="0"
            step="0.01"
            value={openingReading}
            onChange={(e) => setOpeningReading(e.target.value)}
            required
          />
        </div>

        {error && <div className="form-error">{error}</div>}

        <div className="modal-actions">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button type="submit" className="export-btn" disabled={submitting}>
            {submitting ? 'Opening…' : 'Open shift'}
          </button>
        </div>
      </form>
    </div>
  );
}
