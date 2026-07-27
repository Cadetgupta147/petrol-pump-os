import { useEffect, useState, type FormEvent } from 'react';
import { getVehicleWiseSales } from '../../api/salesReports';
import { ApiError } from '../../api/client';
import { formatRupees, formatLitres, todayIsoDate } from '../../utils/format';
import type { VehicleWiseSalesReport } from '../../api/types';

// GET /reports/vehicle-wise-sales?from=&to= — Section 12. Bills with no
// vehicle on file (independently optional per Section 4's bill-entry
// validation rule) are grouped by customer name instead of dropped.
export function VehicleWiseSalesReportTab() {
  const [from, setFrom] = useState(todayIsoDate());
  const [to, setTo] = useState(todayIsoDate());
  const [report, setReport] = useState<VehicleWiseSalesReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function load(fromDate: string, toDate: string) {
    setLoading(true);
    setError(null);
    getVehicleWiseSales(fromDate, toDate)
      .then(setReport)
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : "Can't reach the backend.");
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    let cancelled = false;
    getVehicleWiseSales(todayIsoDate(), todayIsoDate())
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
            <label htmlFor="vws-from">From</label>
            <input id="vws-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} required />
          </div>
          <div className="form-field" style={{ marginBottom: 0 }}>
            <label htmlFor="vws-to">To</label>
            <input id="vws-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} required />
          </div>
        </div>
        <div className="content-header-right">
          <button type="submit" className="export-btn" disabled={loading}>
            {loading ? 'Loading…' : 'Load report'}
          </button>
        </div>
      </form>

      {error && <div className="error-box">{error}</div>}
      {!error && !report && <div className="loading">Loading vehicle-wise sales…</div>}

      {!error && report && (
        <>
          <div className="grid grid-2" style={{ marginBottom: 20 }}>
            <div className="card">
              <div className="card-label">TOTAL LITRES</div>
              <div className="card-value">{formatLitres(report.totalLitres)}</div>
            </div>
            <div className="card">
              <div className="card-label">TOTAL AMOUNT</div>
              <div className="card-value">{formatRupees(report.totalAmount)}</div>
            </div>
          </div>

          {report.rows.length === 0 ? (
            <div className="empty-box">No bills in this range.</div>
          ) : (
            <div className="table-card">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Vehicle</th>
                    <th>Customer</th>
                    <th className="num">Bills</th>
                    <th className="num">Litres</th>
                    <th className="num">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {report.rows.map((row, index) => (
                    <tr key={row.vehicleNumber ?? `no-vehicle-${index}`}>
                      <td>{row.vehicleNumber ?? '—'}</td>
                      <td>{row.customerName ?? '—'}</td>
                      <td className="num">{row.billCount}</td>
                      <td className="num">{formatLitres(row.totalLitres)}</td>
                      <td className="num">{formatRupees(row.totalAmount)}</td>
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
