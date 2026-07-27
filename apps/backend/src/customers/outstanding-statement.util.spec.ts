import { computeOutstandingSlices, OutstandingLedgerEvent } from './outstanding-statement.util';

// Section 5B — Credit Customer Outstanding Statement. Rule-heavy money logic
// (CLAUDE.md: write tests for this category) — same FIFO methodology as
// credit-aging.util.ts's computeFifoAgedSlices, but this suite additionally
// covers that bill/opening-balance IDENTITY survives allocation correctly
// (the whole reason this is a separate function).
describe('computeOutstandingSlices', () => {
  const day = (n: number) => new Date(`2026-01-${String(n).padStart(2, '0')}T00:00:00Z`);

  it('a single unpaid bill produces a single slice carrying that bill\'s id', () => {
    const slices = computeOutstandingSlices([
      { timestamp: day(1), netCreditImpact: 1000, source: { kind: 'BILL', id: 'bill-1' } },
    ]);

    expect(slices).toEqual([
      { source: { kind: 'BILL', id: 'bill-1' }, originalTimestamp: day(1), remainingAmount: 1000 },
    ]);
  });

  it('a payment fully clearing one bill leaves no slices', () => {
    const slices = computeOutstandingSlices([
      { timestamp: day(1), netCreditImpact: 1000, source: { kind: 'BILL', id: 'bill-1' } },
      { timestamp: day(5), netCreditImpact: -1000 },
    ]);

    expect(slices).toEqual([]);
  });

  it('applies a partial payment against the OLDEST bill first, keeping both bills\' identities distinct', () => {
    const slices = computeOutstandingSlices([
      { timestamp: day(1), netCreditImpact: 1000, source: { kind: 'BILL', id: 'bill-old' } },
      { timestamp: day(10), netCreditImpact: 500, source: { kind: 'BILL', id: 'bill-new' } },
      { timestamp: day(15), netCreditImpact: -700 },
    ]);

    expect(slices).toEqual([
      { source: { kind: 'BILL', id: 'bill-old' }, originalTimestamp: day(1), remainingAmount: 300 },
      { source: { kind: 'BILL', id: 'bill-new' }, originalTimestamp: day(10), remainingAmount: 500 },
    ]);
  });

  it('a payment large enough to clear the oldest bill spills over into the next-oldest', () => {
    const slices = computeOutstandingSlices([
      { timestamp: day(1), netCreditImpact: 1000, source: { kind: 'BILL', id: 'bill-1' } },
      { timestamp: day(10), netCreditImpact: 500, source: { kind: 'BILL', id: 'bill-2' } },
      { timestamp: day(15), netCreditImpact: -1200 },
    ]);

    expect(slices).toEqual([
      { source: { kind: 'BILL', id: 'bill-2' }, originalTimestamp: day(10), remainingAmount: 300 },
    ]);
  });

  it('an opening balance behaves exactly like a bill for FIFO purposes, but keeps its own kind/id', () => {
    const slices = computeOutstandingSlices([
      { timestamp: day(1), netCreditImpact: 2000, source: { kind: 'OPENING_BALANCE', id: 'ob-1' } },
      { timestamp: day(10), netCreditImpact: 1000, source: { kind: 'BILL', id: 'bill-1' } },
      { timestamp: day(20), netCreditImpact: -2500 },
    ]);

    expect(slices).toEqual([
      { source: { kind: 'BILL', id: 'bill-1' }, originalTimestamp: day(10), remainingAmount: 500 },
    ]);
  });

  it('events are FIFO-ordered by timestamp regardless of input array order', () => {
    const slices = computeOutstandingSlices([
      { timestamp: day(10), netCreditImpact: 500, source: { kind: 'BILL', id: 'bill-new' } },
      { timestamp: day(15), netCreditImpact: -1000 },
      { timestamp: day(1), netCreditImpact: 1000, source: { kind: 'BILL', id: 'bill-old' } },
    ]);

    expect(slices).toEqual([
      { source: { kind: 'BILL', id: 'bill-new' }, originalTimestamp: day(10), remainingAmount: 500 },
    ]);
  });

  it('an overpayment beyond total credit billed is dropped, not turned into a negative slice', () => {
    const slices = computeOutstandingSlices([
      { timestamp: day(1), netCreditImpact: 500, source: { kind: 'BILL', id: 'bill-1' } },
      { timestamp: day(5), netCreditImpact: -800 },
    ]);

    expect(slices).toEqual([]);
  });

  it('amounts within OUTSTANDING_EPSILON of zero are treated as fully settled', () => {
    const slices = computeOutstandingSlices([
      { timestamp: day(1), netCreditImpact: 1000, source: { kind: 'BILL', id: 'bill-1' } },
      { timestamp: day(5), netCreditImpact: -999.995 },
    ]);

    expect(slices).toEqual([]);
  });

  it('a positive-impact event with no source is skipped rather than throwing', () => {
    const events: OutstandingLedgerEvent[] = [
      { timestamp: day(1), netCreditImpact: 1000 }, // malformed: no source
      { timestamp: day(2), netCreditImpact: 500, source: { kind: 'BILL', id: 'bill-1' } },
    ];
    const slices = computeOutstandingSlices(events);

    expect(slices).toEqual([
      { source: { kind: 'BILL', id: 'bill-1' }, originalTimestamp: day(2), remainingAmount: 500 },
    ]);
  });

  it('a customer with no events at all has no outstanding slices', () => {
    expect(computeOutstandingSlices([])).toEqual([]);
  });
});
