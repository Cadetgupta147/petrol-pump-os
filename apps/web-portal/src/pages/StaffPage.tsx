import { useEffect, useState } from 'react';
import { TopBar } from '../components/layout/TopBar';
import { NavBar } from '../components/layout/NavBar';
import { StaffFormModal } from '../components/staff/StaffFormModal';
import { getManagedStaff } from '../api/staffManagement';
import { getAttendanceLog } from '../api/attendance';
import { ApiError } from '../api/client';
import { useAuth } from '../context/useAuth';
import { formatDateTime } from '../utils/format';
import type { AttendanceLogRow, Staff } from '../api/types';

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
// Salary/advance tracking is separately flagged as Phase 5+/no schema
// support in AttendanceService's own comment (Section 12).
export function StaffPage() {
  const { staff: currentStaff } = useAuth();
  const isOwner = currentStaff?.role === 'OWNER';

  const [staffList, setStaffList] = useState<Staff[] | null>(null);
  const [staffError, setStaffError] = useState<string | null>(null);
  const [attendance, setAttendance] = useState<AttendanceLogRow[] | null>(null);
  const [attendanceError, setAttendanceError] = useState<string | null>(null);

  const [addingStaff, setAddingStaff] = useState(false);
  const [editingStaff, setEditingStaff] = useState<Staff | null>(null);

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

        {addingStaff && <StaffFormModal onClose={() => setAddingStaff(false)} onSaved={handleSaved} />}
        {editingStaff && (
          <StaffFormModal staffMember={editingStaff} onClose={() => setEditingStaff(null)} onSaved={handleSaved} />
        )}
      </div>
    </>
  );
}
