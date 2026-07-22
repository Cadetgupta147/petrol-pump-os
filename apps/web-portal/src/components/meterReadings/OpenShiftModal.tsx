import { useMemo, useState, type FormEvent } from 'react';
import { openShift } from '../../api/meterReadings';
import { ApiError } from '../../api/client';
import type { MeterReading, Nozzle, StaffListItem, StaffSummary } from '../../api/types';

interface OpenShiftModalProps {
  staff: StaffListItem[];
  nozzles: Nozzle[];
  currentStaff: StaffSummary | null;
  onClose: () => void;
  onSaved: (reading: MeterReading) => void;
}

// Section 3.3/4 — manual opening-reading entry (fallback if the DSM app
// fails, or a back-office correction). Same POST /meter-readings the DSM
// app's own shift-start screen calls.
//
// Nozzle is now a real dropdown over the Nozzle master (GET /nozzles) —
// never a free-typed id. Opening reading and product type are NOT form
// fields at all: both are server-derived (the carry-forward rule). This
// modal shows the selected nozzle's `nextOpeningReading` as a read-only
// preview so whoever's opening the shift can see what it will be, without
// being able to change it.
//
// Finding A1 (docs/production-readiness.md) — MeterReadingsService.
// openShift() rejects (403) a DSM caller assigning the shift to a different
// staffId (resolveAssignableActorId()); a DSM can only open a shift for
// themselves, so the dropdown below is locked to self for that role instead
// of letting them pick someone else and hit an avoidable error.
export function OpenShiftModal({ staff, nozzles, currentStaff, onClose, onSaved }: OpenShiftModalProps) {
  const isDsm = currentStaff?.role === 'DSM';
  const [nozzleId, setNozzleId] = useState('');
  const [staffId, setStaffId] = useState(isDsm ? currentStaff.id : '');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const selectedNozzle = useMemo(
    () => nozzles.find((n) => n.id === nozzleId) ?? null,
    [nozzles, nozzleId],
  );

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const saved = await openShift({ nozzleId, staffId });
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

        {nozzles.length === 0 ? (
          <div className="banner">
            No nozzles are configured yet — add at least one under Settings &rarr; Nozzle / meter
            configuration before opening a shift.
          </div>
        ) : (
          <>
            <div className="form-field">
              <label htmlFor="os-nozzle">Nozzle</label>
              <select id="os-nozzle" value={nozzleId} onChange={(e) => setNozzleId(e.target.value)} required>
                <option value="" disabled>
                  Select nozzle
                </option>
                {nozzles.map((nozzle) => (
                  <option key={nozzle.id} value={nozzle.id}>
                    {nozzle.label} &middot; {nozzle.productType}
                  </option>
                ))}
              </select>
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

            {selectedNozzle && (
              <div className="card" style={{ marginBottom: 16 }}>
                <div className="card-label">OPENING READING (carried forward — not editable)</div>
                <div className="card-value" style={{ fontSize: 20 }}>
                  {selectedNozzle.nextOpeningReading.toFixed(1)}
                </div>
                <div className="card-sub">
                  Product: {selectedNozzle.productType}. This is the previous shift's closing reading
                  (or this nozzle's configured starting reading if it's never had a shift).
                </div>
              </div>
            )}
          </>
        )}

        {error && <div className="form-error">{error}</div>}

        <div className="modal-actions">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button type="submit" className="export-btn" disabled={submitting || !nozzleId || nozzles.length === 0}>
            {submitting ? 'Opening…' : 'Open shift'}
          </button>
        </div>
      </form>
    </div>
  );
}
