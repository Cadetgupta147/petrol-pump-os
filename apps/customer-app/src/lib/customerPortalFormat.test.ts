import {
  buildGiftRedemptionBody,
  clampPointsToRedeem,
  countAffordableGifts,
  formatBillTimestamp,
  formatIndianNumber,
  formatPointsSubtext,
} from './customerPortalFormat';
import type { GiftCatalogItem, RedemptionConfigSummary } from '../api/customerPortalApi';

describe('formatIndianNumber', () => {
  it('leaves 3-digit-or-fewer numbers unformatted', () => {
    expect(formatIndianNumber(0)).toBe('0');
    expect(formatIndianNumber(42)).toBe('42');
    expect(formatIndianNumber(999)).toBe('999');
  });

  it('groups thousands with the Indian 2-digit pattern', () => {
    expect(formatIndianNumber(1240)).toBe('1,240');
    expect(formatIndianNumber(12345)).toBe('12,345');
  });

  it('groups lakhs correctly (not Western 3-digit grouping)', () => {
    expect(formatIndianNumber(123456)).toBe('1,23,456');
    expect(formatIndianNumber(1234567)).toBe('12,34,567');
  });

  it('rounds fractional values and preserves sign', () => {
    expect(formatIndianNumber(1240.6)).toBe('1,241');
    expect(formatIndianNumber(-500)).toBe('-500');
  });
});

describe('formatBillTimestamp', () => {
  const referenceNow = new Date(2026, 6, 20, 15, 30); // 20 Jul 2026, 3:30 PM local

  it('labels a bill from earlier today as "Today, <time>"', () => {
    const today1042am = new Date(2026, 6, 20, 10, 42).toISOString();
    expect(formatBillTimestamp(today1042am, referenceNow)).toBe('Today, 10:42 AM');
  });

  it('labels a bill from the previous calendar day as "Yesterday, <time>"', () => {
    const yesterday610pm = new Date(2026, 6, 19, 18, 10).toISOString();
    expect(formatBillTimestamp(yesterday610pm, referenceNow)).toBe('Yesterday, 6:10 PM');
  });

  it('labels an older bill as "<day> <month>, <time>"', () => {
    const older = new Date(2026, 6, 3, 18, 10).toISOString();
    expect(formatBillTimestamp(older, referenceNow)).toBe('3 Jul, 6:10 PM');
  });

  it('formats midnight and noon boundary times correctly (12-hour clock)', () => {
    const midnight = new Date(2026, 6, 20, 0, 5).toISOString();
    const noon = new Date(2026, 6, 20, 12, 0).toISOString();
    expect(formatBillTimestamp(midnight, referenceNow)).toBe('Today, 12:05 AM');
    expect(formatBillTimestamp(noon, referenceNow)).toBe('Today, 12:00 PM');
  });
});

describe('formatPointsSubtext', () => {
  it('returns both halves when a cash ratio and affordable gifts exist', () => {
    expect(formatPointsSubtext(1240, 1, 2)).toBe('≈ ₹1,240 or 2 gifts');
  });

  it('singularizes "gift" for a count of exactly 1', () => {
    expect(formatPointsSubtext(1240, 1, 1)).toBe('≈ ₹1,240 or 1 gift');
  });

  it('omits the cash half when no ratio is configured', () => {
    expect(formatPointsSubtext(1240, null, 2)).toBe('2 gifts');
  });

  it('omits the gift half when no gifts are affordable', () => {
    expect(formatPointsSubtext(1240, 1, 0)).toBe('≈ ₹1,240');
  });

  it('returns null when neither half applies', () => {
    expect(formatPointsSubtext(0, null, 0)).toBeNull();
    expect(formatPointsSubtext(0, null, undefined)).toBeNull();
  });
});

describe('countAffordableGifts', () => {
  const gift = (affordable: boolean): GiftCatalogItem => ({
    id: 'g1',
    giftName: 'Test Gift',
    imageUrl: null,
    pointsRequired: 100,
    stockQuantity: null,
    inStock: true,
    affordable,
    pointsShort: affordable ? 0 : 50,
  });

  it('counts only affordable gifts', () => {
    expect(countAffordableGifts([gift(true), gift(false), gift(true)])).toBe(2);
  });

  it('returns 0 for an empty catalog', () => {
    expect(countAffordableGifts([])).toBe(0);
  });
});

describe('buildGiftRedemptionBody', () => {
  const base: RedemptionConfigSummary = {
    typeAllowed: 'BOTH',
    customerCanChoose: true,
    cashRedemptionRatio: 1,
    minRedeemablePoints: 100,
  };

  it('sends redemptionType: GIFT only when BOTH is allowed and the customer can choose', () => {
    expect(buildGiftRedemptionBody(base, 'gift-1')).toEqual({
      redemptionType: 'GIFT',
      giftItemId: 'gift-1',
    });
  });

  it('omits redemptionType when the dealer fixed the mode (customerCanChoose: false)', () => {
    expect(buildGiftRedemptionBody({ ...base, customerCanChoose: false }, 'gift-1')).toEqual({
      giftItemId: 'gift-1',
    });
  });

  it('omits redemptionType when only GIFT is allowed', () => {
    expect(
      buildGiftRedemptionBody({ ...base, typeAllowed: 'GIFT', customerCanChoose: true }, 'gift-1'),
    ).toEqual({ giftItemId: 'gift-1' });
  });
});

describe('clampPointsToRedeem', () => {
  it('clamps a value above the balance down to the balance', () => {
    expect(clampPointsToRedeem(5000, 1240, 100)).toBe(1240);
  });

  it('clamps a value below the minimum up to the minimum', () => {
    expect(clampPointsToRedeem(10, 1240, 100)).toBe(100);
  });

  it('floors fractional input', () => {
    expect(clampPointsToRedeem(500.9, 1240, 100)).toBe(500);
  });

  it('defaults the floor to 1 when no minimum is configured', () => {
    expect(clampPointsToRedeem(0, 1240, null)).toBe(1);
  });

  it('falls back sensibly for non-finite input', () => {
    expect(clampPointsToRedeem(NaN, 1240, 100)).toBe(100);
  });
});
