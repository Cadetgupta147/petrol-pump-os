import { useState, type FormEvent } from 'react';
import { correctMeterReading } from '../../api/meterReadings';
import { ApiError } from '../../api/client';
import { formatDateTime } from '../../utils/format';
import type { MeterReading } from '../../api/types';

interface CorrectMeterReadingModalProps {
  reading: MeterReading;
  onClose: () => void;
  onSaved: (reading: MeterReading) => void;
}

// PATCH /meter-readings/:id/correct — Owner/Accountant only (gated by the
// caller, MeterReadingsPage). Only sends a field if its value actually
// changed from what's already on the reading — the backend treats a
// present openingReading as "correct this", and would reject that outright
// on any shift that isn't this nozzle's first-ever one (see
// CorrectMeterReadingDto's comment), even if the value is identical to what
// was already there. Sending only real changes avoids tripping that up.
export function CorrectMeterReadingModal({ reading, onClose, onSaved }: CorrectMeterReadingModalProps) {
  const [openingReading, setOpeningReading] = useState(String(reading.openingReading));
  const [closingReading, setClosingReading] = useState(
    reading.closingReading !== null ? String(reading.closingReading) : '',
  );
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    const openingChanged = Number(openingReading) !== reading.openingReading;
    const closingChanged =
      reading.closingReading === null || Number(closingReading) !== reading.closingReading;

    if (!openingChanged && !closingChanged) {
      setError('Change opening reading or closing reading before saving a correction.');
      return;
    }

    setSubmitting(true);
    try {
      const saved = await correctMeterReading(reading.id, {
        ...(openingChanged && { openingReading: Number(openingReading) }),
        ...(closingChanged && { closingReading: Number(closingReading) }),
      });
      onSaved(saved);
    } catch (err) {
      // Backend enforces every rule here (first-shift-only opening
      // correction, blocked when a later shift is already closed too,
      // etc.) — surfaced as-is.
      setError(err instanceof ApiError ? err.message : "Can't reach the backend.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <form className="modal-card" onClick={(event) => event.stopPropagation()} onSubmit={(e) => { void handleSubmit(e); }}>
        <div className="section-title">
          <h3>Correct meter reading</h3>
          <span className="section-note">
            Nozzle {reading.nozzle.label} ({reading.nozzle.item.name}) &middot; shift{' '}
            {formatDateTime(reading.shiftStart)}
            {reading.shiftEnd ? ` – ${formatDateTime(reading.shiftEnd)}` : ''}
          </span>
        </div>

        <div className="banner">
          Opening reading can only be corrected on this nozzle&rsquo;s very first-ever shift — every later
          shift&rsquo;s opening reading is carried forward automatically, so correct the earlier shift&rsquo;s
          closing reading instead. Correcting a closing reading adjusts tank stock by the difference and,
          if the next shift on this nozzle is still open, updates its opening reading to match.
        </div>

        <div className="form-field">
          <label htmlFor="cr-opening">Opening reading</label>
          <input
            id="cr-opening"
            type="number"
            min="0"
            step="0.01"
            value={openingReading}
            onChange={(e) => setOpeningReading(e.target.value)}
            required
          />
        </div>

        <div className="form-field">
          <label htmlFor="cr-closing">Closing reading</label>
          <input
            id="cr-closing"
            type="number"
            min="0"
            step="0.01"
            value={closingReading}
            onChange={(e) => setClosingReading(e.target.value)}
            disabled={reading.closingReading === null}
            required={reading.closingReading !== null}
          />
          {reading.closingReading === null && (
            <div className="card-sub">This shift is still open — close it first before correcting.</div>
          )}
        </div>

        {error && <div className="form-error">{error}</div>}

        <div className="modal-actions">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button type="submit" className="export-btn" disabled={submitting}>
            {submitting ? 'Saving…' : 'Save correction'}
          </button>
        </div>
      </form>
    </div>
  );
}
