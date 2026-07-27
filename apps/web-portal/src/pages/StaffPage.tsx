import { useEffect, useState, type FormEvent } from 'react';
import { TopBar } from '../components/layout/TopBar';
import { NavBar } from '../components/layout/NavBar';
import { StaffFormModal } from '../components/staff/StaffFormModal';
import { getManagedStaff } from '../api/staffManagement';
import { getAttendanceLog } from '../api/attendance';
import { getStaffAdvances, createStaffAdvance, markStaffAdvanceRepaid } from '../api/staffAdvances';
import { ApiError } from '../api/client';
import { useAuth } from '../context/useAuth';
import { formatDateTime, formatRupees } from '../utils/format';
import type { AttendanceLogRow, Staff, StaffAdvance } from '../api/types';

// Section 3.7 — Staff Management: staff master CRUD + attendance log view.
//
// Scope note, flagged rather than silently built around: "Shift assignment"
// is listed in Section 3.7 alongside attendance, but there is no schema
// support for it anywhere in this codebase (no ShiftAssignment model, no
// endpoint) — MeterReadingsPage's open/close-shift flow (Section 3.3/4) is
// the actual per-shift mechanism that exists today, and it's a DSM
// self-service action at shift start, not a dealer pre-assigning shifts in
// advance. Building a real "assign staff to an upcoming shift" feature
// needs its own spec (what defines a shift slot, recurring vs. one-off,
// what happens on a no-show) before it's implementable — not guessed here.
// Salary/advance tracking (Section 17.23) is now built — fixed monthly
// salary editable via "Edit" above, advances recorded/settled in the
// "Staff advances" section below. Money-touching — human-reviewed before
// merge per CLAUDE.md.
export function StaffPage() {
  const { staff: currentStaff } = useAuth();
  const isOwner = currentStaff?.role === 'OWNER';

  const [staffList, setStaffList] = useState<Staff[] | null>(null);
  const [staffError, setStaffError] = useState<string | null>(null);
  const [attendance, setAttendance] = useState<AttendanceLogRow[] | null>(null);
  const [attendanceError, setAttendanceError] = useState<string | null>(null);

  const [addingStaff, setAddingStaff] = useState(false);
  const [editingStaff, setEditingStaff] = useState<Staff | null>(null);

  // Section 17.23 — staff advances. Owner/Accountant/Manager can record and
  // settle these (matches the backend's role gate) — not restricted to
  // Owner like monthlySalary editing above.
  const canManageAdvances =
    currentStaff?.role === 'OWNER' || currentStaff?.role === 'ACCOUNTANT' || currentStaff?.role === 'MANAGER';
  const [advances, setAdvances] = useState<StaffAdvance[] | null>(null);
  const [advancesError, setAdvancesError] = useState<string | null>(null);
  const [advanceStaffId, setAdvanceStaffId] = useState('');
  const [advanceAmount, setAdvanceAmount] = useState('');
  const [advanceNote, setAdvanceNote] = useState('');
  const [advanceSaving, setAdvanceSaving] = useState(false);
  const [advanceError, setAdvanceError] = useState<string | null>(null);
  const [repayingId, setRepayingId] = useState<string | null>(null);

  function loadAdvances() {
    return getStaffAdvances()
      .then((result) => {
        setAdvances(result);
        setAdvancesError(null);
      })
      .catch((err) => {
        setAdvancesError(err instanceof ApiError ? err.message : "Can't reach the backend.");
      });
  }

  async function handleAddAdvance(event: FormEvent) {
    event.preventDefault();
    if (!advanceStaffId) return;
    setAdvanceError(null);
    setAdvanceSaving(true);
    try {
      const trimmedNote = advanceNote.trim();
      await createStaffAdvance({
        staffId: advanceStaffId,
        amount: Number(advanceAmount.trim()),
        note: trimmedNote === '' ? undefined : trimmedNote,
      });
      setAdvanceStaffId('');
      setAdvanceAmount('');
      setAdvanceNote('');
      await loadAdvances();
    } catch (err) {
      setAdvanceError(err instanceof ApiError ? err.message : "Can't reach the backend.");
    } finally {
      setAdvanceSaving(false);
    }
  }

  async function handleMarkRepaid(id: string) {
    setRepayingId(id);
    setAdvanceError(null);
    try {
      await markStaffAdvanceRepaid(id);
      await loadAdvances();
    } catch (err) {
      setAdvanceError(err instanceof ApiError ? err.message : "Can't reach the backend.");
    } finally {
      setRepayingId(null);
    }
  }

  function loadStaff() {
    return getManagedStaff()
      .then((result) => {
        setStaffList(result);
        setStaffError(null);
      })
      .catch((err) => {
        setStaffError(err instanceof ApiError ? err.message : "Can't reach the backend.");
      });
  }

  useEffect(() => {
    let cancelled = false;
    getManagedStaff()
      .then((result) => {
        if (!cancelled) setStaffList(result);
      })
      .catch((err) => {
        if (!cancelled) {
          setStaffError(err instanceof ApiError ? err.message : "Can't reach the backend.");
        }
      });
    getAttendanceLog()
      .then((result) => {
        if (!cancelled) setAttendance(result);
      })
      .catch((err) => {
        if (!cancelled) {
          setAttendanceError(err instanceof ApiError ? err.message : "Can't reach the backend.");
        }
      });
    getStaffAdvances()
      .then((result) => {
        if (!cancelled) setAdvances(result);
      })
      .catch((err) => {
        if (!cancelled) {
          setAdvancesError(err instanceof ApiError ? err.message : "Can't reach the backend.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function handleSaved() {
    setAddingStaff(false);
    setEditingStaff(null);
    void loadStaff();
  }

  return (
    <>
      <TopBar />
      <NavBar />
      <div className="content">
        <div className="content-header">
          <div className="section-title">
            <h3>Staff</h3>
            <span className="section-note">Section 3.7 — staff master, roles, and the attendance log.</span>
          </div>
          {isOwner && (
            <button type="button" className="export-btn" onClick={() => setAddingStaff(true)}>
              + Add staff
            </button>
          )}
        </div>

        {staffError && <div className="error-box">{staffError}</div>}
        {!staffError && !staffList && <div className="loading">Loading staff…</div>}
        {!staffError && staffList && staffList.length === 0 && (
          <div className="empty-box">No staff recorded yet.</div>
        )}
        {!staffError && staffList && staffList.length > 0 && (
          <div className="table-card">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Phone</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {staffList.map((member) => (
                  <tr key={member.id}>
                    <td>{member.name}</td>
                    <td>{member.phone}</td>
                    <td>{member.role}</td>
                    <td>
                      <span
                        className="badge"
                        style={{
                          background: member.active ? 'var(--green-bg)' : 'var(--page-bg)',
                          color: member.active ? 'var(--green)' : 'var(--gray)',
                        }}
                      >
                        {member.active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="chevron">
                      {isOwner && (
                        <button type="button" className="icon-btn" onClick={() => setEditingStaff(member)}>
                          Edit
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="section">
          <div className="section-title">
            <h3>Attendance log</h3>
            <span className="section-note">GET /attendance — every clock-in/out session, newest first. See Reports for the hours-worked summary.</span>
          </div>

          {attendanceError && <div className="error-box">{attendanceError}</div>}
          {!attendanceError && !attendance && <div className="loading">Loading attendance…</div>}
          {!attendanceError && attendance && attendance.length === 0 && (
            <div className="empty-box">No attendance sessions recorded yet.</div>
          )}
          {!attendanceError && attendance && attendance.length > 0 && (
            <div className="table-card">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Staff</th>
                    <th>Clock in</th>
                    <th>Clock out</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {attendance.map((session) => (
                    <tr key={session.id}>
                      <td>{session.staff.name}</td>
                      <td>{formatDateTime(session.clockIn)}</td>
                      <td>{session.clockOut ? formatDateTime(session.clockOut) : '—'}</td>
                      <td>
                        {session.clockOut ? (
                          <span className="badge" style={{ background: 'var(--page-bg)', color: 'var(--gray)' }}>
                            Closed
                          </span>
                        ) : (
                          <span className="badge" style={{ background: 'var(--amber-bg)', color: 'var(--amber)' }}>
                            Clocked in
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="section">
          <div className="section-title">
            <h3>Staff advances</h3>
            <span className="section-note">
              Section 17.23 — cash advances against fixed monthly salary. All-or-nothing repayment,
              no partial-repayment ledger.
            </span>
          </div>

          {advancesError && <div className="error-box">{advancesError}</div>}
          {!advancesError && !advances && <div className="loading">Loading advances…</div>}
          {!advancesError && advances && advances.length === 0 && (
            <div className="empty-box">No advances recorded yet.</div>
          )}
          {!advancesError && advances && advances.length > 0 && (
            <div className="table-card">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Staff</th>
                    <th className="num">Amount</th>
                    <th>Given at</th>
                    <th>Note</th>
                    <th>Status</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {advances.map((advance) => (
                    <tr key={advance.id}>
                      <td>{advance.staff.name}</td>
                      <td className="num">{formatRupees(advance.amount)}</td>
                      <td>{formatDateTime(advance.givenAt)}</td>
                      <td>{advance.note ?? '—'}</td>
                      <td>
                        {advance.repaidAt ? (
                          <span className="badge" style={{ background: 'var(--green-bg)', color: 'var(--green)' }}>
                            Repaid
                          </span>
                        ) : (
                          <span className="badge" style={{ background: 'var(--amber-bg)', color: 'var(--amber)' }}>
                            Outstanding
                          </span>
                        )}
                      </td>
                      <td className="chevron">
                        {canManageAdvances && !advance.repaidAt && (
                          <button
                            type="button"
                            className="icon-btn"
                            onClick={() => {
                              void handleMarkRepaid(advance.id);
                            }}
                            disabled={repayingId === advance.id}
                          >
                            {repayingId === advance.id ? 'Saving…' : 'Mark repaid'}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {canManageAdvances && staffList && (
            <form
              onSubmit={(e) => {
                void handleAddAdvance(e);
              }}
              style={{ marginTop: 16 }}
            >
              <div className="grid grid-3" style={{ gap: 12 }}>
                <div className="form-field" style={{ marginBottom: 0 }}>
                  <label htmlFor="adv-staff">Staff member</label>
                  <select
                    id="adv-staff"
                    value={advanceStaffId}
                    onChange={(e) => setAdvanceStaffId(e.target.value)}
                    required
                  >
                    <option value="">Select…</option>
                    {staffList.map((member) => (
                      <option key={member.id} value={member.id}>
                        {member.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-field" style={{ marginBottom: 0 }}>
                  <label htmlFor="adv-amount">Amount (Rs.)</label>
                  <input
                    id="adv-amount"
                    type="number"
                    min="0"
                    step="any"
                    value={advanceAmount}
                    onChange={(e) => setAdvanceAmount(e.target.value)}
                    required
                  />
                </div>
                <div className="form-field" style={{ marginBottom: 0 }}>
                  <label htmlFor="adv-note">Note (optional)</label>
                  <input id="adv-note" value={advanceNote} onChange={(e) => setAdvanceNote(e.target.value)} />
                </div>
              </div>
              {advanceError && <div className="form-error">{advanceError}</div>}
              <div className="modal-actions">
                <button type="submit" className="export-btn" disabled={advanceSaving}>
                  {advanceSaving ? 'Saving…' : 'Record advance'}
                </button>
              </div>
            </form>
          )}
        </div>

        {addingStaff && <StaffFormModal onClose={() => setAddingStaff(false)} onSaved={handleSaved} />}
        {editingStaff && (
          <StaffFormModal staffMember={editingStaff} onClose={() => setEditingStaff(null)} onSaved={handleSaved} />
        )}
      </div>
    </>
  );
}
