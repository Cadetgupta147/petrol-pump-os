import { useState, type FormEvent } from 'react';
import { batchCloseMeterReadings } from '../../api/meterReadings';
import { ApiError } from '../../api/client';
import type { MeterReading, Nozzle, StaffListItem } from '../../api/types';

interface BatchCloseModalProps {
  nozzles: Nozzle[];
  readings: MeterReading[];
  staff: StaffListItem[];
  onClose: () => void;
  onSaved: (updated: MeterReading[]) => void;
}

interface RowState {
  openingReading: number;
  closingReading: string;
  meterRolledOver: boolean;
  staffId: string;
}

// Meter Reading redesign (Section 3.3) — the web-portal counterpart to the
// DSM app's batch-close screen: submit closing readings for every active
// nozzle at once, no separate "open shift" step. Opening a nozzle's very
// first shift, and re-opening its next one right after this closes, both
// happen server-side automatically (see MeterReadingsService.batchClose()).
//
// Unlike the DSM app, every caller who can reach this page is Owner/
// Accountant/Manager (Section 2: DSM has no web portal access) —
// resolveAssignableActorId() never forces self-only here, so every row's
// staff picker is always freely editable and required, not locked to self.
function buildInitialRows(nozzles: Nozzle[], readings: MeterReading[]): Record<string, RowState> {
  const openByNozzle = new Map<string, MeterReading>();
  for (const reading of readings) {
    if (reading.closingReading === null) openByNozzle.set(reading.nozzleId, reading);
  }
  const rows: Record<string, RowState> = {};
  for (const nozzle of nozzles) {
    const open = openByNozzle.get(nozzle.id);
    const openingReading = open ? open.openingReading : nozzle.nextOpeningReading;
    rows[nozzle.id] = {
      openingReading,
      closingReading: String(openingReading),
      meterRolledOver: false,
      staffId: '',
    };
  }
  return rows;
}

export function BatchCloseModal({ nozzles, readings, staff, onClose, onSaved }: BatchCloseModalProps) {
  const [rows, setRows] = useState<Record<string, RowState>>(() => buildInitialRows(nozzles, readings));
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function updateRow(nozzleId: string, patch: Partial<RowState>) {
    setRows((prev) => ({ ...prev, [nozzleId]: { ...prev[nozzleId], ...patch } }));
  }

  const canSubmit =
    nozzles.length > 0 &&
    nozzles.every((nozzle) => {
      const row = rows[nozzle.id];
      if (!row) return false;
      const value = Number(row.closingReading);
      return row.closingReading.trim().length > 0 && !Number.isNaN(value) && value >= 0 && row.staffId !== '';
    });

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const updated = await batchCloseMeterReadings(
        nozzles.map((nozzle) => {
          const row = rows[nozzle.id];
          return {
            nozzleId: nozzle.id,
            closingReading: Number(row.closingReading),
            ...(row.meterRolledOver && { meterRolledOver: true }),
            staffId: row.staffId,
          };
        }),
      );
      onSaved(updated);
    } catch (err) {
      // Backend validation (e.g. a bad rollover input on one nozzle) aborts
      // the whole batch and identifies which nozzle failed in its message —
      // surfaced as-is, not re-validated client-side.
      setError(err instanceof ApiError ? err.message : "Can't reach the backend.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <form
        className="modal-card"
        style={{ maxWidth: 720, width: '90vw' }}
        onClick={(event) => event.stopPropagation()}
        onSubmit={(e) => {
          void handleSubmit(e);
        }}
      >
        <div className="section-title">
          <h3>Batch close all nozzles</h3>
          <span className="section-note">
            Enter each nozzle&rsquo;s closing reading and who covered it &mdash; a nozzle left unchanged
            submits with no litres sold. Opening readings shown here are read-only, carried forward
            automatically.
          </span>
        </div>

        {nozzles.length === 0 ? (
          <div className="banner">
            No nozzles are configured yet &mdash; add at least one under Settings &rarr; Nozzle / meter
            configuration before batch-closing.
          </div>
        ) : (
          <div className="table-card" style={{ maxHeight: '50vh', overflowY: 'auto', marginBottom: 16 }}>
            <table className="data-table gridded">
              <thead>
                <tr>
                  <th>Nozzle</th>
                  <th className="num">Opening</th>
                  <th className="num">Closing</th>
                  <th>Rollover</th>
                  <th>Staff</th>
                </tr>
              </thead>
              <tbody>
                {nozzles.map((nozzle) => {
                  const row = rows[nozzle.id];
                  if (!row) return null;
                  return (
                    <tr key={nozzle.id}>
                      <td style={{ fontWeight: 700 }}>
                        {nozzle.label} &middot; {nozzle.item.name}
                      </td>
                      <td className="num">{row.openingReading.toFixed(1)}</td>
                      <td className="num">
                        <input
                          type="number"
                          min={row.meterRolledOver ? undefined : row.openingReading}
                          step="0.01"
                          value={row.closingReading}
                          onChange={(e) => updateRow(nozzle.id, { closingReading: e.target.value })}
                          style={{ width: 100 }}
                          required
                        />
                      </td>
                      <td>
                        {nozzle.rolloverAt != null ? (
                          <label style={{ fontSize: 11, whiteSpace: 'nowrap' }}>
                            <input
                              type="checkbox"
                              checked={row.meterRolledOver}
                              onChange={(e) => updateRow(nozzle.id, { meterRolledOver: e.target.checked })}
                              style={{ marginRight: 4 }}
                            />
                            Rolled over
                          </label>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td>
                        <select
                          value={row.staffId}
                          onChange={(e) => updateRow(nozzle.id, { staffId: e.target.value })}
                          required
                          style={{ width: 130 }}
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
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {error && <div className="form-error">{error}</div>}

        <div className="modal-actions">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button type="submit" className="export-btn" disabled={submitting || !canSubmit}>
            {submitting ? 'Closing…' : `Close ${nozzles.length} nozzle${nozzles.length === 1 ? '' : 's'}`}
          </button>
        </div>
      </form>
    </div>
  );
}
