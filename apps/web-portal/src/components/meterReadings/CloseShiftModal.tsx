import { useState, type FormEvent } from 'react';
import { closeShift } from '../../api/meterReadings';
import { ApiError } from '../../api/client';
import { formatTime } from '../../utils/format';
import type { MeterReading, StaffSummary } from '../../api/types';

interface CloseShiftModalProps {
  reading: MeterReading;
  currentStaff: StaffSummary | null;
  onClose: () => void;
  onSaved: (reading: MeterReading) => void;
}

// Section 3.3/4 — manual closing-reading entry. Litres sold is
// auto-calculated server-side (closing - opening, or rollover-aware if
// meterRolledOver is set — see below), same as the DSM app's own shift-end
// screen.
//
// meterRolledOver is only offered when this nozzle has a configured
// rolloverAt (older mechanical/electronic meters that physically reset to
// zero) — see Nozzle.rolloverAt / NozzleSettings. Checking it lifts the
// closingReading input's min so a value below openingReading can be
// entered at all.
//
// The backdated shiftEnd field is only shown for non-DSM roles — the
// backend rejects (403) a DSM caller sending shiftEnd at all
// (assertNonDsmOverride()), same as OpenShiftModal's shiftStart.
export function CloseShiftModal({ reading, currentStaff, onClose, onSaved }: CloseShiftModalProps) {
  const isDsm = currentStaff?.role === 'DSM';
  const [closingReading, setClosingReading] = useState('');
  const [meterRolledOver, setMeterRolledOver] = useState(false);
  const [backdateShiftEnd, setBackdateShiftEnd] = useState(false);
  const [shiftEnd, setShiftEnd] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const saved = await closeShift(reading.id, {
        closingReading: Number(closingReading),
        ...(meterRolledOver && { meterRolledOver: true }),
        ...(!isDsm && backdateShiftEnd && shiftEnd && { shiftEnd: new Date(shiftEnd).toISOString() }),
      });
      onSaved(saved);
    } catch (err) {
      // Backend validation (closingReading < openingReading without
      // meterRolledOver, already-closed shift, missing rolloverAt) is the
      // real enforcement — surfaced as-is, not re-checked here.
      setError(err instanceof ApiError ? err.message : "Can't reach the backend.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <form className="modal-card" onClick={(event) => event.stopPropagation()} onSubmit={(e) => { void handleSubmit(e); }}>
        <div className="section-title">
          <h3>Close shift</h3>
          <span className="section-note">
            Nozzle {reading.nozzle.label} ({reading.nozzle.item.name}) &middot; opened{' '}
            {formatTime(reading.shiftStart)} &middot; opening reading {reading.openingReading.toFixed(1)}
          </span>
        </div>

        <div className="form-field">
          <label htmlFor="cs-closing">Closing reading</label>
          <input
            id="cs-closing"
            type="number"
            min={meterRolledOver ? undefined : reading.openingReading}
            step="0.01"
            value={closingReading}
            onChange={(e) => setClosingReading(e.target.value)}
            required
          />
        </div>

        {reading.nozzle.rolloverAt != null && (
          <div className="form-field">
            <label>
              <input
                type="checkbox"
                checked={meterRolledOver}
                onChange={(e) => setMeterRolledOver(e.target.checked)}
                style={{ marginRight: 6 }}
              />
              This meter physically rolled over to zero this shift (rollover point:{' '}
              {reading.nozzle.rolloverAt.toFixed(2)})
            </label>
          </div>
        )}

        {!isDsm && (
          <div className="form-field">
            <label>
              <input
                type="checkbox"
                checked={backdateShiftEnd}
                onChange={(e) => setBackdateShiftEnd(e.target.checked)}
                style={{ marginRight: 6 }}
              />
              Backdate this shift's end (the DSM app was down — entering this after the fact)
            </label>
            {backdateShiftEnd && (
              <input
                type="datetime-local"
                value={shiftEnd}
                onChange={(e) => setShiftEnd(e.target.value)}
                max={new Date().toISOString().slice(0, 16)}
                required
                style={{ marginTop: 8 }}
              />
            )}
          </div>
        )}

        {error && <div className="form-error">{error}</div>}

        <div className="modal-actions">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button type="submit" className="export-btn" disabled={submitting}>
            {submitting ? 'Closing…' : 'Close shift'}
          </button>
        </div>
      </form>
    </div>
  );
}
