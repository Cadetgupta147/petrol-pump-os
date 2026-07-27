// Section 5B — Credit Customer Outstanding Statement.
//
// Same FIFO allocation methodology as credit-aging.util.ts's
// computeFifoAgedSlices (a reduction — Payment, or a bill-side net CREDIT
// OUT/opening-balance correction — is applied against the OLDEST still-open
// slice(s) first), generalized to carry the ORIGINATING bill/opening-balance
// identity through instead of just a timestamp. credit-aging.util.ts only
// ever needed "how old is the oldest unpaid rupee" for a bucketed report; this
// feature needs to print the actual bill (vehicle/litres/rate) that rupee
// came from, so a bare timestamp isn't enough to reconstruct that — hence a
// separate (small) function here rather than reusing that one as-is.
export const OUTSTANDING_EPSILON = 0.01;

export interface OutstandingSource {
  kind: 'BILL' | 'OPENING_BALANCE';
  id: string;
}

export interface OutstandingLedgerEvent {
  timestamp: Date;
  // Positive = new money owed (a bill's net CREDIT-line amount, or a
  // positive opening balance) — must carry `source` so the slice can be
  // traced back to what generated it. Negative = a reduction (a Payment, or
  // a bill/opening-balance-side correction) — `source` is irrelevant here,
  // since a reduction never itself appears as a line on the statement.
  netCreditImpact: number;
  source?: OutstandingSource;
}

export interface OutstandingSlice {
  source: OutstandingSource;
  originalTimestamp: Date;
  remainingAmount: number;
}

export function computeOutstandingSlices(
  events: OutstandingLedgerEvent[],
): OutstandingSlice[] {
  const sorted = [...events].sort(
    (a, b) => a.timestamp.getTime() - b.timestamp.getTime(),
  );

  const queue: OutstandingSlice[] = [];
  for (const event of sorted) {
    if (event.netCreditImpact > OUTSTANDING_EPSILON) {
      // A positive-impact event with no source is a data-shape bug at the
      // call site (every BILL/OPENING_BALANCE event must be tagged) — skip
      // rather than throw, since a report should degrade, not 500, on an
      // unexpected row.
      if (!event.source) continue;
      queue.push({
        source: event.source,
        originalTimestamp: event.timestamp,
        remainingAmount: event.netCreditImpact,
      });
    } else if (event.netCreditImpact < -OUTSTANDING_EPSILON) {
      let toApply = -event.netCreditImpact;
      while (toApply > OUTSTANDING_EPSILON && queue.length > 0) {
        const oldest = queue[0];
        const applied = Math.min(oldest.remainingAmount, toApply);
        oldest.remainingAmount -= applied;
        toApply -= applied;
        if (oldest.remainingAmount <= OUTSTANDING_EPSILON) {
          queue.shift();
        }
      }
      // An overpayment (toApply still > 0) has nothing left to reduce —
      // same "silently dropped, not a negative slice" call as
      // credit-aging.util.ts makes, for the same reason: a statement of
      // OWED bills has nothing meaningful to say about a credit-in-the-
      // customer's-favor balance.
    }
  }

  return queue.filter((slice) => slice.remainingAmount > OUTSTANDING_EPSILON);
}
