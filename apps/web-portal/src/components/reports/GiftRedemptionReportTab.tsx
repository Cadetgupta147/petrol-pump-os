import { useEffect, useState } from 'react';
import { getGiftRedemptionReport } from '../../api/giftCatalog';
import { ApiError } from '../../api/client';
import type { GiftRedemptionReportRow } from '../../api/types';

// GET /gift-catalog/redemption-report — Section 12. Every catalog item
// (including never-redeemed and retired ones), already sorted
// most-redeemed-first server-side — don't re-sort.
export function GiftRedemptionReportTab() {
  const [rows, setRows] = useState<GiftRedemptionReportRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getGiftRedemptionReport()
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

  if (error) return <div className="error-box">{error}</div>;
  if (!rows) return <div className="loading">Loading gift redemption report…</div>;
  if (rows.length === 0) return <div className="empty-box">No gift catalog items configured yet.</div>;

  return (
    <div className="table-card">
      <table className="data-table">
        <thead>
          <tr>
            <th>Gift</th>
            <th className="num">Points required</th>
            <th className="num">Stock</th>
            <th>Status</th>
            <th className="num">Times redeemed</th>
            <th className="num">Total points spent</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.giftItemId}>
              <td>{row.giftName}</td>
              <td className="num">{row.pointsRequired}</td>
              <td className="num">{row.stockQuantity ?? 'Unlimited'}</td>
              <td>
                <span
                  className="badge"
                  style={{
                    background: row.activeFlag ? 'var(--green-bg)' : 'var(--red-bg)',
                    color: row.activeFlag ? 'var(--green)' : 'var(--red)',
                  }}
                >
                  {row.activeFlag ? 'Active' : 'Retired'}
                </span>
              </td>
              <td className="num">{row.timesRedeemed}</td>
              <td className="num">{row.totalPointsSpent.toLocaleString('en-IN')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
