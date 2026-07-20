import { useEffect, useState } from 'react';
import { TopBar } from '../components/layout/TopBar';
import { NavBar } from '../components/layout/NavBar';
import { getVarianceReport } from '../api/tanks';
import { ApiError } from '../api/client';
import { formatLitres, formatSignedLitres, formatDateTime } from '../utils/format';
import type { VarianceReportRow } from '../api/types';

// Section 7.2 step 3 — the DIP variance report: system-calculated stock vs.
// the latest physical DIP stick reading per tank, flagged when
// |variance| exceeds the tolerance TanksService applies
// (DIP_VARIANCE_TOLERANCE_LITRES, returned per-row as toleranceLitres — a
// placeholder constant, not yet dealer-configurable). Read-only: recording a
// new DIP reading (POST /tanks/:id/dip-readings) isn't one of this task's
// four screens.
export function VarianceReportPage() {
  const [rows, setRows] = useState<VarianceReportRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getVarianceReport()
      .then((result) => {
        if (!cancelled) setRows(result);
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

  return (
    <>
      <TopBar />
      <NavBar />
      <div className="content">
        <div className="section-title">
          <h3>Stock variance report</h3>
          <span className="section-note">
            GET /tanks/variance-report — system stock vs. latest physical DIP (Section 7.2)
          </span>
        </div>

        {error && <div className="error-box">{error}</div>}
        {!error && !rows && <div className="loading">Loading variance report…</div>}
        {!error && rows && rows.length === 0 && (
          <div className="empty-box">No tanks configured yet.</div>
        )}
        {!error && rows && rows.length > 0 && (
          <div className="table-card">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th className="num">System stock</th>
                  <th className="num">Latest DIP reading</th>
                  <th className="num">Variance</th>
                  <th>Status</th>
                  <th>Recorded at</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const dip = row.latestDipReading;
                  return (
                    <tr key={row.tankId}>
                      <td>{row.productType}</td>
                      <td className="num">{formatLitres(row.currentStockLitres)}</td>
                      <td className="num">{dip ? formatLitres(dip.reading) : '—'}</td>
                      <td className="num">{dip ? formatSignedLitres(dip.variance) : '—'}</td>
                      <td>
                        {dip ? (
                          <span
                            className="badge"
                            style={{
                              background: dip.flagged ? 'var(--red-bg)' : 'var(--green-bg)',
                              color: dip.flagged ? 'var(--red)' : 'var(--green)',
                            }}
                          >
                            {dip.flagged
                              ? `Flagged — outside ±${row.toleranceLitres} L tolerance`
                              : 'OK — within tolerance'}
                          </span>
                        ) : (
                          <span
                            className="badge"
                            style={{ background: 'var(--amber-bg)', color: 'var(--amber)' }}
                          >
                            No DIP reading yet
                          </span>
                        )}
                      </td>
                      <td>{dip ? formatDateTime(dip.recordedAt) : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
