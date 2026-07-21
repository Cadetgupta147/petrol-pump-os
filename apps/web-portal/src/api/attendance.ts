import { apiFetch } from './client';
import type { AttendanceLogRow, AttendanceSummary } from './types';

// GET /attendance — Section 3.7's attendance log: every clock-in/out
// session, newest first, staff name already joined in. Owner/Accountant/
// Manager server-side.
export function getAttendanceLog(): Promise<AttendanceLogRow[]> {
  return apiFetch<AttendanceLogRow[]>('/attendance');
}

// GET /attendance/summary?from=&to= — Section 12. Owner/Accountant/Read-only
// server-side. from/to are YYYY-MM-DD strings (DateRangeQueryDto). Hours-
// worked half only — salaryAndAdvancesNote in the response must stay visible
// in the UI (see AttendanceService's class comment on the scope gap: no
// wage/salary-rate field on Staff, no advances table).
export function getAttendanceSummary(from: string, to: string): Promise<AttendanceSummary> {
  const params = new URLSearchParams({ from, to });
  return apiFetch<AttendanceSummary>(`/attendance/summary?${params.toString()}`);
}
