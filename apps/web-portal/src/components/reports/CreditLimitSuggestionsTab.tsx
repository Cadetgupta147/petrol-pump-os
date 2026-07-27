import { useEffect, useState } from 'react';
import { getCreditLimitSuggestions } from '../../api/creditLimitSuggestions';
import { updateCustomer } from '../../api/customers';
import { StatusBadge, type StatusTone } from '../common/StatusBadge';
import { ApiError } from '../../api/client';
import { formatRupees, formatDateTime } from '../../utils/format';
import { useAuth } from '../../context/useAuth';
import type { CreditLimitSuggestedAction, CreditLimitSuggestionsReport } from '../../api/types';

// GET /credit-limit-suggestions — Section 17.25. TRANSPARENT RULE, NEVER
// AUTO-APPLIED: every row shows the reasoning behind its suggestion, and
// "Apply" is a real PATCH /customers/:id an Owner/Accountant explicitly
// triggers per row — there is no bulk-apply and no background job that acts
// on this report. Money-touching — human-reviewed before merge per
// CLAUDE.md.
const ACTION_LABEL: Record<CreditLimitSuggestedAction, string> = {
  INCREASE: 'Increase',
  NO_CHANGE: 'No change',
  FREEZE_OR_REDUCE: 'Freeze / reduce',
};

const ACTION_TONE: Record<CreditLimitSuggestedAction, StatusTone> = {
  INCREASE: 'good',
  NO_CHANGE: 'neutral',
  FREEZE_OR_REDUCE: 'critical',
};

export function CreditLimitSuggestionsTab() {
  const { staff } = useAuth();
  const canApply = staff?.role === 'OWNER' || staff?.role === 'ACCOUNTANT';

  const [report, setReport] = useState<CreditLimitSuggestionsReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [appliedIds, setAppliedIds] = useState<Set<string>>(new Set());

  function load() {
    getCreditLimitSuggestions()
      .then((result) => {
        setReport(result);
        setError(null);
      })
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : "Can't reach the backend.");
      });
  }

  useEffect(() => {
    let cancelled = false;
    getCreditLimitSuggestions()
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

  async function handleApply(customerId: string, suggestedLimit: number) {
    setApplyError(null);
    setApplyingId(customerId);
    try {
      await updateCustomer(customerId, { creditLimit: suggestedLimit });
      setAppliedIds((prev) => new Set(prev).add(customerId));
    } catch (err) {
      setApplyError(err instanceof ApiError ? err.message : "Can't reach the backend.");
    } finally {
      setApplyingId(null);
    }
  }

  if (error) return <div className="error-box">{error}</div>;
  if (!report) return <div className="loading">Loading credit limit suggestions…</div>;

  return (
    <div>
      <div className="banner">
        <strong>Suggestion only, never auto-applied:</strong> uses each customer&rsquo;s CURRENT aging
        status (not a historical count of late payments — this schema has no per-bill settlement-date
        tracking to compute that from). An Owner/Accountant reviews every row and applies it
        explicitly, or ignores it.
      </div>
      <div className="section-note" style={{ marginBottom: 14 }}>
        as of {formatDateTime(report.asOf)}
      </div>

      {applyError && <div className="error-box">{applyError}</div>}

      {report.suggestions.length === 0 ? (
        <div className="empty-box">No customers have ever used credit.</div>
      ) : (
        <div className="table-card">
          <table className="data-table">
            <thead>
              <tr>
                <th>Customer</th>
                <th className="num">Current limit</th>
                <th className="num">Outstanding</th>
                <th>Suggestion</th>
                <th className="num">Suggested limit</th>
                <th>Reasoning</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {report.suggestions.map((row) => {
                const applied = appliedIds.has(row.customerId);
                const noOp = row.action === 'NO_CHANGE' || row.suggestedLimit === row.currentLimit;
                return (
                  <tr key={row.customerId}>
                    <td>{row.customerName}</td>
                    <td className="num">{formatRupees(row.currentLimit)}</td>
                    <td className="num">{formatRupees(row.totalOutstanding)}</td>
                    <td>
                      <StatusBadge tone={ACTION_TONE[row.action]} label={ACTION_LABEL[row.action]} />
                    </td>
                    <td className="num">{formatRupees(row.suggestedLimit)}</td>
                    <td className="footnote">{row.reasoning}</td>
                    <td className="chevron">
                      {canApply && !noOp && (
                        <button
                          type="button"
                          className="icon-btn"
                          onClick={() => {
                            void handleApply(row.customerId, row.suggestedLimit);
                          }}
                          disabled={applyingId === row.customerId || applied}
                        >
                          {applied ? 'Applied' : applyingId === row.customerId ? 'Applying…' : 'Apply'}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <button
        type="button"
        className="btn-secondary"
        style={{ marginTop: 12 }}
        onClick={() => {
          setAppliedIds(new Set());
          load();
        }}
      >
        Refresh
      </button>
    </div>
  );
}
