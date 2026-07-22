import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { TopBar } from '../components/layout/TopBar';
import { NavBar } from '../components/layout/NavBar';
import { DateRangeTabs } from '../components/dashboard/DateRangeTabs';
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
import { downloadTallyExport } from '../api/tallyExport';
import { ApiError } from '../api/client';
import { formatRupees, formatLitres, formatRatePerLitre, isToday } from '../utils/format';
import type {
  SalesSummary,
  TankStock,
  RecentBill,
  CreditLimitAlert,
  MeterReading,
  MeterVariance,
  Bill,
} from '../api/types';

interface DashboardData {
  salesSummary: SalesSummary;
  tankStock: TankStock[];
  recentBills: RecentBill[];
  creditAlerts: CreditLimitAlert[];
  meterReadings: MeterReading[];
  todaysBills: Bill[];
  allBills: Bill[];
}

// GET /bills has no product-type filter or aggregation, and no date filter
// (see api/bills.ts) — this pulls every non-deleted bill ever entered just
// to compute today's petrol-vs-diesel split client-side. That's a real
// scaling problem on a pump with years of history; the honest fix is a
// backend endpoint that groups by productType server-side. Flagged in the
// footnote below rather than silently accepted.
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
// recently entered bill's rateApplied, across all bills already loaded for
// computeProductTotals above, not just today's.
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

// Distinct customers with a CREDIT+IN line today — the KPI's Rs. total comes
// from the server-aggregated sales-summary, but the "N customers" subtext
// needs per-bill detail that endpoint doesn't return.
function countCreditCustomersToday(bills: Bill[]): number {
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
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [varianceByReadingId, setVarianceByReadingId] = useState<Map<string, MeterVariance>>(new Map());
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [pendingReminderIds, setPendingReminderIds] = useState<Set<string>>(new Set());
  const [reminderError, setReminderError] = useState<string | null>(null);
  const [varianceCheckError, setVarianceCheckError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [salesSummary, tankStock, recentBills, creditAlerts, allMeterReadings, allBillsResult] =
          await Promise.all([
            getSalesSummary(),
            getTankStock(),
            getRecentBills(),
            getCreditAlerts(),
            getAllMeterReadings(),
            getAllBills(),
          ]);
        if (cancelled) return;
        const allBills = allBillsResult.bills;
        setData({
          salesSummary,
          tankStock,
          recentBills,
          creditAlerts,
          meterReadings: allMeterReadings.filter((r) => isToday(r.shiftStart)),
          todaysBills: allBills.filter((b) => isToday(b.timestamp)),
          allBills,
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
  }, []);

  // Variance can only be checked once a shift is closed (closingReading +
  // shiftEnd set) — see meter-readings.service.ts. Fetched in a second pass
  // once we know today's shifts, one request per closed shift.
  useEffect(() => {
    if (!data) return;
    const closedReadings = data.meterReadings.filter((r) => r.closingReading !== null);
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
  }, [data]);

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
      const today = new Date().toISOString().slice(0, 10);
      await downloadTallyExport(today, today);
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
          <div className="loading">Loading today&rsquo;s dashboard…</div>
        </div>
      </>
    );
  }

  const { salesSummary, tankStock, recentBills, meterReadings, todaysBills, allBills } = data;
  const productTotals = computeProductTotals(todaysBills);
  const topProducts = productTotals.slice(0, 3);
  const extraProductCount = productTotals.length - topProducts.length;
  const creditToday = Math.max(0, salesSummary.byPaymentType.CREDIT);
  const creditCustomersToday = countCreditCustomersToday(todaysBills);
  const latestRates = computeLatestRates(allBills);
  const kpiCount = topProducts.length + 2;
  const kpiGridClass = kpiCount >= 5 ? 'grid-5' : kpiCount === 4 ? 'grid-4' : 'grid-3';

  return (
    <>
      <TopBar />
      <NavBar />
      <div className="content">
        <div className="content-header">
          <DateRangeTabs />
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
              />
            ))}
            <KpiCard label="Total collection" value={formatRupees(salesSummary.totalAmount)} sub={`${formatLitres(salesSummary.totalLitres)} combined`} dotColor={DOT.blue} />
            <KpiCard
              label="Credit given today"
              value={formatRupees(creditToday)}
              sub={`${creditCustomersToday} customer${creditCustomersToday === 1 ? '' : 's'}`}
              dotColor={DOT.amber}
              background="var(--amber-bg)"
              borderColor="#f3d9be"
              valueColor="var(--amber)"
            />
          </div>
          <div className="footnote">
            Petrol/diesel split and per-litre rate chips above are computed here from every non-deleted bill ever
            entered (GET /bills has no date or product filter yet) — fine for now, but won&rsquo;t scale once bill
            history grows. &ldquo;Total collection&rdquo; comes from the server-aggregated /dashboard/sales-summary
            instead.
            {extraProductCount > 0 && ` (${extraProductCount} more product type${extraProductCount === 1 ? '' : 's'} not shown.)`}
          </div>
        </div>

        <div className="section">
          <div className="section-title">
            <h3>Payment collection</h3>
            <span className="section-note">today, derived from BillPaymentLine rows</span>
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
            <span className="section-note">today&rsquo;s shifts, meter vs billed</span>
          </div>
          {varianceCheckError && <div className="banner">{varianceCheckError}</div>}
          <NozzleReadingsTable readings={meterReadings} varianceByReadingId={varianceByReadingId} />
        </div>

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
            <h3>Not wired to a backend endpoint yet</h3>
          </div>
          <ComingSoon
            title="Loyalty, inventory &amp; operations"
            items={[
              'Loyalty points liability — LoyaltyConfig/LoyaltyTransaction exist in the schema, no service yet',
              'Tanker deliveries — PurchaseEntry exists in the schema, no service yet',
              'Lubricant sale — LubricantItem exists in the schema, no service yet',
              'Urea/DEF sale — no model yet',
              'Generator diesel used — no model yet',
              "Today's expenses — no model yet",
              'Salesman on duty — AttendanceLog exists in the schema, no service yet',
              'Machine testing/calibration — no model yet',
            ]}
          />
        </div>
      </div>
    </>
  );
}
