import {
  AgedSlice,
  bucketAgedSlices,
  computeFifoAgedSlices,
} from './credit-aging.util';

// Section 12 — Credit Aging Report. Rule-heavy money logic (CLAUDE.md: write
// tests for this category) — covers the FIFO allocation and the bucket
// boundary edges, the two places a bug would misattribute or misdate a
// customer's outstanding debt.
describe('computeFifoAgedSlices', () => {
  const day = (n: number) => new Date(`2026-01-${String(n).padStart(2, '0')}T00:00:00Z`);

  it('a single unpaid bill produces a single slice dated to that bill', () => {
    const slices = computeFifoAgedSlices([
      { timestamp: day(1), netCreditImpact: 1000 },
    ]);

    expect(slices).toEqual([
      { originalTimestamp: day(1), remainingAmount: 1000 },
    ]);
  });

  it('a payment fully clearing one bill leaves no slices', () => {
    const slices = computeFifoAgedSlices([
      { timestamp: day(1), netCreditImpact: 1000 },
      { timestamp: day(5), netCreditImpact: -1000 },
    ]);

    expect(slices).toEqual([]);
  });

  it('applies a partial payment against the OLDEST bill first, not the newest', () => {
    const slices = computeFifoAgedSlices([
      { timestamp: day(1), netCreditImpact: 1000 }, // oldest
      { timestamp: day(10), netCreditImpact: 500 }, // newer
      { timestamp: day(15), netCreditImpact: -700 }, // partial payment
    ]);

    // 700 eats fully into the day(1) slice (1000 -> 300 remaining), leaves
    // the day(10) slice untouched.
    expect(slices).toEqual([
      { originalTimestamp: day(1), remainingAmount: 300 },
      { originalTimestamp: day(10), remainingAmount: 500 },
    ]);
  });

  it('a payment large enough to clear the oldest bill spills over into the next-oldest', () => {
    const slices = computeFifoAgedSlices([
      { timestamp: day(1), netCreditImpact: 1000 },
      { timestamp: day(10), netCreditImpact: 500 },
      { timestamp: day(15), netCreditImpact: -1200 }, // clears bill 1 fully, eats 200 of bill 2
    ]);

    expect(slices).toEqual([
      { originalTimestamp: day(10), remainingAmount: 300 },
    ]);
  });

  it('events are FIFO-ordered by timestamp, regardless of input array order', () => {
    const slices = computeFifoAgedSlices([
      { timestamp: day(10), netCreditImpact: 500 },
      // If this weren't re-sorted before allocation, a naive array-order walk
      // would apply this payment against the day(10) bill (it appears first
      // in the input); FIFO-by-timestamp must apply it to the OLDER day(1)
      // bill instead, fully clearing it and leaving day(10) untouched.
      { timestamp: day(15), netCreditImpact: -1000 },
      { timestamp: day(1), netCreditImpact: 1000 },
    ]);

    expect(slices).toEqual([
      { originalTimestamp: day(10), remainingAmount: 500 },
    ]);
  });

  it('an overpayment beyond total credit billed is dropped, not turned into a negative slice', () => {
    const slices = computeFifoAgedSlices([
      { timestamp: day(1), netCreditImpact: 500 },
      { timestamp: day(5), netCreditImpact: -800 }, // 300 more than was ever owed
    ]);

    expect(slices).toEqual([]);
  });

  it('amounts within AGING_EPSILON of zero are treated as fully settled', () => {
    const slices = computeFifoAgedSlices([
      { timestamp: day(1), netCreditImpact: 1000 },
      { timestamp: day(5), netCreditImpact: -999.995 }, // within float epsilon of 1000
    ]);

    expect(slices).toEqual([]);
  });

  it('a customer with no events at all has no outstanding slices', () => {
    expect(computeFifoAgedSlices([])).toEqual([]);
  });
});

describe('bucketAgedSlices', () => {
  const asOf = new Date('2026-07-21T00:00:00Z');
  const daysAgo = (n: number) =>
    new Date(asOf.getTime() - n * 24 * 60 * 60 * 1000);

  it('a slice exactly 15 days old lands in the 0-15 bucket (inclusive boundary)', () => {
    const slices: AgedSlice[] = [
      { originalTimestamp: daysAgo(15), remainingAmount: 100 },
    ];
    const buckets = bucketAgedSlices(slices, asOf);
    expect(buckets.bucket0to15).toBe(100);
    expect(buckets.bucket15to30).toBe(0);
    expect(buckets.bucket30Plus).toBe(0);
  });

  it('a slice just over 15 days old lands in the 15-30 bucket', () => {
    const slices: AgedSlice[] = [
      { originalTimestamp: daysAgo(15.5), remainingAmount: 100 },
    ];
    const buckets = bucketAgedSlices(slices, asOf);
    expect(buckets.bucket0to15).toBe(0);
    expect(buckets.bucket15to30).toBe(100);
  });

  it('a slice exactly 30 days old lands in the 15-30 bucket (inclusive boundary)', () => {
    const slices: AgedSlice[] = [
      { originalTimestamp: daysAgo(30), remainingAmount: 250 },
    ];
    const buckets = bucketAgedSlices(slices, asOf);
    expect(buckets.bucket15to30).toBe(250);
    expect(buckets.bucket30Plus).toBe(0);
  });

  it('a slice just over 30 days old lands in the 30+ bucket', () => {
    const slices: AgedSlice[] = [
      { originalTimestamp: daysAgo(30.5), remainingAmount: 250 },
    ];
    const buckets = bucketAgedSlices(slices, asOf);
    expect(buckets.bucket15to30).toBe(0);
    expect(buckets.bucket30Plus).toBe(250);
  });

  it('sums multiple slices across different buckets and computes the grand total', () => {
    const slices: AgedSlice[] = [
      { originalTimestamp: daysAgo(5), remainingAmount: 100 }, // 0-15
      { originalTimestamp: daysAgo(20), remainingAmount: 200 }, // 15-30
      { originalTimestamp: daysAgo(45), remainingAmount: 300 }, // 30+
    ];
    const buckets = bucketAgedSlices(slices, asOf);
    expect(buckets).toEqual({
      bucket0to15: 100,
      bucket15to30: 200,
      bucket30Plus: 300,
      total: 600,
    });
  });

  it('no slices produces all-zero buckets', () => {
    expect(bucketAgedSlices([], asOf)).toEqual({
      bucket0to15: 0,
      bucket15to30: 0,
      bucket30Plus: 0,
      total: 0,
    });
  });
});
