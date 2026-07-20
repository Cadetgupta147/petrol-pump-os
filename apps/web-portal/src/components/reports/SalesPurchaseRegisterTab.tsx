import { useEffect, useState, type FormEvent } from 'react';
import { getSalesPurchaseRegister } from '../../api/salesPurchaseRegister';
import { ApiError } from '../../api/client';
import { formatRupees, formatLitres, formatDateTime, todayIsoDate } from '../../utils/format';
import type { SalesPurchaseRegister } from '../../api/types';

// GET /sales-purchase-register?from=&to= — Section 12. NOT a real GST
// tax-rate breakup — see the taxModelingGap banner below, which must stay
// visible (not buried in a tooltip/footnote) per this slice's explicit
// requirement.
export function SalesPurchaseRegisterTab() {
  const [from, setFrom] = useState(todayIsoDate());
  const [to, setTo] = useState(todayIsoDate());
  const [report, setReport] = useState<SalesPurchaseRegister | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function load(fromDate: string, toDate: string) {
    setLoading(true);
    setError(null);
    getSalesPurchaseRegister(fromDate, toDate)
      .then(setReport)
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : "Can't reach the backend.");
      })
      .finally(() => setLoading(false));
  }

  // Load once on mount with today's date — subsequent loads are user-driven
  // via the form below (handleSubmit calls the shared load() helper, which
  // is fine to call from an event handler). The mount effect deliberately
  // does NOT call that shared helper (it calls setLoading synchronously),
  // fetching directly instead so no setState happens synchronously within
  // the effect body itself — only inside the .then/.catch callbacks, same
  // pattern as every other page's mount-fetch in this app (e.g.
  // VarianceReportPage).
  useEffect(() => {
    let cancelled = false;
    getSalesPurchaseRegister(todayIsoDate(), todayIsoDate())
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
            <label htmlFor="spr-from">From</label>
            <input id="spr-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} required />
          </div>
          <div className="form-field" style={{ marginBottom: 0 }}>
            <label htmlFor="spr-to">To</label>
            <input id="spr-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} required />
          </div>
        </div>
        <div className="content-header-right">
          <button type="submit" className="export-btn" disabled={loading}>
            {loading ? 'Loading…' : 'Load register'}
          </button>
        </div>
      </form>

      {error && <div className="error-box">{error}</div>}
      {!error && !report && <div className="loading">Loading sales/purchase register…</div>}

      {!error && report && (
        <>
          <div className="banner">
            <strong>Not a GST tax breakup:</strong> {report.taxModelingGap}
          </div>

          <div className="section">
            <div className="section-title">
              <h3>Sales register</h3>
              <span className="section-note">
                {formatDateTime(report.from)} to {formatDateTime(report.to)} &middot; totals:{' '}
                {formatLitres(report.salesTotals.quantityLitres)}, {formatRupees(report.salesTotals.amount)}
              </span>
            </div>
            {report.salesRegister.length === 0 ? (
              <div className="empty-box">No bills in this range.</div>
            ) : (
              <div className="table-card">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Party</th>
                      <th>Bill no.</th>
                      <th>Product</th>
                      <th className="num">Qty (L)</th>
                      <th className="num">Rate</th>
                      <th className="num">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.salesRegister.map((row) => (
                      <tr key={row.billNo}>
                        <td>{formatDateTime(row.date)}</td>
                        <td>{row.partyName}</td>
                        <td>{row.billNo}</td>
                        <td>{row.product}</td>
                        <td className="num">{formatLitres(row.quantityLitres)}</td>
                        <td className="num">{formatRupees(row.rate)}</td>
                        <td className="num">{formatRupees(row.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="section">
            <div className="section-title">
              <h3>Purchase register</h3>
              <span className="section-note">
                totals: {formatLitres(report.purchaseTotals.quantityLitres)},{' '}
                {formatRupees(report.purchaseTotals.amount)}
              </span>
            </div>
            {report.purchaseRegister.length === 0 ? (
              <div className="empty-box">No purchase entries in this range.</div>
            ) : (
              <div className="table-card">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Supplier</th>
                      <th>Invoice no.</th>
                      <th>Product</th>
                      <th className="num">Qty (L)</th>
                      <th className="num">Rate</th>
                      <th className="num">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.purchaseRegister.map((row, index) => (
                      <tr key={`${row.invoiceNo ?? 'no-invoice'}-${index}`}>
                        <td>{formatDateTime(row.date)}</td>
                        <td>{row.partyName}</td>
                        <td>{row.invoiceNo ?? '—'}</td>
                        <td>{row.product}</td>
                        <td className="num">{formatLitres(row.quantityLitres)}</td>
                        <td className="num">{formatRupees(row.rate)}</td>
                        <td className="num">{formatRupees(row.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
