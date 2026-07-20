import type { GiftCatalogItem, RedemptionConfigSummary } from '../api/customerPortalApi';
import type { CreateRedemptionRequest } from '../api/customerPortalApi';

// Pure formatting/derivation helpers pulled out of the screens so the
// rule-heavy bits (money/points display, redemption request shaping) are
// unit-testable without rendering React Native components. Nothing here
// calls the network or touches React state.

// Indian digit grouping (lakh/crore, e.g. 1,23,456) rather than Western
// thousands grouping — matches the ₹ amounts shown throughout
// docs/master-plan.md Section 14's mockups. Deliberately implemented by hand
// rather than via `toLocaleString('en-IN')`/Intl: Hermes's Intl support
// varies by RN/Expo build config, and this keeps output deterministic in
// Jest regardless of the runtime's ICU data.
export function formatIndianNumber(value: number): string {
  const rounded = Math.round(Math.abs(value));
  const sign = value < 0 ? '-' : '';
  const digits = String(rounded);
  if (digits.length <= 3) {
    return sign + digits;
  }
  const last3 = digits.slice(-3);
  const rest = digits.slice(0, -3);
  const grouped = rest.replace(/\B(?=(\d{2})+(?!\d)$)/g, ',');
  return `${sign}${grouped},${last3}`;
}

function formatClockTime(date: Date): string {
  let hours = date.getHours();
  const minutes = date.getMinutes();
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  if (hours === 0) hours = 12;
  const minutesStr = minutes < 10 ? `0${minutes}` : `${minutes}`;
  return `${hours}:${minutesStr} ${ampm}`;
}

const MONTH_LABELS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

function isSameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

// Matches the mockup's bill-list style ("Today, 10:42 AM" / "3 Jul, 6:10
// PM"). `referenceNow` defaults to the real current time but is injectable
// for deterministic tests.
export function formatBillTimestamp(isoTimestamp: string, referenceNow: Date = new Date()): string {
  const date = new Date(isoTimestamp);
  const time = formatClockTime(date);

  if (isSameLocalDay(date, referenceNow)) {
    return `Today, ${time}`;
  }

  const yesterday = new Date(referenceNow);
  yesterday.setDate(referenceNow.getDate() - 1);
  if (isSameLocalDay(date, yesterday)) {
    return `Yesterday, ${time}`;
  }

  return `${date.getDate()} ${MONTH_LABELS[date.getMonth()]}, ${time}`;
}

// Home screen's "≈ ₹X or N gifts" subtext under the points headline. Both
// halves are optional and independently omitted:
// - the ₹ half needs a configured cash ratio (redemption may be null/CASH
//   not allowed/ratio not set)
// - the gift-count half needs at least one currently-affordable gift
// Returns null when neither half applies, so the caller can skip rendering
// the subtext line entirely rather than showing an empty string.
export function formatPointsSubtext(
  pointsBalance: number,
  cashRedemptionRatio: number | null | undefined,
  affordableGiftCount: number | null | undefined,
): string | null {
  const parts: string[] = [];

  if (typeof cashRedemptionRatio === 'number' && cashRedemptionRatio > 0 && pointsBalance > 0) {
    const cashValue = pointsBalance * cashRedemptionRatio;
    parts.push(`≈ ₹${formatIndianNumber(cashValue)}`);
  }

  if (typeof affordableGiftCount === 'number' && affordableGiftCount > 0) {
    parts.push(`${affordableGiftCount} gift${affordableGiftCount === 1 ? '' : 's'}`);
  }

  if (parts.length === 0) return null;
  return parts.join(' or ');
}

export function countAffordableGifts(gifts: GiftCatalogItem[]): number {
  return gifts.filter((gift) => gift.affordable).length;
}

// Shapes the POST /customer-portal/redemptions body for redeeming a specific
// gift. Per the backend DTO (create-customer-redemption.dto.ts) and
// customer-portal.service.ts's delegation to RedemptionsService.create():
// `redemptionType` should only be sent when the pump both allows BOTH levers
// AND lets the customer choose per redemption — sending it in any other
// configuration is rejected server-side with a 400 ("mismatched type"), so
// omit it and let the server resolve the pump's fixed mode.
export function buildGiftRedemptionBody(
  redemption: RedemptionConfigSummary,
  giftItemId: string,
): CreateRedemptionRequest {
  if (redemption.typeAllowed === 'BOTH' && redemption.customerCanChoose) {
    return { redemptionType: 'GIFT', giftItemId };
  }
  return { giftItemId };
}

// Client-side sanity clamp only for the "switch to cash discount" points
// input (server is the real enforcement, per CLAUDE.md — never trust the
// frontend to enforce a business rule). Keeps the stepper/input from landing
// on 0, a negative number, a fraction, or a value the customer obviously
// doesn't have.
export function clampPointsToRedeem(
  rawValue: number,
  pointsBalance: number,
  minRedeemablePoints: number | null | undefined,
): number {
  const floor = Math.max(1, minRedeemablePoints ?? 1);
  if (!Number.isFinite(rawValue)) {
    return Math.min(floor, Math.max(pointsBalance, 0));
  }
  const rounded = Math.floor(rawValue);
  const ceiling = Math.max(pointsBalance, 0);
  return Math.min(Math.max(rounded, floor), Math.max(ceiling, floor));
}
