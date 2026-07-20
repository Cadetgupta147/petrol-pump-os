import { useEffect, useState, type FormEvent } from 'react';
import { getAttendanceSummary } from '../../api/attendance';
import { ApiError } from '../../api/client';
import { formatDateTime, todayIsoDate } from '../../utils/format';
import type { AttendanceSummary } from '../../api/types';

// GET /attendance/summary?from=&to= — Section 12. Hours-worked half only —
// salaryAndAdvancesNote must stay visible (not just fetched and ignored), per
// this slice's explicit requirement, so the UI never implies "$0 due" when
// the truth is "not computed at all".
export function AttendanceSummaryTab() {
  const [from, setFrom] = useState(todayIsoDate());
  const [to, setTo] = useState(todayIsoDate());
  const [report, setReport] = useState<AttendanceSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function load(fromDate: string, toDate: string) {
    setLoading(true);
    setError(null);
    getAttendanceSummary(fromDate, toDate)
      .then(setReport)
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : "Can't reach the backend.");
      })
      .finally(() => setLoading(false));
  }

  // Load once on mount with today's date — subsequent loads are user-driven
  // via the form below (handleSubmit calls the shared load() helper, which
  // is fine to call from an event handler). The mount effect fetches
  // directly instead of calling that helper, so no setState happens
  // synchronously within the effect body itself — only inside the
  // .then/.catch callbacks, same pattern as every other page's mount-fetch in
  // this app (e.g. VarianceReportPage).
  useEffect(() => {
    let cancelled = false;
    getAttendanceSummary(todayIsoDate(), todayIsoDate())
      .then((result) => {
        if (!cancelled) setReport(result);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : "Can't reach the backend.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    load(from, to);
  }

  return (
    <div>
      <form className="content-header" onSubmit={handleSubmit}>
        <div className="grid grid-2" style={{ gap: 12 }}>
          <div className="form-field" style={{ marginBottom: 0 }}>
            <label htmlFor="att-from">From</label>
            <input id="att-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} required />
          </div>
          <div className="form-field" style={{ marginBottom: 0 }}>
            <label htmlFor="att-to">To</label>
            <input id="att-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} required />
          </div>
        </div>
        <div className="content-header-right">
          <button type="submit" className="export-btn" disabled={loading}>
            {loading ? 'Loading…' : 'Load summary'}
          </button>
        </div>
      </form>

      {error && <div className="error-box">{error}</div>}
      {!error && !report && <div className="loading">Loading attendance summary…</div>}

      {!error && report && (
        <>
          <div className="banner">
            <strong>Salary/advances not computed:</strong> {report.salaryAndAdvancesNote}
          </div>

          {report.staff.length === 0 ? (
            <div className="empty-box">No clock-in sessions in this range.</div>
          ) : (
            <div className="table-card">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Staff</th>
                    <th className="num">Hours worked</th>
                    <th className="num">Sessions</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {report.staff.map((row) => (
                    <tr key={row.staffId}>
                      <td>{row.staffName}</td>
                      <td className="num">{row.totalHoursWorked.toFixed(1)}</td>
                      <td className="num">{row.sessionCount}</td>
                      <td>
                        {row.stillClockedIn ? (
                          <span className="badge" style={{ background: 'var(--amber-bg)', color: 'var(--amber)' }}>
                            Still clocked in
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="footnote">
            Range: {formatDateTime(report.from)} to {formatDateTime(report.to)}
          </div>
        </>
      )}
    </div>
  );
}
