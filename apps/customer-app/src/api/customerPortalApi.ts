import { API_BASE_URL } from '../config';

// Real, live backend contract — apps/backend/src/customer-portal/
// (customer-portal.controller.ts / customer-portal.service.ts). Every route
// here requires a valid customer JWT (the same accessToken issued by
// customerAuthApi.verifyOtp()) and resolves the acting customer server-side
// from the token — none of these calls ever send a customerId.
//
// Unlike customerAuthApi's postJson() (unauthenticated, POST-only), these are
// authenticated GET *and* POST calls, so this module attaches
// `Authorization: Bearer <token>` and supports both methods, but otherwise
// mirrors the same fetch/timeout/error-body-parsing shape.

export type RedemptionTypeAllowed = 'CASH' | 'GIFT' | 'BOTH';
export type RedemptionType = 'CASH' | 'GIFT';
export type LoyaltyBasis = 'RUPEE' | 'LITRE';
export type VerificationStatus = 'INFORMAL' | 'VERIFIED';

export interface RedemptionConfigSummary {
  typeAllowed: RedemptionTypeAllowed;
  customerCanChoose: boolean;
  cashRedemptionRatio: number | null;
  minRedeemablePoints: number | null;
}

export interface CustomerMe {
  customerId: string;
  name: string;
  phone: string;
  vehicleNumber: string | null;
  qrMemberId: string;
  verificationStatus: VerificationStatus;
  pointsBalance: number;
  outstandingBalance: number;
  redemption: RedemptionConfigSummary | null;
}

export interface CustomerBill {
  id: string;
  timestamp: string;
  amount: number;
  litres: number;
  productType: string;
  loyaltyPointsEarned: number;
  loyaltyBasisUsed: LoyaltyBasis | null;
}

export interface GiftCatalogItem {
  id: string;
  giftName: string;
  imageUrl: string | null;
  pointsRequired: number;
  stockQuantity: number | null;
  inStock: boolean;
  affordable: boolean;
  pointsShort: number;
}

export interface CreateRedemptionRequest {
  redemptionType?: RedemptionType;
  giftItemId?: string;
  pointsToRedeem?: number;
}

// Deliberately not typed further here — the customer app never needs to
// branch on the created redemption's shape, only on success/failure (points
// balance is refreshed via a separate GET /me call after success).
export type CreateRedemptionResponse = unknown;

// `status` lets callers distinguish a 401 (expired/killed session — should
// trigger a forced logout, per the task brief) from any other failure
// (network error → status 0, other 4xx/5xx → the real HTTP status).
export class CustomerPortalError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

const REQUEST_TIMEOUT_MS = 10_000;

interface ErrorBody {
  message?: string | string[];
}

async function authRequest<T>(
  path: string,
  accessToken: string,
  init?: { method?: 'GET' | 'POST'; body?: unknown },
): Promise<T> {
  let response: Response;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    try {
      response = await fetch(`${API_BASE_URL}${path}`, {
        method: init?.method ?? 'GET',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
        signal: controller.signal,
      });
    } catch {
      // Network failure or timeout — status 0 signals "not an HTTP response
      // at all" so callers never mistake this for a 401.
      throw new CustomerPortalError(
        "Can't reach the server — check your connection and try again.",
        0,
      );
    }
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    let message = 'Something went wrong. Please try again.';
    try {
      const errBody = (await response.json()) as ErrorBody;
      if (Array.isArray(errBody.message) && errBody.message.length > 0) {
        // class-validator's ValidationPipe returns `message` as a string[].
        message = errBody.message.join(', ');
      } else if (typeof errBody.message === 'string' && errBody.message.length > 0) {
        // Hand-thrown NestJS exceptions (e.g. RedemptionsService's
        // "Insufficient points: customer has X, gift requires Y") return a
        // single human-readable string — surface it directly, same pattern
        // as CustomerAuthError in customerAuthApi.ts.
        message = errBody.message;
      }
    } catch {
      // Body wasn't valid JSON — fall back to the generic message above.
    }
    throw new CustomerPortalError(message, response.status);
  }

  return (await response.json()) as T;
}

export function getMe(accessToken: string): Promise<CustomerMe> {
  return authRequest<CustomerMe>('/customer-portal/me', accessToken);
}

export function getBills(accessToken: string, limit?: number): Promise<CustomerBill[]> {
  const query = typeof limit === 'number' ? `?limit=${limit}` : '';
  return authRequest<CustomerBill[]>(`/customer-portal/bills${query}`, accessToken);
}

export function getGiftCatalog(accessToken: string): Promise<GiftCatalogItem[]> {
  return authRequest<GiftCatalogItem[]>('/customer-portal/gift-catalog', accessToken);
}

export function createRedemption(
  accessToken: string,
  body: CreateRedemptionRequest,
): Promise<CreateRedemptionResponse> {
  return authRequest<CreateRedemptionResponse>('/customer-portal/redemptions', accessToken, {
    method: 'POST',
    body,
  });
}

// A 401 here means the customer JWT is expired/killed — every screen that
// calls this API must react by forcing a logout (App.tsx's
// clearCustomerSession()/onLogOut path), never by showing a generic retry
// banner, per the task brief.
export function isUnauthorizedError(err: unknown): boolean {
  return err instanceof CustomerPortalError && err.status === 401;
}
