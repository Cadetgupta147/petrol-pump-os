import { aggregateByPaymentType } from './payment-line-aggregation.util';

// Rule-heavy logic per CLAUDE.md testing guidance — this is the same
// "sum(IN) - sum(OUT), grouped by paymentType" rule that Section 5A's split
// payments rely on, reused here purely for read/reporting purposes.
describe('aggregateByPaymentType', () => {
  it('returns zero for every payment type when given no lines', () => {
    expect(aggregateByPaymentType([])).toEqual({
      CASH: 0,
      CARD: 0,
      UPI: 0,
      CREDIT: 0,
    });
  });

  it('nets a simple single-method IN payment', () => {
    const totals = aggregateByPaymentType([
      { paymentType: 'CASH', amount: 500, direction: 'IN' },
    ]);
    expect(totals).toEqual({ CASH: 500, CARD: 0, UPI: 0, CREDIT: 0 });
  });

  it('nets a bill split across CASH and UPI (partial cash + partial UPI)', () => {
    const totals = aggregateByPaymentType([
      { paymentType: 'CASH', amount: 300, direction: 'IN' },
      { paymentType: 'UPI', amount: 200, direction: 'IN' },
    ]);
    expect(totals).toEqual({ CASH: 300, CARD: 0, UPI: 200, CREDIT: 0 });
  });

  it('subtracts an OUT line (change given back) from its payment type', () => {
    // Customer pays 500 by UPI against a 450 bill, gets 50 cash change back.
    const totals = aggregateByPaymentType([
      { paymentType: 'UPI', amount: 500, direction: 'IN' },
      { paymentType: 'CASH', amount: 50, direction: 'OUT' },
    ]);
    expect(totals).toEqual({ CASH: -50, CARD: 0, UPI: 500, CREDIT: 0 });
  });

  it('aggregates across multiple bills/lines of the same payment type', () => {
    const totals = aggregateByPaymentType([
      { paymentType: 'CASH', amount: 100, direction: 'IN' },
      { paymentType: 'CASH', amount: 250, direction: 'IN' },
      { paymentType: 'CREDIT', amount: 400, direction: 'IN' },
      { paymentType: 'CREDIT', amount: 100, direction: 'OUT' },
    ]);
    expect(totals).toEqual({ CASH: 350, CARD: 0, UPI: 0, CREDIT: 300 });
  });

  it('handles a fully mixed split across all four payment types', () => {
    const totals = aggregateByPaymentType([
      { paymentType: 'CASH', amount: 100, direction: 'IN' },
      { paymentType: 'CARD', amount: 200, direction: 'IN' },
      { paymentType: 'UPI', amount: 150, direction: 'IN' },
      { paymentType: 'CREDIT', amount: 50, direction: 'IN' },
    ]);
    expect(totals).toEqual({ CASH: 100, CARD: 200, UPI: 150, CREDIT: 50 });
  });
});
