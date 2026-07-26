import { useState, type FormEvent } from 'react';
import { resolveVehicleBlacklistEntry } from '../../api/vehicleBlacklist';
import { ApiError } from '../../api/client';
import type { VehicleBlacklistEntry } from '../../api/types';

interface ResolveVehicleBlacklistModalProps {
  entry: VehicleBlacklistEntry;
  onClose: () => void;
  onResolved: (entry: VehicleBlacklistEntry) => void;
}

// Section 3.4B — PATCH /vehicle-blacklist/:id/resolve. Owner-only
// server-side. resolvedById/resolvedAt are stamped by the backend from the
// authenticated caller, never accepted here.
export function ResolveVehicleBlacklistModal({
  entry,
  onClose,
  onResolved,
}: ResolveVehicleBlacklistModalProps) {
  const [resolutionNote, setResolutionNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const trimmedNote = resolutionNote.trim();
      const saved = await resolveVehicleBlacklistEntry(entry.id, {
        resolutionNote: trimmedNote === '' ? undefined : trimmedNote,
      });
      onResolved(saved);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Can't reach the backend.");
    } finally {
      setSubmitting(false);
    }
  }

  const subject = entry.scope === 'VEHICLE' ? `Vehicle ${entry.vehicleNumber}` : `Company ${entry.companyName}`;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <form
        className="modal-card"
        onClick={(event) => event.stopPropagation()}
        onSubmit={(e) => { void handleSubmit(e); }}
      >
        <div className="section-title">
          <h3>Resolve blacklist entry</h3>
          <span className="section-note">{subject} — dues cleared or dispute settled</span>
        </div>

        <div className="form-field">
          <label htmlFor="vb-resolution-note">Resolution note (optional)</label>
          <input
            id="vb-resolution-note"
            value={resolutionNote}
            onChange={(e) => setResolutionNote(e.target.value)}
            placeholder="e.g. Paid ₹4,500 in cash on 20 Jul"
          />
        </div>

        {error && <div className="form-error">{error}</div>}

        <div className="modal-actions">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button type="submit" className="export-btn" disabled={submitting}>
            {submitting ? 'Resolving…' : 'Mark resolved'}
          </button>
        </div>
      </form>
    </div>
  );
}
