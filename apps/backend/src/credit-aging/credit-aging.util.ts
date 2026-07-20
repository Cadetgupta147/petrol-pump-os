// Section 12 — Credit Aging Report ("who owes how long — overdue buckets
// 0-15 / 15-30 / 30+ days").
//
// JUDGMENT CALL (not specified in docs/master-plan.md, same
// tone/format as cash-custody.service.ts's judgment-call comments): there is
// no explicit invoice-matching/ledger table in this schema — a `Payment` row
// is just "money received from this customer" (see Payment model in
// schema.prisma), with no field linking it to the specific Bill(s) it
// settles. CustomersService.ledger() already works around this for a SINGLE
// customer by keeping a running balance rather than per-invoice matching;
// an aging report can't get away with that, because "how long has this been
// owed" genuinely needs to know WHICH bill(s) are still open, not just the
// net total.
//
// Methodology chosen: FIFO aging — the standard convention real
// accounts-receivable ledgers use, and the most defensible default absent
// an explicit spec. Every bill's net CREDIT-line amount is treated as a new
// unpaid "slice" of debt, dated to that bill's timestamp. Every reduction
// (a Payment, or a bill-side net CREDIT OUT — e.g. a credit note/adjustment)
// is applied against the OLDEST still-open slice(s) first. A customer who
// owes for three old bills and pays enough to clear the oldest two is aged
// only on the third (newest) remaining bill — not on their oldest-ever bill
// date, and not "spread" proportionally across all three.
//
// Alternatives considered and rejected:
//   - LIFO (apply payments to the NEWEST bill first): some ERPs support
//     this as a configurable policy, but it's the less common default and
//     would make "who owes how long" read backwards for anyone used to a
//     standard AR aging report.
//   - Weighted-average age: mathematically defensible, but produces a
//     single blended "age" number that doesn't map onto discrete Section
//     12 buckets (0-15/15-30/30+) as cleanly as a real oldest-open-invoice
//     date does — and it's a much less common convention than FIFO for this
//     kind of report.
export const AGING_EPSILON = 0.01;

export interface CreditLedgerEvent {
  timestamp: Date;
  // Positive = increases what the customer owes (a bill's net CREDIT IN —
  // a purchase put on the tab). Negative = reduces it (a Payment, or a
  // bill's net CREDIT OUT — e.g. a credit note/adjustment).
  netCreditImpact: number;
}

export interface AgedSlice {
  originalTimestamp: Date;
  remainingAmount: number;
}

// FIFO-allocates every reduction (payment or credit note) against the
// oldest still-open slice(s) first. Returns only slices with a
// still-nonzero remaining balance, oldest first (the queue is only ever
// pushed to at the back and drained from the front, so insertion order is
// preserved for whatever remains).
export function computeFifoAgedSlices(
  events: CreditLedgerEvent[],
): AgedSlice[] {
  const sorted = [...events].sort(
    (a, b) => a.timestamp.getTime() - b.timestamp.getTime(),
  );

  const queue: AgedSlice[] = [];
  for (const event of sorted) {
    if (event.netCreditImpact > AGING_EPSILON) {
      queue.push({
        originalTimestamp: event.timestamp,
        remainingAmount: event.netCreditImpact,
      });
    } else if (event.netCreditImpact < -AGING_EPSILON) {
      let toApply = -event.netCreditImpact;
      while (toApply > AGING_EPSILON && queue.length > 0) {
        const oldest = queue[0];
        const applied = Math.min(oldest.remainingAmount, toApply);
        oldest.remainingAmount -= applied;
        toApply -= applied;
        if (oldest.remainingAmount <= AGING_EPSILON) {
          queue.shift();
        }
      }
      // If toApply is still > 0 here, the customer has paid/been credited
      // MORE than they were ever billed on credit (e.g. an overpayment).
      // That excess is silently dropped rather than producing a
      // negative-age slice or a negative bucket — an aging report has
      // nothing meaningful to say about a credit balance in the
      // CUSTOMER's favor; tracking a customer credit/overpayment balance
      // is a different concern than "who owes how long", out of scope here.
    }
  }

  return queue.filter((slice) => slice.remainingAmount > AGING_EPSILON);
}

export interface AgingBuckets {
  bucket0to15: number;
  bucket15to30: number;
  bucket30Plus: number;
  total: number;
}

// Section 12's exact buckets: 0-15 / 15-30 / 30+ days overdue, measured as
// of `asOf` against each slice's ORIGINAL bill date (FIFO already re-dates
// a slice to whichever underlying bill is still open, so this is always
// "how old is the oldest unpaid rupee", not the last-payment date).
// Boundaries: <=15 days -> 0-15 bucket, <=30 -> 15-30 bucket, >30 -> 30+.
export function bucketAgedSlices(
  slices: AgedSlice[],
  asOf: Date,
): AgingBuckets {
  const buckets: AgingBuckets = {
    bucket0to15: 0,
    bucket15to30: 0,
    bucket30Plus: 0,
    total: 0,
  };

  const msPerDay = 1000 * 60 * 60 * 24;
  for (const slice of slices) {
    const ageDays = (asOf.getTime() - slice.originalTimestamp.getTime()) / msPerDay;
    if (ageDays <= 15) {
      buckets.bucket0to15 += slice.remainingAmount;
    } else if (ageDays <= 30) {
      buckets.bucket15to30 += slice.remainingAmount;
    } else {
      buckets.bucket30Plus += slice.remainingAmount;
    }
    buckets.total += slice.remainingAmount;
  }

  return buckets;
}
