// Section 17.25 — automated credit scoring, resolved as a TRANSPARENT
// RULE-BASED SUGGESTION, never an auto-applied change: this computes a
// suggested action + limit, an Owner/Accountant reviews it and applies (or
// ignores) it via the existing PATCH /customers/:id/loyalty-rate-override's
// sibling, the plain customer-edit flow — no new mutation endpoint exists
// here on purpose, so a credit-limit change always goes through the same
// auditable path it already does today (money-touching — human-reviewed
// before merge per CLAUDE.md).
//
// JUDGMENT CALL, flagged rather than silently picked: the originally
// proposed rule was framed around "N late payments in the last 90 days".
// This schema has no per-bill settlement-date tracking (Payment rows aren't
// linked to which Bill they settle — see credit-aging.util.ts's FIFO-aging
// writeup for the same underlying gap), so "count how many payments were
// late" isn't something a query can answer today; only CURRENT aging status
// (which buckets of currently-unpaid debt exist right now) is available,
// via CreditAgingService.getReport(). This uses that as the input signal
// instead — a snapshot of present risk, not a historical late-payment
// count — which is a materially different (and weaker) signal than what was
// originally described, documented here rather than silently substituted.
export type CreditLimitSuggestedAction = 'INCREASE' | 'NO_CHANGE' | 'FREEZE_OR_REDUCE';

export interface CreditLimitSuggestionInput {
  creditLimit: number;
  bucket15to30: number;
  bucket30Plus: number;
  totalOutstanding: number;
}

export interface CreditLimitSuggestion {
  action: CreditLimitSuggestedAction;
  suggestedLimit: number;
  reasoning: string;
}

const AGING_EPSILON = 0.01;
const INCREASE_FACTOR = 1.2; // +20%, matching the approved example rule

// Rounds to the nearest 100 — cosmetic only (a suggested limit of ₹12,347.6
// reads as an arbitrary computed artifact, not a real policy number). Not a
// business-rule decision, just presentation.
function roundToNearestHundred(value: number): number {
  return Math.round(value / 100) * 100;
}

export function computeCreditLimitSuggestion(
  input: CreditLimitSuggestionInput,
): CreditLimitSuggestion {
  const { creditLimit, bucket15to30, bucket30Plus, totalOutstanding } = input;

  if (bucket30Plus > AGING_EPSILON) {
    // Anything 30+ days overdue right now — the strongest available signal
    // of risk. Suggest capping the limit at whatever is currently
    // outstanding (no further headroom to extend) rather than an arbitrary
    // cut — if the existing limit is already below that, leave it as-is
    // rather than suggesting an INCREASE up to the outstanding amount.
    const suggestedLimit = Math.min(creditLimit, roundToNearestHundred(totalOutstanding));
    return {
      action: 'FREEZE_OR_REDUCE',
      suggestedLimit,
      reasoning: `₹${bucket30Plus.toFixed(0)} has been outstanding 30+ days — suggest capping the limit at current outstanding (no further headroom) until this clears.`,
    };
  }

  if (totalOutstanding > AGING_EPSILON) {
    // Some outstanding balance, but nothing yet past 30 days — a mixed
    // signal (could be a normal in-progress bill cycle, could be a customer
    // starting to slip), not clean enough for either an increase or a
    // freeze suggestion.
    return {
      action: 'NO_CHANGE',
      suggestedLimit: creditLimit,
      reasoning: bucket15to30 > AGING_EPSILON
        ? `₹${bucket15to30.toFixed(0)} is aging 15-30 days — not yet 30+, but not clean enough to suggest an increase.`
        : 'Outstanding balance is all within 15 days — normal in-progress billing, no change suggested.',
    };
  }

  if (creditLimit <= AGING_EPSILON) {
    // Nothing to scale a percentage increase from — suggesting 20% of 0 is
    // meaningless, and inventing a starting seed limit here would be
    // exactly the kind of undocumented number CLAUDE.md says not to guess.
    return {
      action: 'NO_CHANGE',
      suggestedLimit: creditLimit,
      reasoning: 'No existing credit limit to scale a percentage increase from — set an initial limit manually.',
    };
  }

  return {
    action: 'INCREASE',
    suggestedLimit: roundToNearestHundred(creditLimit * INCREASE_FACTOR),
    reasoning: 'No outstanding balance currently — clean standing, suggest a 20% limit increase.',
  };
}
