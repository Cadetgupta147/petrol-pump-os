import { useEffect, useMemo, useState } from 'react';
import { TopBar } from '../components/layout/TopBar';
import { NavBar } from '../components/layout/NavBar';
import { OpenShiftModal } from '../components/meterReadings/OpenShiftModal';
import { CloseShiftModal } from '../components/meterReadings/CloseShiftModal';
import { getAllMeterReadings, getMeterVariance } from '../api/meterReadings';
import { getStaffList } from '../api/staff';
import { getNozzles } from '../api/nozzles';
import { ApiError } from '../api/client';
import { useAuth } from '../context/useAuth';
import { formatDateTime, formatLitres, formatSignedLitres } from '../utils/format';
import type { MeterReading, MeterVariance, Nozzle, StaffListItem } from '../api/types';

type StatusFilter = 'all' | 'open' | 'closed';

// Section 3.3 — Meter Reading Management: view readings by shift/DSM/nozzle,
// manual entry fallback (open/close shift), and the litres-sold-vs-billed
// variance flag. Backend (apps/backend/src/meter-readings) already has the
// full CRUD + variance endpoints built — this page was the missing piece
// (previously an inert NOT_BUILT nav item).
//
// GET /meter-readings has no server-side filters (unlike GET /bills — see
// docs/production-readiness.md finding A5, which only flagged the bill
// register's unbounded-payload risk). Shift volume is naturally much lower
// than bill volume — a few shifts per nozzle per day, not one row per sale —
// so client-side filtering here is a reasonable scope, not a shortcut around
// a real scaling gap.
export function MeterReadingsPage() {
  const { staff: currentStaff } = useAuth();
  const [readings, setReadings] = useState<MeterReading[] | null>(null);
  const [staff, setStaff] = useState<StaffListItem[]>([]);
  const [nozzles, setNozzles] = useState<Nozzle[]>([]);
  const [varianceByReadingId, setVarianceByReadingId] = useState<Map<string, MeterVariance>>(new Map());
  const [varianceCheckError, setVarianceCheckError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [staffFilter, setStaffFilter] = useState('');
  const [nozzleFilter, setNozzleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  const [openingShift, setOpeningShift] = useState(false);
  const [closingShift, setClosingShift] = useState<MeterReading | null>(null);
  const [tankWarning, setTankWarning] = useState<string | null>(null);

  function load() {
    return getAllMeterReadings()
      .then((result) => {
        setReadings(result);
        setError(null);
        return result;
      })
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : "Can't reach the backend.");
        return null;
      });
  }

  useEffect(() => {
    let cancelled = false;
    getAllMeterReadings()
      .then((result) => {
        if (!cancelled) setReadings(result);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : "Can't reach the backend.");
        }
      });
    getStaffList().then((result) => {
      if (!cancelled) setStaff(result);
    }).catch(() => undefined);
    getNozzles().then((result) => {
      if (!cancelled) setNozzles(result);
    }).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  // Variance can only be checked once a shift is closed — same one-request-
  // per-closed-shift pattern DashboardPage's NozzleReadingsTable section uses.
  useEffect(() => {
    if (!readings) return;
    const closedReadings = readings.filter((r) => r.closingReading !== null);
    let cancelled = false;
    async function loadVariance() {
      const results = await Promise.all(
        closedReadings.map(async (reading) => {
          try {
            return { readingId: reading.id, variance: await getMeterVariance(reading.id), failed: false as const };
          } catch {
            return { readingId: reading.id, variance: null, failed: true as const };
          }
        }),
      );
      if (cancelled) return;
      const next = new Map<string, MeterVariance>();
      const failedCount = results.filter((r) => r.failed).length;
      for (const result of results) {
        if (!result.failed) next.set(result.readingId, result.variance);
      }
      setVarianceByReadingId(next);
      setVarianceCheckError(
        failedCount > 0
          ? `Could not verify meter variance for ${failedCount} reading${failedCount === 1 ? '' : 's'} — treat as unverified, not clean.`
          : null,
      );
    }
    void loadVariance();
    return () => {
      cancelled = true;
    };
  }, [readings]);

  const staffNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const member of staff) map.set(member.id, member.name);
    return map;
  }, [staff]);

  const filteredReadings = useMemo(() => {
    if (!readings) return [];
    return readings.filter((r) => {
      if (staffFilter && r.staffId !== staffFilter) return false;
      if (nozzleFilter && r.nozzleId !== nozzleFilter) return false;
      if (statusFilter === 'open' && r.closingReading !== null) return false;
      if (statusFilter === 'closed' && r.closingReading === null) return false;
      return true;
    });
  }, [readings, staffFilter, nozzleFilter, statusFilter]);

  // The close-shift response can carry a tankWarning (Section 7.2's
  // auto-deduct silently skipped — no matching Tank for this product). Same
  // silent-drop mistake already flagged for Bill.loyaltyWarning
  // (docs/production-readiness.md finding B7) — surface it as a visible
  // banner here instead of discarding it.
  function handleShiftSaved(saved: MeterReading) {
    setOpeningShift(false);
    setClosingShift(null);
    setTankWarning(saved.tankWarning ?? null);
    void load();
  }

  return (
    <>
      <TopBar />
      <NavBar />
      <div className="content">
        <div className="content-header">
          <div className="section-title">
            <h3>Meter reading management</h3>
            <span className="section-note">Section 3.3 — opening/closing readings per nozzle per shift, and the meter-vs-billed variance flag.</span>
          </div>
          <button type="button" className="export-btn" onClick={() => setOpeningShift(true)}>
            + Open shift
          </button>
        </div>

        <div className="section">
          <div className="grid grid-3" style={{ gap: 12 }}>
            <div className="form-field" style={{ marginBottom: 0 }}>
              <label htmlFor="mr-staff-filter">DSM / staff</label>
              <select id="mr-staff-filter" value={staffFilter} onChange={(e) => setStaffFilter(e.target.value)}>
                <option value="">All staff</option>
                {staff.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-field" style={{ marginBottom: 0 }}>
              <label htmlFor="mr-nozzle-filter">Nozzle</label>
              <select id="mr-nozzle-filter" value={nozzleFilter} onChange={(e) => setNozzleFilter(e.target.value)}>
                <option value="">All nozzles</option>
                {nozzles.map((nozzle) => (
                  <option key={nozzle.id} value={nozzle.id}>
                    {nozzle.label} &middot; {nozzle.productType}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-field" style={{ marginBottom: 0 }}>
              <label htmlFor="mr-status-filter">Status</label>
              <select
                id="mr-status-filter"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
              >
                <option value="all">All shifts</option>
                <option value="open">Open only</option>
                <option value="closed">Closed only</option>
              </select>
            </div>
          </div>
        </div>

        {error && <div className="error-box">{error}</div>}
        {tankWarning && <div className="banner">{tankWarning}</div>}
        {varianceCheckError && <div className="banner">{varianceCheckError}</div>}
        {!error && !readings && <div className="loading">Loading meter readings…</div>}
        {!error && readings && filteredReadings.length === 0 && (
          <div className="empty-box">No meter reading shifts match these filters.</div>
        )}

        {!error && readings && filteredReadings.length > 0 && (
          <div className="table-card">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Shift start</th>
                  <th>Shift end</th>
                  <th>Nozzle</th>
                  <th>Product</th>
                  <th>Staff</th>
                  <th className="num">Reading</th>
                  <th className="num">Litres sold</th>
                  <th className="num">Billed</th>
                  <th className="num">Variance</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filteredReadings.map((reading) => {
                  const variance = varianceByReadingId.get(reading.id);
                  const isOpen = reading.closingReading === null;
                  return (
                    <tr key={reading.id}>
                      <td>{formatDateTime(reading.shiftStart)}</td>
                      <td>{reading.shiftEnd ? formatDateTime(reading.shiftEnd) : '—'}</td>
                      <td>{reading.nozzle.label}</td>
                      <td>{reading.productType ?? reading.nozzle.productType ?? '—'}</td>
                      <td>{staffNameById.get(reading.staffId) ?? reading.staffId.slice(0, 8) + '…'}</td>
                      <td className="num">
                        {reading.openingReading.toFixed(1)}
                        {reading.closingReading !== null ? ` → ${reading.closingReading.toFixed(1)}` : ' → open'}
                      </td>
                      <td className="num">
                        {reading.litresSold !== null ? formatLitres(reading.litresSold) : '—'}
                      </td>
                      <td className="num">
                        {variance ? formatLitres(variance.litresBilled) : isOpen ? '—' : 'loading…'}
                      </td>
                      <td className="num" style={{ fontWeight: 700, color: variance?.flagged ? 'var(--red)' : 'var(--text-dark)' }}>
                        {variance ? formatSignedLitres(variance.variance) : '—'}
                      </td>
                      <td>
                        {isOpen ? (
                          <span className="badge" style={{ background: 'var(--amber-bg)', color: 'var(--amber)' }}>
                            Shift open
                          </span>
                        ) : variance ? (
                          <span
                            className="badge"
                            style={{
                              background: variance.flagged ? 'var(--red-bg)' : 'var(--green-bg)',
                              color: variance.flagged ? 'var(--red)' : 'var(--green)',
                            }}
                          >
                            {variance.flagged ? 'Flagged' : 'Within tolerance'}
                          </span>
                        ) : (
                          <span className="badge" style={{ background: 'var(--page-bg)', color: 'var(--gray)' }}>
                            Loading…
                          </span>
                        )}
                      </td>
                      <td className="chevron">
                        {isOpen && (
                          <button type="button" className="icon-btn" onClick={() => setClosingShift(reading)}>
                            Close shift
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="footnote">
              Staff not in the current active-staff directory show a truncated id instead of a name.
            </div>
          </div>
        )}

        {openingShift && (
          <OpenShiftModal
            staff={staff}
            nozzles={nozzles}
            currentStaff={currentStaff}
            onClose={() => setOpeningShift(false)}
            onSaved={handleShiftSaved}
          />
        )}
        {closingShift && (
          <CloseShiftModal reading={closingShift} onClose={() => setClosingShift(null)} onSaved={handleShiftSaved} />
        )}
      </div>
    </>
  );
}
