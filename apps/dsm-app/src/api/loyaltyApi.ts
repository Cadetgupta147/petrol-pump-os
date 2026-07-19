import { API_BASE_URL } from '../config';

// POST /loyalty/calculate-points — Section 6.2/6.3, the DSM app's live
// points preview at bill-entry time (before the bill row exists). The rate
// itself is looked up server-side (override-then-default precedence,
// Section 6.2) — the DSM never sees or picks a rate, only the result.
export interface PointsPreview {
  billId: string | null;
  customerId: string | null;
  basis: 'RUPEE' | 'LITRE';
  rate: number;
  rateSource: 'DEALER_DEFAULT' | 'CUSTOMER_OVERRIDE';
  amount: number;
  litres: number;
  points: number;
}

export class LoyaltyApiError extends Error {}

const REQUEST_TIMEOUT_MS = 10_000;

// Returns null when loyalty is not configured yet (server responds 409) —
// that is a valid state, not an error: bills still save, they just earn
// nothing, and POST /bills says so via its loyaltyWarning field. Every
// other failure throws LoyaltyApiError; the caller treats the preview as
// strictly non-blocking either way.
export async function calculatePointsPreview(
  input: { amount: number; litres: number; customerId: string },
  accessToken: string,
): Promise<PointsPreview | null> {
  let response: Response;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    try {
      response = await fetch(`${API_BASE_URL}/loyalty/calculate-points`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(input),
        signal: controller.signal,
      });
    } catch {
      // Same network/timeout handling as the other api/ modules.
      throw new LoyaltyApiError(
        "Can't reach the server — check EXPO_PUBLIC_API_BASE_URL in your .env file.",
      );
    }
  } finally {
    clearTimeout(timeoutId);
  }

  if (response.status === 409) {
    return null;
  }

  if (!response.ok) {
    let message = 'Could not calculate the points preview.';
    try {
      const body = (await response.json()) as { message?: string | string[] };
      if (typeof body.message === 'string' && body.message.length > 0) {
        message = body.message;
      } else if (Array.isArray(body.message) && body.message.length > 0) {
        message = body.message.join(', ');
      }
    } catch {
      // Body wasn't valid JSON — fall back to the generic message above.
    }
    throw new LoyaltyApiError(message);
  }

  return (await response.json()) as PointsPreview;
}
