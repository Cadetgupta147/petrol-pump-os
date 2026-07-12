import { PaymentDirection, PaymentType } from '@prisma/client';

// Section 5A — a Bill's payment breakdown is derived from its
// BillPaymentLine rows (paymentType + direction), never from a single field
// on Bill, because a bill can be split across multiple payment methods (and
// can include an OUT line, e.g. change given back on an overpaid UPI line).
//
// Shared by all three dashboard endpoints: the sales-summary payment-type
// split (aggregated across every bill in range) and the recent-bills list
// (aggregated per individual bill) both need "net IN - OUT, grouped by
// paymentType" — this is that one piece of rule-heavy logic, kept pure and
// unit-tested in isolation from Prisma/Nest.
export type PaymentLineLike = {
  paymentType: PaymentType;
  amount: number;
  direction: PaymentDirection;
};

export type PaymentTypeTotals = Record<PaymentType, number>;

const ZERO_TOTALS: PaymentTypeTotals = {
  CASH: 0,
  CARD: 0,
  UPI: 0,
  CREDIT: 0,
};

// Nets direction (IN adds, OUT subtracts) per paymentType across whatever
// set of BillPaymentLine rows is passed in — could be one bill's lines or
// every line across a whole day's bills, the caller decides the scope.
export function aggregateByPaymentType(
  lines: PaymentLineLike[],
): PaymentTypeTotals {
  const totals: PaymentTypeTotals = { ...ZERO_TOTALS };

  for (const line of lines) {
    const signedAmount =
      line.direction === 'OUT' ? -line.amount : line.amount;
    totals[line.paymentType] += signedAmount;
  }

  return totals;
}
