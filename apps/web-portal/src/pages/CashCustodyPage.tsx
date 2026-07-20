import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { TopBar } from '../components/layout/TopBar';
import { NavBar } from '../components/layout/NavBar';
import { createCashCustodyLog, getCashCustodyReport } from '../api/cashCustody';
import { getSalesSummary } from '../api/dashboard';
import { getStaffList } from '../api/staff';
import { ApiError } from '../api/client';
import { useAuth } from '../context/useAuth';
import { formatRupees, todayIsoDate } from '../utils/format';
import type { CashCustodyLog, CashCustodyReportRow, StaffListItem } from '../api/types';

// Server-side epsilon (BALANCE_EPSILON in cash-custody.service.ts) — mirrored
// here ONLY so the live indicator agrees with what the backend will actually
// accept. This is UX only; CashCustodyService.create() re-validates both
// rules server-side regardless of what this page shows (CLAUDE.md: never
// trust the frontend to enforce this).
const EPSILON = 0.01;

function toNumber(value: string): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

// Section 8 — Day-end cash reconciliation entry (Section 8.1 steps 1 + 2 in
// one form, mirroring how CreateCashCustodyLogDto combines them). This is
// money-custody logic (CLAUDE.md: human review flag before merge) —
// correctness of the two live-validated rules below matters more than
// polish.
//
// Role gating: POST /cash-custody allows Owner/Accountant/Manager/DSM
// (everyone except Read-only) — the form below is hidden for Read-only, but
// that's cosmetic; CashCustodyController.create() is the real enforcement.
export function CashCustodyPage() {
  const { staff } = useAuth();
  const canSubmit = staff?.role !== 'READ_ONLY';

  const [date, setDate] = useState(todayIsoDate());
  // Defaults to the logged-in user's own staff id (self-entry, the common
  // case — an Owner/Accountant/Manager/DSM closing out their own day), but
  // is now a real dropdown backed by GET /staff (active staff, id+name)
  // rather than free text — see StaffController (apps/backend/src/staff).
  const [handledById, setHandledById] = useState(staff?.id ?? '');
  const [staffList, setStaffList] = useState<StaffListItem[] | null>(null);
  const [staffListError, setStaffListError] = useState<string | null>(null);
  const [totalCashCollected, setTotalCashCollected] = useState('');
  const [depositedToBank, setDepositedToBank] = useState('');
  const [keptInLocker, setKeptInLocker] = useState('');
  const [takenHome, setTakenHome] = useState('');
  const [broughtBackToday, setBroughtBackToday] = useState('0');

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [savedLog, setSavedLog] = useState<CashCustodyLog | null>(null);

  // Context: the per-person outstanding report, used ONLY to display
  // "here's what this person owes from before" while typing — never sent to
  // the server. CashCustodyService.create() re-resolves
  // cumulativeOutstandingBeforeToday itself from the DB at submit time, so a
  // stale/missing value here can only ever make the live hint wrong, never
  // the actual saved row.
  const [reportRows, setReportRows] = useState<CashCustodyReportRow[] | null>(null);
  const [reportError, setReportError] = useState<string | null>(null);

  // Convenience prefill for totalCashCollected — GET /dashboard/sales-summary
  // only computes the SERVER's "today" with no date param (see
  // dashboard.service.ts), so this can only ever suggest a value when the
  // selected date is today, and only for roles allowed to call it
  // (Owner/Accountant — DSM/Manager get a 403, handled as "no suggestion
  // available", not an error).
  const [suggestedCash, setSuggestedCash] = useState<number | null>(null);
  const [suggestionUnavailable, setSuggestionUnavailable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getStaffList()
      .then((list) => {
        if (!cancelled) setStaffList(list);
      })
      .catch((err) => {
        if (!cancelled) {
          setStaffListError(
            err instanceof ApiError
              ? `Staff list unavailable: ${err.message}`
              : "Staff list unavailable — can't reach the backend.",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    getCashCustodyReport()
      .then((rows) => {
        if (!cancelled) setReportRows(rows);
      })
      .catch((err) => {
        if (!cancelled) {
          setReportError(
            err instanceof ApiError
              ? `Outstanding-balance context unavailable: ${err.message}`
              : "Outstanding-balance context unavailable — can't reach the backend.",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    getSalesSummary()
      .then((summary) => {
        if (!cancelled) setSuggestedCash(Math.max(0, summary.byPaymentType.CASH));
      })
      .catch(() => {
        if (!cancelled) setSuggestionUnavailable(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const isToday = date === todayIsoDate();

  const total = toNumber(totalCashCollected);
  const splitSum = toNumber(depositedToBank) + toNumber(keptInLocker) + toNumber(takenHome);
  const splitDiff = total - splitSum;
  const splitBalanced = Math.abs(splitDiff) <= EPSILON;

  const outstandingRow = reportRows?.find((r) => r.staffId === handledById.trim());
  // null = "we don't know" (report still loading, or this role can't view
  // it) — treated as "can't check yet", not as zero, so the live hint never
  // falsely claims a clean bill of health.
  const knownOutstanding: number | null = reportRows
    ? (outstandingRow?.currentOutstanding ?? 0)
    : null;
  const broughtBackNum = toNumber(broughtBackToday);
  const broughtBackValid =
    knownOutstanding === null || broughtBackNum - knownOutstanding <= EPSILON;

  const canAttemptSubmit =
    canSubmit &&
    !submitting &&
    date.trim() !== '' &&
    handledById.trim() !== '' &&
    totalCashCollected.trim() !== '' &&
    splitBalanced &&
    broughtBackValid;

  function applySuggestedCash() {
    if (suggestedCash !== null) {
      setTotalCashCollected(String(suggestedCash));
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitError(null);
    setSavedLog(null);
    setSubmitting(true);
    try {
      const saved = await createCashCustodyLog({
        date,
        totalCashCollected: total,
        depositedToBank: toNumber(depositedToBank),
        keptInLocker: toNumber(keptInLocker),
        takenHome: toNumber(takenHome),
        handledById: handledById.trim(),
        broughtBackToday: broughtBackNum,
      });
      setSavedLog(saved);
      // Reset the day's figures but keep date/handledById — filing the next
      // person's entry for the same day is a common follow-on action.
      setTotalCashCollected('');
      setDepositedToBank('');
      setKeptInLocker('');
      setTakenHome('');
      setBroughtBackToday('0');
      // Refresh context so the next entry (or a re-check of this one) sees
      // the fresh outstanding balance, if this role can view it at all.
      getCashCustodyReport()
        .then(setReportRows)
        .catch(() => undefined);
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.message : "Can't reach the backend.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <TopBar />
      <NavBar />
      <div className="content">
        <div className="content-header">
          <div className="section-title">
            <h3>Day-end cash reconciliation</h3>
            <span className="section-note">
              POST /cash-custody — deposited to bank + kept in locker + taken home must equal
              total cash collected (Section 8.1)
            </span>
          </div>
          <div className="content-header-right">
            <Link to="/cash-custody/status" className="btn-secondary">
              View custody status report &rsaquo;
            </Link>
          </div>
        </div>

        {!canSubmit && (
          <div className="banner">
            Read-only accounts cannot file a day-end cash entry (Section 2) — this is enforced by
            the backend regardless of what this page shows.
          </div>
        )}

        {reportError && <div className="section-note">{reportError}</div>}

        {canSubmit && (
          <form className="section" onSubmit={(e) => { void handleSubmit(e); }}>
            <div className="grid grid-2">
              <div className="form-field">
                <label htmlFor="cc-date">Date</label>
                <input
                  id="cc-date"
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  required
                />
              </div>
              <div className="form-field">
                <label htmlFor="cc-handled-by">Handled by</label>
                <select
                  id="cc-handled-by"
                  value={handledById}
                  onChange={(e) => setHandledById(e.target.value)}
                  required
                  disabled={!staffList}
                >
                  <option value="" disabled>
                    {staffList ? 'Select a staff member' : 'Loading staff list…'}
                  </option>
                  {staffList?.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
                {staffListError && <div className="card-sub">{staffListError}</div>}
              </div>
            </div>

            <div className="card" style={{ marginBottom: 14 }}>
              <div className="card-label">OUTSTANDING BEFORE TODAY (for the staff id above)</div>
              {knownOutstanding === null ? (
                <div className="card-sub">
                  Unknown — {reportError ? 'no permission to view the custody report for your role' : 'loading…'}. The
                  backend still enforces the real carry-forward amount on submit either way.
                </div>
              ) : (
                <>
                  <div className="card-value">{formatRupees(knownOutstanding)}</div>
                  {outstandingRow?.outstandingSinceDate && (
                    <div className="card-sub">
                      held since {new Date(outstandingRow.outstandingSinceDate).toLocaleDateString('en-IN')}
                      {' '}({outstandingRow.daysHeld} day{outstandingRow.daysHeld === 1 ? '' : 's'})
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="form-field">
              <label htmlFor="cc-total">Total cash collected (Rs.)</label>
              <input
                id="cc-total"
                type="number"
                min="0"
                step="0.01"
                value={totalCashCollected}
                onChange={(e) => setTotalCashCollected(e.target.value)}
                required
              />
              {isToday && suggestedCash !== null && (
                <div className="card-sub">
                  Suggested from today&rsquo;s cash bills (dashboard sales-summary): {formatRupees(suggestedCash)}
                  {' — '}
                  <button
                    type="button"
                    className="card-sub clickable"
                    style={{ display: 'inline', padding: 0 }}
                    onClick={applySuggestedCash}
                  >
                    use this value
                  </button>
                </div>
              )}
              {isToday && suggestionUnavailable && (
                <div className="card-sub">
                  Auto-fill unavailable for your role or the backend is unreachable — enter the
                  total manually.
                </div>
              )}
              {!isToday && (
                <div className="card-sub">
                  Auto-fill only works for today&rsquo;s date (the backend has no date-range
                  parameter on dashboard sales-summary) — enter the total manually for a backdated
                  entry.
                </div>
              )}
            </div>

            <div className="section-title">
              <h3>3-way split</h3>
              <span className="section-note">updates live as you type</span>
            </div>
            <div className="grid grid-3">
              <div className="form-field">
                <label htmlFor="cc-bank">Deposited to bank (Rs.)</label>
                <input
                  id="cc-bank"
                  type="number"
                  min="0"
                  step="0.01"
                  value={depositedToBank}
                  onChange={(e) => setDepositedToBank(e.target.value)}
                  required
                />
              </div>
              <div className="form-field">
                <label htmlFor="cc-locker">Kept in locker (Rs.)</label>
                <input
                  id="cc-locker"
                  type="number"
                  min="0"
                  step="0.01"
                  value={keptInLocker}
                  onChange={(e) => setKeptInLocker(e.target.value)}
                  required
                />
              </div>
              <div className="form-field">
                <label htmlFor="cc-home">Taken home (Rs.)</label>
                <input
                  id="cc-home"
                  type="number"
                  min="0"
                  step="0.01"
                  value={takenHome}
                  onChange={(e) => setTakenHome(e.target.value)}
                  required
                />
              </div>
            </div>

            <div className={`banner ${splitBalanced ? 'ok' : ''}`}>
              {splitBalanced
                ? `Balanced — deposited + locker + taken home = total cash collected (${formatRupees(total)})`
                : splitDiff > 0
                  ? `Off by ${formatRupees(splitDiff)} — the split is short of the total cash collected by this much`
                  : `Off by ${formatRupees(Math.abs(splitDiff))} — the split exceeds the total cash collected by this much`}
            </div>

            <div className="form-field">
              <label htmlFor="cc-brought-back">Cash brought back from home today (Rs.)</label>
              <input
                id="cc-brought-back"
                type="number"
                min="0"
                step="0.01"
                value={broughtBackToday}
                onChange={(e) => setBroughtBackToday(e.target.value)}
              />
              <div className="card-sub">
                Settles part (or all) of the outstanding balance shown above for this staff id — 0
                if nothing is owed or nothing is being brought back today.
              </div>
            </div>

            {!broughtBackValid && knownOutstanding !== null && (
              <div className="banner">
                Cannot exceed the {formatRupees(knownOutstanding)} outstanding for this staff id.
              </div>
            )}

            {submitError && <div className="form-error">{submitError}</div>}
            {savedLog && (
              <div className="banner ok">
                Saved — new outstanding balance for this staff id is {formatRupees(savedLog.newOutstanding)}.
              </div>
            )}

            <div className="modal-actions">
              <button type="submit" className="export-btn" disabled={!canAttemptSubmit}>
                {submitting ? 'Saving…' : 'Save day-end entry'}
              </button>
            </div>
          </form>
        )}
      </div>
    </>
  );
}
