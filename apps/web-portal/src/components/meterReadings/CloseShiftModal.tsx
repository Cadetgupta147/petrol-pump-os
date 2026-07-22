import { useState, type FormEvent } from 'react';
import { closeShift } from '../../api/meterReadings';
import { ApiError } from '../../api/client';
import { formatTime } from '../../utils/format';
import type { MeterReading } from '../../api/types';

interface CloseShiftModalProps {
  reading: MeterReading;
  onClose: () => void;
  onSaved: (reading: MeterReading) => void;
}

// Section 3.3/4 — manual closing-reading entry. Litres sold is
// auto-calculated server-side (closing - opening); this form only collects
// the raw reading, same as the DSM app's own shift-end screen.
export function CloseShiftModal({ reading, onClose, onSaved }: CloseShiftModalProps) {
  const [closingReading, setClosingReading] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const saved = await closeShift(reading.id, { closingReading: Number(closingReading) });
      onSaved(saved);
    } catch (err) {
      // Backend validation (closingReading < openingReading, already-closed
      // shift) is the real enforcement — surfaced as-is, not re-checked here.
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
            Nozzle {reading.nozzle.label} ({reading.nozzle.productType}) &middot; opened{' '}
            {formatTime(reading.shiftStart)} &middot; opening reading {reading.openingReading.toFixed(1)}
          </span>
        </div>

        <div className="form-field">
          <label htmlFor="cs-closing">Closing reading</label>
          <input
            id="cs-closing"
            type="number"
            min={reading.openingReading}
            step="0.01"
            value={closingReading}
            onChange={(e) => setClosingReading(e.target.value)}
            required
          />
        </div>

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
