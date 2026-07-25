import { useEffect, useState, type FormEvent } from 'react';
import { createShiftDefinition, getShiftDefinitions, updateShiftDefinition } from '../../api/shiftSchedule';
import { StatusBadge } from '../common/StatusBadge';
import { ApiError } from '../../api/client';
import type { ShiftDefinition } from '../../api/types';

interface ShiftScheduleSettingsProps {
  canManage: boolean;
}

// Meter Reading redesign (Section 3.3) — Settings: "what are this pump's
// shift windows" (e.g. Shift 1 06:00-14:00, Shift 2 14:00-22:00). A flat
// dealer-managed list, like Nozzle/Item Master — NOT a singleton config.
// Used purely to label which shift a batch-closing-readings submission
// belongs to (the DSM app's batch-close screen) — never a blocking gate, so
// there's deliberately no overlap/gap validation here either.
//
// canManage gates create/edit to Owner/Accountant (mirrors the backend's
// @Roles(Role.OWNER, Role.ACCOUNTANT) on ShiftScheduleController — same
// access level as Nozzle Master, not the wider Item Master access).
export function ShiftScheduleSettings({ canManage }: ShiftScheduleSettingsProps) {
  const [shifts, setShifts] = useState<ShiftDefinition[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [label, setLabel] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const [editStartTime, setEditStartTime] = useState('');
  const [editEndTime, setEditEndTime] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  function loadShifts() {
    // includeInactive: true — this Settings screen must be able to find and
    // re-enable a disabled shift definition.
    return getShiftDefinitions(true)
      .then((result) => {
        setShifts(result);
        setLoadError(null);
        return result;
      })
      .catch((err) => {
        setLoadError(err instanceof ApiError ? err.message : "Can't reach the backend.");
        return null;
      });
  }

  useEffect(() => {
    let cancelled = false;
    getShiftDefinitions(true)
      .then((result) => {
        if (!cancelled) setShifts(result);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err instanceof ApiError ? err.message : "Can't reach the backend.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleAdd(event: FormEvent) {
    event.preventDefault();
    setAddError(null);
    setAdding(true);
    try {
      await createShiftDefinition({ label: label.trim(), startTime, endTime });
      setLabel('');
      setStartTime('');
      setEndTime('');
      await loadShifts();
    } catch (err) {
      setAddError(err instanceof ApiError ? err.message : "Can't reach the backend.");
    } finally {
      setAdding(false);
    }
  }

  function startEdit(shift: ShiftDefinition) {
    setEditingId(shift.id);
    setEditLabel(shift.label);
    setEditStartTime(shift.startTime);
    setEditEndTime(shift.endTime);
    setEditError(null);
  }

  async function handleSaveEdit(event: FormEvent) {
    event.preventDefault();
    if (!editingId) return;
    setEditError(null);
    setSavingEdit(true);
    try {
      await updateShiftDefinition(editingId, {
        label: editLabel.trim(),
        startTime: editStartTime,
        endTime: editEndTime,
      });
      setEditingId(null);
      await loadShifts();
    } catch (err) {
      setEditError(err instanceof ApiError ? err.message : "Can't reach the backend.");
    } finally {
      setSavingEdit(false);
    }
  }

  async function handleToggleActive(shift: ShiftDefinition) {
    try {
      await updateShiftDefinition(shift.id, { isActive: !shift.isActive });
      await loadShifts();
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : "Can't reach the backend.");
    }
  }

  return (
    <div className="section">
      <div className="section-title">
        <h3>Shift schedule</h3>
        <span className="section-note">
          Section 3.3 — the pump-wide shift windows all DSMs rotate through (e.g. Shift 1 06:00&ndash;14:00).
          This only labels which shift a batch of closing readings belongs to — it never blocks a
          submission, so times can overlap or leave gaps without causing an error.
        </span>
      </div>

      {loadError && <div className="error-box">{loadError}</div>}
      {!loadError && !shifts && <div className="loading">Loading shift schedule&hellip;</div>}

      {!loadError && shifts && (
        shifts.length === 0 ? (
          <div className="empty-box">No shifts configured yet — add this pump&rsquo;s first shift below.</div>
        ) : (
          <div className="table-card">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Label</th>
                  <th>Start</th>
                  <th>End</th>
                  <th>Status</th>
                  {canManage && <th></th>}
                </tr>
              </thead>
              <tbody>
                {shifts.map((shift) =>
                  editingId === shift.id ? (
                    <tr key={shift.id}>
                      <td colSpan={canManage ? 5 : 4}>
                        <form
                          onSubmit={(e) => {
                            void handleSaveEdit(e);
                          }}
                          style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}
                        >
                          <input
                            value={editLabel}
                            onChange={(e) => setEditLabel(e.target.value)}
                            placeholder="Label"
                            required
                            style={{ width: 110 }}
                          />
                          <input
                            type="time"
                            value={editStartTime}
                            onChange={(e) => setEditStartTime(e.target.value)}
                            required
                          />
                          <input
                            type="time"
                            value={editEndTime}
                            onChange={(e) => setEditEndTime(e.target.value)}
                            required
                          />
                          <button type="submit" className="export-btn" disabled={savingEdit}>
                            {savingEdit ? 'Saving…' : 'Save'}
                          </button>
                          <button
                            type="button"
                            className="btn-secondary"
                            onClick={() => setEditingId(null)}
                            disabled={savingEdit}
                          >
                            Cancel
                          </button>
                        </form>
                        {editError && <div className="form-error">{editError}</div>}
                      </td>
                    </tr>
                  ) : (
                    <tr key={shift.id}>
                      <td style={{ fontWeight: 700 }}>{shift.label}</td>
                      <td>{shift.startTime}</td>
                      <td>{shift.endTime}</td>
                      <td>
                        <StatusBadge tone={shift.isActive ? 'good' : 'neutral'} label={shift.isActive ? 'Active' : 'Disabled'} />
                      </td>
                      {canManage && (
                        <td className="chevron">
                          <button type="button" className="icon-btn" onClick={() => startEdit(shift)}>
                            Edit
                          </button>{' '}
                          <button
                            type="button"
                            className="icon-btn"
                            onClick={() => {
                              void handleToggleActive(shift);
                            }}
                          >
                            {shift.isActive ? 'Disable' : 'Enable'}
                          </button>
                        </td>
                      )}
                    </tr>
                  ),
                )}
              </tbody>
            </table>
            <div className="footnote">
              A shift whose end time is numerically before its start time (e.g. 22:00&ndash;06:00) wraps
              past midnight &mdash; that&rsquo;s expected for an overnight shift.
            </div>
          </div>
        )
      )}

      {canManage ? (
        <form
          onSubmit={(e) => {
            void handleAdd(e);
          }}
          style={{ marginTop: 16 }}
        >
          <div className="grid grid-3" style={{ gap: 12 }}>
            <div className="form-field" style={{ marginBottom: 0 }}>
              <label htmlFor="ss-label">Label</label>
              <input
                id="ss-label"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="e.g. Shift 1"
                required
              />
            </div>
            <div className="form-field" style={{ marginBottom: 0 }}>
              <label htmlFor="ss-start">Start time</label>
              <input id="ss-start" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} required />
            </div>
            <div className="form-field" style={{ marginBottom: 0 }}>
              <label htmlFor="ss-end">End time</label>
              <input id="ss-end" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} required />
            </div>
          </div>
          {addError && <div className="form-error">{addError}</div>}
          <div className="modal-actions">
            <button type="submit" className="export-btn" disabled={adding}>
              {adding ? 'Adding…' : '+ Add shift'}
            </button>
          </div>
        </form>
      ) : (
        <div className="section-note">
          Only the Owner/Accountant can add or edit the shift schedule — this view is read-only for your role.
        </div>
      )}
    </div>
  );
}
