import { useEffect, useState } from 'react';
import { getLoyaltyCostReport } from '../../api/loyalty';
import { ApiError } from '../../api/client';
import { formatRupees } from '../../utils/format';
import type { LoyaltyCostReport } from '../../api/types';

function formatPoints(value: number): string {
  return `${Math.round(value).toLocaleString('en-IN')} pts`;
}

// GET /loyalty/cost-report — Section 12. All-time balance-sheet-style
// snapshot (no date range) — see LoyaltyService.getCostReport()'s comment.
export function LoyaltyCostReportTab() {
  const [report, setReport] = useState<LoyaltyCostReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getLoyaltyCostReport()
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

  if (error) return <div className="error-box">{error}</div>;
  if (!report) return <div className="loading">Loading loyalty cost report…</div>;

  return (
    <div>
      <div className="grid grid-3" style={{ marginBottom: 20 }}>
        <div className="card">
          <div className="card-label">POINTS ISSUED (ALL-TIME)</div>
          <div className="card-value">{formatPoints(report.pointsIssued)}</div>
        </div>
        <div className="card">
          <div className="card-label">POINTS REDEEMED (ALL-TIME)</div>
          <div className="card-value">{formatPoints(report.pointsRedeemed)}</div>
        </div>
        <div className="card" style={{ background: 'var(--amber-bg)', borderColor: '#f3d9be' }}>
          <div className="card-label">POINTS OUTSTANDING — a real liability</div>
          <div className="card-value" style={{ color: 'var(--amber)' }}>
            {formatPoints(report.pointsOutstanding)}
          </div>
          {report.outstandingLiabilityValue !== null ? (
            <div className="card-sub">
              &asymp; {formatRupees(report.outstandingLiabilityValue)} at the configured cash-redemption
              ratio ({report.cashRedemptionRatio} Rs./pt) — a rough proxy, not a gift-sourcing cost
            </div>
          ) : (
            <div className="card-sub">
              Rupee-equivalent unavailable — no cash-redemption ratio configured in Loyalty settings
              yet
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-2">
        <div className="table-card">
          <div className="section-title">
            <h3>Cash redemptions</h3>
          </div>
          <table className="data-table">
            <tbody>
              <tr>
                <td>Redemption count</td>
                <td className="num">{report.redemptionBreakdown.cash.redemptionCount}</td>
              </tr>
              <tr>
                <td>Points redeemed</td>
                <td className="num">{formatPoints(report.redemptionBreakdown.cash.pointsRedeemed)}</td>
              </tr>
              <tr>
                <td>Cash value paid out</td>
                <td className="num">{formatRupees(report.redemptionBreakdown.cash.cashValuePaidOut)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="table-card">
          <div className="section-title">
            <h3>Gift redemptions</h3>
          </div>
          <table className="data-table">
            <tbody>
              <tr>
                <td>Redemption count</td>
                <td className="num">{report.redemptionBreakdown.gift.redemptionCount}</td>
              </tr>
              <tr>
                <td>Points redeemed</td>
                <td className="num">{formatPoints(report.redemptionBreakdown.gift.pointsRedeemed)}</td>
              </tr>
            </tbody>
          </table>
          <div className="footnote">
            No rupee cost figure here — GiftCatalogItem has no cost-price field in the schema (see
            LoyaltyService.getCostReport()&rsquo;s comment). See the gift redemption report tab for
            per-gift stock/popularity instead.
          </div>
        </div>
      </div>
    </div>
  );
}
