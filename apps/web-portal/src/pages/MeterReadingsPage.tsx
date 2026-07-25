import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { TopBar } from '../components/layout/TopBar';
import { NavBar } from '../components/layout/NavBar';
import { CloseShiftModal } from '../components/meterReadings/CloseShiftModal';
import { CorrectMeterReadingModal } from '../components/meterReadings/CorrectMeterReadingModal';
import { BatchCloseModal } from '../components/meterReadings/BatchCloseModal';
import { StatusBadge } from '../components/common/StatusBadge';
import { getAllMeterReadings, getMeterVariance } from '../api/meterReadings';
import { getStaffList } from '../api/staff';
import { getNozzles } from '../api/nozzles';
import { ApiError } from '../api/client';
import { useAuth } from '../context/useAuth';
import { formatLitres, formatSignedLitres, formatTime } from '../utils/format';
import type { MeterReading, MeterVariance, Nozzle, StaffListItem } from '../api/types';

type StatusFilter = 'all' | 'open' | 'closed';

// Local (not UTC) calendar-day key — the day picker below navigates by the
// browser's local calendar, same convention utils/format.ts's isToday() uses
// (see that function's comment on why UTC would be wrong here).
function localDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// input[type=date]'s value is a plain "YYYY-MM-DD" string with no timezone —
// `new Date("YYYY-MM-DD")` parses that as UTC midnight (a classic JS footgun
// that would silently shift the selected day near midnight in IST). Parsing
// the parts into the local-time Date constructor instead avoids that.
function parseLocalDateKey(key: string): Date {
  const [y, m, day] = key.split('-').map(Number);
  return new Date(y, m - 1, day);
}

// A meter reading can never legitimately exist for a date later than today
// — closing readings are always stamped with the real submission time (see
// batchClose()'s own comment), and the manual single-nozzle fallback's
// backdated shiftEnd is already blocked server-side from being in the
// future. This page's date picker is view-only, but there's still no point
// letting it browse into a day that can only ever be empty — computed fresh
// (not memoized) so it stays correct across a midnight rollover while the
// page is left open.
function todayKey(): string {
  return localDateKey(new Date());
}

// Section 3.3 — Meter Reading Management: view readings by shift/DSM/nozzle,
// the batch-close-all-nozzles flow (replaces the old separate "Open Shift"
// step — a nozzle's first shift, and its next one after each close, both
// auto-open server-side now, so there's nothing left to open manually here),
// a single-nozzle Close Shift fallback per row, and the litres-sold-vs-billed
// variance flag.
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

  // Section 3.3 view is scoped to one calendar day at a time (defaulting to
  // today), navigated via the date picker or the </> arrows beside it — see
  // the reference layout this was modeled after. "Shift" here is NOT a
  // stored field (MeterReading has no fixed shift-number column; a nozzle
  // can be opened/closed any number of times a day at whatever times staff
  // actually worked — see NozzleReadingsTable.tsx's "Real data note").
  // Instead it's derived client-side: each nozzle's shifts on the selected
  // day are numbered in chronological order, and the Shift dropdown below
  // picks which occurrence to show per nozzle.
  const [selectedDate, setSelectedDate] = useState(() => localDateKey(new Date()));
  const [selectedShift, setSelectedShift] = useState(1);

  const [closingShift, setClosingShift] = useState<MeterReading | null>(null);
  const [correctingShift, setCorrectingShift] = useState<MeterReading | null>(null);
  const [batchClosing, setBatchClosing] = useState(false);
  const [tankWarning, setTankWarning] = useState<string | null>(null);

  const canCorrect = currentStaff?.role === 'OWNER' || currentStaff?.role === 'ACCOUNTANT';

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

  // Whenever the day changes, reset back to "Shift 1" right there at the
  // point of change (see selectDate()/shiftSelectedDate() below) rather than
  // in an effect — a shift index valid on one day (e.g. this nozzle's 3rd
  // shift) has no guaranteed meaning on another, so carrying it forward
  // would silently show an empty grid for no reason the dealer could see.
  function selectDate(dateKey: string) {
    // Clamp rather than reject — a native date picker's own calendar UI has
    // no way to show a "why not" message, so silently pinning to today is
    // the least surprising behavior for a future date typed or picked
    // directly (the max attribute below already keeps the calendar popover
    // itself from offering one).
    setSelectedDate(dateKey > todayKey() ? todayKey() : dateKey);
    setSelectedShift(1);
  }

  function shiftSelectedDate(deltaDays: number) {
    const d = parseLocalDateKey(selectedDate);
    d.setDate(d.getDate() + deltaDays);
    selectDate(localDateKey(d));
  }

  const readingsForSelectedDate = useMemo(() => {
    if (!readings) return [];
    return readings.filter((r) => localDateKey(new Date(r.shiftStart)) === selectedDate);
  }, [readings, selectedDate]);

  const { shiftOptions, readingsForSelectedShift } = useMemo(() => {
    const byNozzle = new Map<string, MeterReading[]>();
    for (const r of readingsForSelectedDate) {
      const bucket = byNozzle.get(r.nozzleId);
      if (bucket) bucket.push(r);
      else byNozzle.set(r.nozzleId, [r]);
    }
    let maxShiftsToday = 1;
    for (const bucket of byNozzle.values()) {
      bucket.sort((a, b) => new Date(a.shiftStart).getTime() - new Date(b.shiftStart).getTime());
      maxShiftsToday = Math.max(maxShiftsToday, bucket.length);
    }
    const picked: MeterReading[] = [];
    for (const bucket of byNozzle.values()) {
      const reading = bucket[selectedShift - 1];
      if (reading) picked.push(reading);
    }
    return {
      shiftOptions: Array.from({ length: maxShiftsToday }, (_, i) => i + 1),
      readingsForSelectedShift: picked,
    };
  }, [readingsForSelectedDate, selectedShift]);

  const filteredReadings = useMemo(() => {
    return readingsForSelectedShift.filter((r) => {
      if (staffFilter && r.staffId !== staffFilter) return false;
      if (nozzleFilter && r.nozzleId !== nozzleFilter) return false;
      if (statusFilter === 'open' && r.closingReading !== null) return false;
      if (statusFilter === 'closed' && r.closingReading === null) return false;
      return true;
    });
  }, [readingsForSelectedShift, staffFilter, nozzleFilter, statusFilter]);

  // The close-shift response can carry a tankWarning (Section 7.2's
  // auto-deduct silently skipped — no matching Tank for this product). Same
  // silent-drop mistake already flagged for Bill.loyaltyWarning
  // (docs/production-readiness.md finding B7) — surface it as a visible
  // banner here instead of discarding it.
  function handleShiftSaved(saved: MeterReading) {
    setClosingShift(null);
    setCorrectingShift(null);
    setTankWarning(saved.tankWarning ?? null);
    void load();
  }

  // Meter Reading redesign (Section 3.3) — the batch-close response is an
  // array (one per nozzle submitted), each optionally carrying its own
  // tankWarning — join every warning present rather than only ever showing
  // the first one, same non-silent-drop reasoning as handleShiftSaved()'s.
  function handleBatchSaved(updated: MeterReading[]) {
    setBatchClosing(false);
    const warnings = updated.map((reading) => reading.tankWarning).filter((w): w is string => Boolean(w));
    setTankWarning(warnings.length > 0 ? warnings.join(' ') : null);
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
          <button type="button" className="export-btn" onClick={() => setBatchClosing(true)}>
            Batch close all nozzles
          </button>
        </div>

        <div className="section">
          <div className="meter-date-shift-row">
            <div className="form-field" style={{ marginBottom: 0 }}>
              <label htmlFor="mr-date">Date</label>
              <div className="date-nav">
                <button
                  type="button"
                  className="date-nav-btn"
                  aria-label="Previous day"
                  onClick={() => shiftSelectedDate(-1)}
                >
                  <ChevronLeft size={16} />
                </button>
                <input
                  id="mr-date"
                  type="date"
                  value={selectedDate}
                  max={todayKey()}
                  onChange={(e) => selectDate(e.target.value)}
                />
                <button
                  type="button"
                  className="date-nav-btn"
                  aria-label="Next day"
                  onClick={() => shiftSelectedDate(1)}
                  disabled={selectedDate >= todayKey()}
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
            <div className="form-field" style={{ marginBottom: 0 }}>
              <label htmlFor="mr-shift">Shift</label>
              <select id="mr-shift" value={selectedShift} onChange={(e) => setSelectedShift(Number(e.target.value))}>
                {shiftOptions.map((n) => (
                  <option key={n} value={n}>
                    Shift {n}
                  </option>
                ))}
              </select>
            </div>
          </div>
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
                    {nozzle.label} &middot; {nozzle.item.name}
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
          <div className="empty-box">
            No meter reading shifts for Shift {selectedShift} on {selectedDate} match these filters.
          </div>
        )}

        {!error && readings && filteredReadings.length > 0 && (
          <div className="table-card">
            <table className="data-table gridded">
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
                      <td>{formatTime(reading.shiftStart)}</td>
                      <td>{reading.shiftEnd ? formatTime(reading.shiftEnd) : '—'}</td>
                      <td>{reading.nozzle.label}</td>
                      <td>{reading.productType ?? reading.nozzle.item.name}</td>
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
                      <td
                        className="num"
                        style={{
                          fontWeight: 700,
                          color: variance?.flagged
                            ? 'var(--red)'
                            : variance?.reconciliationPending
                              ? 'var(--amber)'
                              : 'var(--text-dark)',
                        }}
                      >
                        {variance ? formatSignedLitres(variance.variance) : '—'}
                      </td>
                      <td>
                        {isOpen ? (
                          <StatusBadge tone="warning" label="Shift open" />
                        ) : variance ? (
                          variance.flagged ? (
                            <StatusBadge tone="critical" label="Flagged" />
                          ) : variance.reconciliationPending ? (
                            <StatusBadge tone="warning" label="Walk-in not reconciled" />
                          ) : (
                            <StatusBadge tone="good" label="Within tolerance" />
                          )
                        ) : (
                          <StatusBadge tone="neutral" label="Loading…" />
                        )}
                      </td>
                      <td className="chevron">
                        {isOpen && (
                          <button type="button" className="icon-btn" onClick={() => setClosingShift(reading)}>
                            Close shift
                          </button>
                        )}
                        {!isOpen && canCorrect && (
                          <button type="button" className="icon-btn" onClick={() => setCorrectingShift(reading)}>
                            Correct
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

        {closingShift && (
          <CloseShiftModal
            reading={closingShift}
            currentStaff={currentStaff}
            onClose={() => setClosingShift(null)}
            onSaved={handleShiftSaved}
          />
        )}
        {correctingShift && (
          <CorrectMeterReadingModal
            reading={correctingShift}
            onClose={() => setCorrectingShift(null)}
            onSaved={handleShiftSaved}
          />
        )}
        {batchClosing && (
          <BatchCloseModal
            nozzles={nozzles}
            readings={readings ?? []}
            staff={staff}
            onClose={() => setBatchClosing(false)}
            onSaved={handleBatchSaved}
          />
        )}
      </div>
    </>
  );
}
