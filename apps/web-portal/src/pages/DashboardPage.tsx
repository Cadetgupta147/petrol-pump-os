import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Banknote, Fuel, Gift, Truck, Users, Wallet, ReceiptText, Zap } from 'lucide-react';
import { TopBar } from '../components/layout/TopBar';
import { NavBar } from '../components/layout/NavBar';
import { DateRangeTabs, type DateRangeTab } from '../components/dashboard/DateRangeTabs';
import { KpiCard } from '../components/dashboard/KpiCard';
import { PaymentCollection } from '../components/dashboard/PaymentCollection';
import { StockPanel } from '../components/dashboard/StockPanel';
import { NozzleReadingsTable } from '../components/dashboard/NozzleReadingsTable';
import { RecentBillsTable } from '../components/dashboard/RecentBillsTable';
import { AlertsPanel, type DashboardAlert } from '../components/dashboard/AlertsPanel';
import { ComingSoon } from '../components/dashboard/ComingSoon';
import { getSalesSummary, getTankStock, getRecentBills } from '../api/dashboard';
import { getCreditAlerts, updateCreditAlert } from '../api/creditAlerts';
import { getAllMeterReadings, getMeterVariance } from '../api/meterReadings';
import { getAllBills } from '../api/bills';
import { getLoyaltyCostReport } from '../api/loyalty';
import { getPurchaseEntries } from '../api/purchases';
import { getAttendanceLog } from '../api/attendance';
import { getExpenses } from '../api/expenses';
import { getGeneratorDieselLogs } from '../api/generatorDiesel';
import { downloadTallyExport } from '../api/tallyExport';
import { ApiError } from '../api/client';
import { formatRupees, formatLitres, formatRatePerLitre, localIsoDate, isToday } from '../utils/format';
import type {
  SalesSummary,
  TankStock,
  RecentBill,
  CreditLimitAlert,
  MeterReading,
  MeterVariance,
  Bill,
  LoyaltyCostReport,
  PurchaseEntry,
  AttendanceLogRow,
  ExpenseEntry,
  GeneratorDieselLog,
} from '../api/types';

interface DashboardData {
  salesSummary: SalesSummary;
  tankStock: TankStock[];
  recentBills: RecentBill[];
  creditAlerts: CreditLimitAlert[];
  rangeBills: Bill[];
}

const RANGE_LABELS: Record<DateRangeTab, string> = {
  today: "today's",
  yesterday: "yesterday's",
  week: "this week's",
  month: "this month's",
};

// Section 3.1 date-range tabs — resolves each tab into a concrete
// YYYY-MM-DD pair, in the browser's LOCAL calendar (see localIsoDate()'s own
// comment on why not toISOString()). "This week"/"This month" are
// week-to-date/month-to-date (start through today), not the full calendar
// period — a live dashboard has nothing useful to show for days that
// haven't happened yet. Monday is treated as the start of the week.
function resolveDateRange(tab: DateRangeTab): { from: string; to: string } {
  const now = new Date();
  const today = localIsoDate(now);

  if (tab === 'today') return { from: today, to: today };

  if (tab === 'yesterday') {
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    const key = localIsoDate(yesterday);
    return { from: key, to: key };
  }

  if (tab === 'week') {
    const dayOfWeek = now.getDay(); // 0 (Sun) .. 6 (Sat)
    const daysSinceMonday = (dayOfWeek + 6) % 7;
    const monday = new Date(now);
    monday.setDate(now.getDate() - daysSinceMonday);
    return { from: localIsoDate(monday), to: today };
  }

  const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  return { from: localIsoDate(firstOfMonth), to: today };
}

// Calendar-day (not exact-timestamp) membership check, comparing LOCAL
// dates — matches how MeterReadingsPage's own date picker already treats
// "which day does this shiftStart belong to" (see that page's localDateKey
// comment for the same UTC-vs-local reasoning).
function isWithinLocalRange(iso: string, from: string, to: string): boolean {
  const key = localIsoDate(new Date(iso));
  return key >= from && key <= to;
}

function computeProductTotals(bills: Bill[]): { productType: string; litres: number; amount: number }[] {
  const totals = new Map<string, { litres: number; amount: number }>();
  for (const bill of bills) {
    const existing = totals.get(bill.productType) ?? { litres: 0, amount: 0 };
    existing.litres += bill.litres;
    existing.amount += bill.amount;
    totals.set(bill.productType, existing);
  }
  return Array.from(totals.entries())
    .map(([productType, v]) => ({ productType, ...v }))
    .sort((a, b) => b.amount - a.amount);
}

// Rs./L chips in the sub-header aren't backed by a fuel-price/config entity
// (none exists in the schema) — derived here from each product's most
// recently entered bill's rateApplied. Deliberately fed ALL bills ever
// entered, not the range-scoped set below — the rate chips should always
// show the latest configured rate, even while viewing "Yesterday".
function computeLatestRates(bills: Bill[]): Map<string, number> {
  const latest = new Map<string, { rate: number; ts: number }>();
  for (const bill of bills) {
    const ts = new Date(bill.timestamp).getTime();
    const existing = latest.get(bill.productType);
    if (!existing || ts > existing.ts) {
      latest.set(bill.productType, { rate: bill.rateApplied, ts });
    }
  }
  const result = new Map<string, number>();
  for (const [productType, v] of latest) result.set(productType, v.rate);
  return result;
}

// Distinct customers with a CREDIT+IN line within the selected range — the
// KPI's Rs. total comes from the server-aggregated sales-summary, but the
// "N customers" subtext needs per-bill detail that endpoint doesn't return.
function countCreditCustomers(bills: Bill[]): number {
  const ids = new Set<string>();
  for (const bill of bills) {
    if (!bill.customerId) continue;
    const givenCredit = bill.paymentLines.some((l) => l.paymentType === 'CREDIT' && l.direction === 'IN');
    if (givenCredit) ids.add(bill.customerId);
  }
  return ids.size;
}

const DOT = {
  teal: 'var(--dot-teal)',
  blue: 'var(--dot-blue)',
  purple: 'var(--dot-purple)',
  amber: 'var(--dot-amber)',
  gray: 'var(--dot-gray)',
};

export function DashboardPage() {
  const navigate = useNavigate();
  const [rangeTab, setRangeTab] = useState<DateRangeTab>('today');
  const [rawMeterReadings, setRawMeterReadings] = useState<MeterReading[] | null>(null);
  const [allBillsForRates, setAllBillsForRates] = useState<Bill[]>([]);
  const [loyaltyCostReport, setLoyaltyCostReport] = useState<LoyaltyCostReport | null>(null);
  const [purchaseEntries, setPurchaseEntries] = useState<PurchaseEntry[] | null>(null);
  const [attendanceLog, setAttendanceLog] = useState<AttendanceLogRow[] | null>(null);
  const [expenseEntries, setExpenseEntries] = useState<ExpenseEntry[] | null>(null);
  const [generatorDieselLogs, setGeneratorDieselLogs] = useState<GeneratorDieselLog[] | null>(null);
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [varianceByReadingId, setVarianceByReadingId] = useState<Map<string, MeterVariance>>(new Map());
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [pendingReminderIds, setPendingReminderIds] = useState<Set<string>>(new Set());
  const [reminderError, setReminderError] = useState<string | null>(null);
  const [varianceCheckError, setVarianceCheckError] = useState<string | null>(null);

  const { from, to } = useMemo(() => resolveDateRange(rangeTab), [rangeTab]);

  // Fetched once, unaffected by the selected range: meter-reading volume per
  // nozzle/day is low enough that pulling everything once and filtering
  // client-side by range (meterReadings below) is reasonable — same scope
  // decision api/meterReadings.ts's own comment already documents. Bills for
  // the rate chips are deliberately NOT range-scoped either — see
  // computeLatestRates()'s comment.
  useEffect(() => {
    let cancelled = false;
    getAllMeterReadings()
      .then((result) => {
        if (!cancelled) setRawMeterReadings(result);
      })
      .catch(() => undefined);
    getAllBills()
      .then((result) => {
        if (!cancelled) setAllBillsForRates(result.bills);
      })
      .catch(() => undefined);
    // Each fetched independently, not folded into the main Promise.all below
    // — GET /loyalty/cost-report is Owner/Read-only only (Accountant is
    // excluded, unlike every other dashboard endpoint), so an Accountant
    // viewing this page must not have the whole dashboard fail just because
    // this one call 403s; the widget below simply doesn't render for them.
    getLoyaltyCostReport()
      .then((result) => {
        if (!cancelled) setLoyaltyCostReport(result);
      })
      .catch(() => undefined);
    getPurchaseEntries()
      .then((result) => {
        if (!cancelled) setPurchaseEntries(result);
      })
      .catch(() => undefined);
    getAttendanceLog()
      .then((result) => {
        if (!cancelled) setAttendanceLog(result);
      })
      .catch(() => undefined);
    getExpenses()
      .then((result) => {
        if (!cancelled) setExpenseEntries(result);
      })
      .catch(() => undefined);
    getGeneratorDieselLogs()
      .then((result) => {
        if (!cancelled) setGeneratorDieselLogs(result);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [salesSummary, tankStock, recentBills, creditAlerts, rangeBillsResult] = await Promise.all([
          getSalesSummary(from, to),
          getTankStock(),
          getRecentBills(),
          getCreditAlerts(),
          getAllBills({ from, to }),
        ]);
        if (cancelled) return;
        setData({
          salesSummary,
          tankStock,
          recentBills,
          creditAlerts,
          rangeBills: rangeBillsResult.bills,
        });
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : "Can't reach the backend — check it's running and VITE_API_BASE_URL is correct.");
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [from, to]);

  // Range-scoped view of the once-fetched meter readings — see the mount
  // effect's comment above.
  const meterReadings = useMemo(() => {
    if (!rawMeterReadings) return [];
    return rawMeterReadings.filter((r) => isWithinLocalRange(r.shiftStart, from, to));
  }, [rawMeterReadings, from, to]);

  // Tanker deliveries — GET /purchase-entries has no date filter server-side
  // (PurchasesService.findAll() returns everything), so this is scoped to
  // the selected range the same client-side way meterReadings above is.
  const deliveriesInRange = useMemo(() => {
    if (!purchaseEntries) return [];
    return purchaseEntries.filter((p) => isWithinLocalRange(p.createdAt, from, to));
  }, [purchaseEntries, from, to]);

  // "On duty" is a live, right-now snapshot (who currently has no clockOut
  // yet) — deliberately NOT scoped to the selected range, same reasoning as
  // the tank-stock snapshot and credit-limit alerts.
  const staffOnDuty = useMemo(() => {
    if (!attendanceLog) return [];
    return attendanceLog.filter((row) => row.clockOut === null);
  }, [attendanceLog]);

  // "Today" here, not the selected range tab — an owner glancing at this
  // widget wants "what did I spend today", regardless of which date-range
  // tab the rest of the dashboard happens to be on (mirrors staffOnDuty's
  // deliberately-not-range-scoped reasoning above).
  const todaysExpensesTotal = useMemo(() => {
    if (!expenseEntries) return 0;
    return expenseEntries
      .filter((e) => isToday(e.expenseDate))
      .reduce((sum, e) => sum + e.amount, 0);
  }, [expenseEntries]);

  const todaysGeneratorDieselLitres = useMemo(() => {
    if (!generatorDieselLogs) return 0;
    return generatorDieselLogs
      .filter((log) => isToday(log.recordedAt))
      .reduce((sum, log) => sum + log.quantityLitres, 0);
  }, [generatorDieselLogs]);

  // Variance can only be checked once a shift is closed (closingReading +
  // shiftEnd set) — see meter-readings.service.ts. Fetched in a second pass
  // once we know the selected range's shifts, one request per closed shift.
  useEffect(() => {
    const closedReadings = meterReadings.filter((r) => r.closingReading !== null);
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
  }, [meterReadings]);

  async function handleRequestReminder(alertId: string) {
    setReminderError(null);
    setPendingReminderIds((prev) => new Set(prev).add(alertId));
    try {
      const updated = await updateCreditAlert(alertId, true);
      setData((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          creditAlerts: prev.creditAlerts.map((a) => (a.id === alertId ? updated : a)),
        };
      });
    } catch (err) {
      setReminderError(err instanceof ApiError ? err.message : 'Could not request reminder.');
    } finally {
      setPendingReminderIds((prev) => {
        const next = new Set(prev);
        next.delete(alertId);
        return next;
      });
    }
  }

  const alerts = useMemo<DashboardAlert[]>(() => {
    if (!data) return [];
    const list: DashboardAlert[] = [];

    for (const tank of data.tankStock) {
      const pct = tank.capacityLitres > 0 ? (tank.currentStockLitres / tank.capacityLitres) * 100 : 0;
      if (pct < 45) {
        list.push({
          id: `tank-low-${tank.id}`,
          title: `${tank.productType} tank below 45% (display-only threshold, not a stored setting)`,
          sub: `${formatLitres(tank.currentStockLitres)} of ${formatLitres(tank.capacityLitres)}`,
          severity: 'amber',
        });
      }
      if (tank.lastDipReading !== null && Math.abs(tank.lastDipReading - tank.currentStockLitres) > 100) {
        list.push({
          id: `tank-dip-${tank.id}`,
          title: `${tank.productType}: system stock vs physical DIP variance over 100 L`,
          severity: 'red',
        });
      }
    }

    for (const [readingId, variance] of varianceByReadingId) {
      if (variance.flagged) {
        list.push({
          id: `variance-${readingId}`,
          title: `Nozzle ${variance.nozzleLabel}: meter-vs-billed variance ${variance.variance > 0 ? '+' : ''}${variance.variance.toFixed(1)} L`,
          sub: `tolerance is ±${variance.toleranceLitres} L for this shift`,
          severity: 'red',
        });
      }
    }

    for (const alert of data.creditAlerts) {
      list.push({
        id: `credit-${alert.id}`,
        title: `${alert.customer.name} over credit limit`,
        sub: `${formatRupees(alert.overageAmount)} over — view customers`,
        severity: 'amber',
        onClick: () => navigate('/customers'),
        action: {
          label: 'Request reminder',
          pending: pendingReminderIds.has(alert.id),
          done: alert.reminderRequested === true,
          onClick: () => { void handleRequestReminder(alert.id); },
        },
      });
    }

    return list;
  }, [data, varianceByReadingId, navigate, pendingReminderIds]);

  async function handleExport() {
    setExportError(null);
    setExporting(true);
    try {
      await downloadTallyExport(from, to);
    } catch (err) {
      setExportError(err instanceof ApiError ? err.message : 'Export failed.');
    } finally {
      setExporting(false);
    }
  }

  if (error) {
    return (
      <>
        <TopBar />
        <NavBar />
        <div className="content">
          <div className="error-box">{error}</div>
        </div>
      </>
    );
  }

  if (!data) {
    return (
      <>
        <TopBar />
        <NavBar />
        <div className="content">
          <div className="loading">Loading dashboard…</div>
        </div>
      </>
    );
  }

  const { salesSummary, tankStock, recentBills, rangeBills } = data;
  const rangeLabel = RANGE_LABELS[rangeTab];
  const productTotals = computeProductTotals(rangeBills);
  const topProducts = productTotals.slice(0, 3);
  const extraProductCount = productTotals.length - topProducts.length;
  const creditForRange = Math.max(0, salesSummary.byPaymentType.CREDIT);
  const creditCustomersForRange = countCreditCustomers(rangeBills);
  const latestRates = computeLatestRates(allBillsForRates);
  const kpiCount = topProducts.length + 2;
  const kpiGridClass = kpiCount >= 5 ? 'grid-5' : kpiCount === 4 ? 'grid-4' : 'grid-3';

  return (
    <>
      <TopBar />
      <NavBar />
      <div className="content">
        <div className="content-header">
          <DateRangeTabs active={rangeTab} onChange={setRangeTab} />
          <div className="content-header-right">
            {latestRates.size > 0 && (
              <div className="rate-chips">
                {Array.from(latestRates.entries()).map(([productType, rate]) => (
                  <div className="rate-chip" key={productType}>
                    <div className="rate-chip-label">{productType.toUpperCase()}</div>
                    <div className="rate-chip-value">{formatRatePerLitre(rate)}</div>
                  </div>
                ))}
              </div>
            )}
            <button className="export-btn" onClick={() => { void handleExport(); }} disabled={exporting}>
              {exporting ? 'Exporting…' : 'Export to Tally ↓'}
            </button>
          </div>
        </div>
        {exportError && <div className="banner">{exportError}</div>}

        <div className="section">
          <div className={`grid ${kpiGridClass}`}>
            {topProducts.map((p) => (
              <KpiCard
                key={p.productType}
                label={`${p.productType} sale`}
                value={formatLitres(p.litres)}
                sub={formatRupees(p.amount)}
                dotColor={DOT.teal}
                icon={Fuel}
              />
            ))}
            <KpiCard
              label="Total collection"
              value={formatRupees(salesSummary.totalAmount)}
              sub={`${formatLitres(salesSummary.totalLitres)} combined`}
              dotColor={DOT.blue}
              icon={Banknote}
            />
            <KpiCard
              label={`Credit given ${rangeLabel}`}
              value={formatRupees(creditForRange)}
              sub={`${creditCustomersForRange} customer${creditCustomersForRange === 1 ? '' : 's'}`}
              dotColor={DOT.amber}
              icon={Wallet}
              background="var(--amber-bg)"
              borderColor="#f3d9be"
              valueColor="var(--amber)"
            />
          </div>
          <div className="footnote">
            Petrol/diesel split above is computed here from the selected range&rsquo;s bills (GET /bills?from=&amp;to=
            filters server-side; the per-product grouping itself is still done client-side). Rate chips instead use
            every non-deleted bill ever entered, regardless of the selected range, so the latest configured rate
            always shows. &ldquo;Total collection&rdquo; comes from the server-aggregated /dashboard/sales-summary.
            {extraProductCount > 0 && ` (${extraProductCount} more product type${extraProductCount === 1 ? '' : 's'} not shown.)`}
          </div>
        </div>

        <div className="section">
          <div className="section-title">
            <h3>Payment collection</h3>
            <span className="section-note">{rangeLabel}, derived from BillPaymentLine rows</span>
          </div>
          <PaymentCollection totals={salesSummary.byPaymentType} />
        </div>

        <div className="section">
          <div className="section-title">
            <h3>Stock &amp; deliveries</h3>
            <span className="section-note">system stock checked against physical DIP</span>
          </div>
          <div className="grid grid-2">
            <StockPanel tanks={tankStock} />
          </div>
        </div>

        <div className="section">
          <div className="section-title">
            <h3>Nozzle readings</h3>
            <span className="section-note">{rangeLabel} shifts, meter vs billed</span>
          </div>
          {varianceCheckError && <div className="banner">{varianceCheckError}</div>}
          <NozzleReadingsTable readings={meterReadings} varianceByReadingId={varianceByReadingId} />
        </div>

        {(loyaltyCostReport || purchaseEntries || attendanceLog) && (
          <div className="section">
            <div className="section-title">
              <h3>Loyalty, deliveries &amp; staff</h3>
              <span className="section-note">
                loyalty is an all-time snapshot; deliveries follow {rangeLabel} range; staff on duty is live
              </span>
            </div>
            <div className="grid grid-3">
              {loyaltyCostReport && (
                <KpiCard
                  label="Loyalty points outstanding"
                  value={`${Math.round(loyaltyCostReport.pointsOutstanding).toLocaleString('en-IN')} pts`}
                  sub={
                    loyaltyCostReport.outstandingLiabilityValue !== null
                      ? `${formatRupees(loyaltyCostReport.outstandingLiabilityValue)} liability`
                      : 'cash redemption ratio not set'
                  }
                  onSubClick={() => navigate('/reports')}
                  dotColor={DOT.purple}
                  icon={Gift}
                />
              )}
              {purchaseEntries && (
                <KpiCard
                  label={`Tanker deliveries ${rangeLabel}`}
                  value={`${deliveriesInRange.length} deliver${deliveriesInRange.length === 1 ? 'y' : 'ies'}`}
                  sub={`${formatLitres(deliveriesInRange.reduce((sum, p) => sum + p.quantityLitres, 0))} received`}
                  onSubClick={() => navigate('/purchases')}
                  dotColor={DOT.teal}
                  icon={Truck}
                />
              )}
              {attendanceLog && (
                <KpiCard
                  label="Staff on duty now"
                  value={`${staffOnDuty.length} clocked in`}
                  sub={staffOnDuty.length > 0 ? staffOnDuty.map((s) => s.staff.name).join(', ') : 'no one currently clocked in'}
                  onSubClick={() => navigate('/reports')}
                  dotColor={DOT.blue}
                  icon={Users}
                />
              )}
            </div>
          </div>
        )}

        <div className="section">
          <div className="grid grid-lopsided">
            <div>
              <div className="section-title">
                <h3>Recent bills</h3>
                <span className="section-note">most recent 20 overall, not filtered to today</span>
              </div>
              <RecentBillsTable bills={recentBills} />
            </div>
            <div>
              <div className="section-title">
                <h3>Alerts</h3>
                <span className="section-note">tank variance, nozzle variance &amp; credit limit</span>
              </div>
              {reminderError && <div className="banner">{reminderError}</div>}
              <AlertsPanel alerts={alerts} />
            </div>
          </div>
        </div>

        <div className="section">
          <div className="section-title">
            <h3>Inventory &amp; operations</h3>
            <span className="section-note">figures below are always &ldquo;today&rdquo;, not the selected range tab</span>
          </div>
          <div className="grid grid-3">
            <KpiCard
              label="Today's expenses"
              value={formatRupees(todaysExpensesTotal)}
              sub="view / add expenses"
              onSubClick={() => navigate('/expenses')}
              dotColor={DOT.amber}
              icon={ReceiptText}
            />
            <KpiCard
              label="Generator diesel used today"
              value={formatLitres(todaysGeneratorDieselLitres)}
              sub="view / add entries"
              onSubClick={() => navigate('/generator-diesel')}
              dotColor={DOT.teal}
              icon={Zap}
            />
          </div>
        </div>

        <div className="section">
          <div className="section-title">
            <h3>Not wired to a backend endpoint yet</h3>
          </div>
          <ComingSoon
            title="Inventory &amp; operations — genuinely unbuilt, not just unwired"
            items={[
              'Lubricant sale — LubricantItem exists in the schema (stock only, no sale-price/SKU fields), but zero service or controller exists anywhere for it',
              'Urea/DEF sale — no dedicated model; "Urea/AdBlue" only appears as an example Item Master product name, not a planned feature',
              'Machine testing/calibration — no model; Tank.calibrationChartRef is just a single reference-link string, not a testing-log entity',
            ]}
          />
        </div>
      </div>
    </>
  );
}
