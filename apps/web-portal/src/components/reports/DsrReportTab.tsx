import { useEffect, useState, type FormEvent } from 'react';
import { getDailySalesReport } from '../../api/salesReports';
import { ApiError } from '../../api/client';
import { formatRupees, formatLitres, todayIsoDate } from '../../utils/format';
import type { DsrReport, StockProvenance } from '../../api/types';

const PROVENANCE_LABEL: Record<StockProvenance, string> = {
  MEASURED: 'Measured',
  COMPUTED: 'Computed',
  UNAVAILABLE: 'Unavailable',
};

const PROVENANCE_COLOR: Record<StockProvenance, string> = {
  MEASURED: '#1a7f37',
  COMPUTED: '#9a6700',
  UNAVAILABLE: '#8a8a8a',
};

function ProvenanceBadge({ provenance }: { provenance: StockProvenance }) {
  return (
    <span className="badge" style={{ background: PROVENANCE_COLOR[provenance], color: '#fff' }}>
      {PROVENANCE_LABEL[provenance]}
    </span>
  );
}

function stockCell(value: number | null, provenance: StockProvenance) {
  return (
    <>
      {value === null ? '—' : formatLitres(value)}
      <div className="card-sub">
        <ProvenanceBadge provenance={provenance} />
      </div>
    </>
  );
}

// GET /reports/dsr?date= — Section 12B. Single day only (a Day Book/DSR is
// inherently per-day) — see docs/master-plan.md Section 12B for why litres
// come from the meter reading rather than summing Bill + ShiftSalesSummary
// litres, and why stock-movement closing figures are tagged
// Measured/Computed/Unavailable instead of ever silently guessed.
export function DsrReportTab() {
  const [date, setDate] = useState(todayIsoDate());
  const [report, setReport] = useState<DsrReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function load(forDate: string) {
    setLoading(true);
    setError(null);
    getDailySalesReport(forDate)
      .then(setReport)
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : "Can't reach the backend.");
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    let cancelled = false;
    getDailySalesReport(todayIsoDate())
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
    load(date);
  }

  return (
    <div>
      <form className="content-header" onSubmit={handleSubmit}>
        <div className="form-field" style={{ marginBottom: 0, maxWidth: 220 }}>
          <label htmlFor="dsr-date">Date</label>
          <input id="dsr-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </div>
        <div className="content-header-right">
          <button type="submit" className="export-btn" disabled={loading}>
            {loading ? 'Loading…' : 'Load report'}
          </button>
        </div>
      </form>

      {error && <div className="error-box">{error}</div>}
      {!error && !report && <div className="loading">Loading DSR…</div>}

      {!error && report && (
        <>
          <div className="grid grid-2" style={{ marginBottom: 20 }}>
            <div className="card">
              <div className="card-label">CASH</div>
              <div className="card-value">{formatRupees(report.collections.cash)}</div>
            </div>
            <div className="card">
              <div className="card-label">CARD</div>
              <div className="card-value">{formatRupees(report.collections.card)}</div>
            </div>
            <div className="card">
              <div className="card-label">UPI</div>
              <div className="card-value">{formatRupees(report.collections.upi)}</div>
            </div>
            <div className="card">
              <div className="card-label">CREDIT</div>
              <div className="card-value">{formatRupees(report.collections.credit)}</div>
            </div>
          </div>

          <div className="card" style={{ marginBottom: 20 }}>
            <div className="card-label">SHORT / EXCESS</div>
            <div
              className="card-value"
              style={{ color: report.shortExcess < 0 ? '#c0392b' : undefined }}
            >
              {formatRupees(report.shortExcess)}
            </div>
            <div className="card-sub">Sum of walk-in shift variance for the date — itemized bills always balance</div>
          </div>

          <div className="section-title">
            <h3>Sales</h3>
            <span className="section-note">shift-wise litres and value, meter-derived</span>
          </div>
          {report.fuels.length === 0 ? (
            <div className="empty-box">No closed meter readings on this date.</div>
          ) : (
            report.fuels.map((fuel) => (
              <div className="table-card" key={fuel.productType} style={{ marginBottom: 16 }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th colSpan={3}>{fuel.productType}</th>
                    </tr>
                    <tr>
                      <th>Shift</th>
                      <th className="num">Litres</th>
                      <th className="num">Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fuel.shifts.map((shift) => (
                      <tr key={shift.shiftDefinitionId ?? 'unassigned'}>
                        <td>{shift.label}</td>
                        <td className="num">{formatLitres(shift.litres)}</td>
                        <td className="num">{shift.value === null ? '— (no rate configured)' : formatRupees(shift.value)}</td>
                      </tr>
                    ))}
                    <tr>
                      <td>
                        <strong>Total</strong>
                      </td>
                      <td className="num">
                        <strong>{formatLitres(fuel.totalLitres)}</strong>
                      </td>
                      <td className="num">
                        <strong>{formatRupees(fuel.totalValue)}</strong>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            ))
          )}

          <div className="section-title">
            <h3>Stock movement</h3>
            <span className="section-note">opening → receipts → sales → closing, per tank</span>
          </div>
          {report.stockMovement.length === 0 ? (
            <div className="empty-box">No tanks configured.</div>
          ) : (
            <div className="table-card">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Tank</th>
                    <th>Product</th>
                    <th className="num">Opening</th>
                    <th className="num">Receipts</th>
                    <th className="num">Sales</th>
                    <th className="num">Closing</th>
                  </tr>
                </thead>
                <tbody>
                  {report.stockMovement.map((row) => (
                    <tr key={row.tankId}>
                      <td>{row.tankNumber}</td>
                      <td>{row.productType}</td>
                      <td className="num">{stockCell(row.openingStock, row.openingStockProvenance)}</td>
                      <td className="num">{formatLitres(row.receipts)}</td>
                      <td className="num">{formatLitres(row.sales)}</td>
                      <td className="num">{stockCell(row.closingStock, row.closingStockProvenance)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
