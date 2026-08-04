import { computeLitresSold } from './compute-litres-sold.util';

describe('computeLitresSold', () => {
  it('returns null while the shift is still open (closingReading null)', () => {
    expect(computeLitresSold(1000, null, false, null)).toBeNull();
  });

  it('computes a plain forward reading', () => {
    expect(computeLitresSold(1000, 1250.5, false, null)).toBe(250.5);
  });

  it('computes a rollover-adjusted reading when meterRolledOver and rolloverAt are set', () => {
    // Meter counts up to 9999.99 then wraps to 0 — opening 9800, rolls over,
    // closes at 150: (9999.99 - 9800) + 150 = 349.99 litres actually sold.
    expect(computeLitresSold(9800, 150, true, 9999.99)).toBeCloseTo(349.99);
  });

  it('ignores meterRolledOver when rolloverAt is not configured (falls back to plain diff)', () => {
    expect(computeLitresSold(9800, 150, true, null)).toBe(150 - 9800);
  });
});
