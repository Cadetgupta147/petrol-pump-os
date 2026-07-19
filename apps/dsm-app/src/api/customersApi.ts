import { API_BASE_URL } from '../config';

// Mirrors apps/backend/src/customers/* — used here only to power the CREDIT
// split-payment-line customer picker (Section 5A.3). There is no search
// query param server-side (GET /customers returns everything), so filtering
// by name/vehicle/phone substring happens client-side against this list.
export interface CustomerSummary {
  id: string;
  name: string;
  phone: string | null;
  vehicleNumber: string | null;
  qrMemberId: string;
  creditLimit: number;
  verificationStatus: 'INFORMAL' | 'VERIFIED';
  createdAt: string;
}

// Minimal projection returned by GET /customers/by-member-id/:qrMemberId —
// Section 6.1's privacy stance is deliberate: no phone, no points balance,
// nothing beyond what the DSM needs to auto-fill the bill form and see the
// INFORMAL/VERIFIED status (Section 3.4A yellow treatment).
export interface CustomerLookup {
  customerId: string;
  qrMemberId: string;
  name: string;
  vehicleNumber: string | null;
  verificationStatus: 'INFORMAL' | 'VERIFIED';
}

export class CustomersApiError extends Error {}

const REQUEST_TIMEOUT_MS = 10_000;

// Shape-only client-side check for a member ID (Section 6.1/6.7 format,
// e.g. PUMP001-CUST-04521-6). Mirrors the regex in the backend's
// isValidQrMemberId() but deliberately does NOT duplicate the Luhn
// check-digit math — the server owns that, and its 400 message (which
// explains a check-digit typo) is surfaced verbatim. This exists so a
// random non-loyalty QR code, or obvious garbage typed by hand, never
// triggers an API call at all.
export function hasMemberIdShape(id: string): boolean {
  return /^[A-Z0-9]+-CUST-\d{5,}-\d$/.test(id);
}

export async function listCustomers(accessToken: string): Promise<CustomerSummary[]> {
  let response: Response;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    try {
      response = await fetch(`${API_BASE_URL}/customers`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: controller.signal,
      });
    } catch {
      // Same network/timeout handling as authApi.ts / meterReadingsApi.ts.
      throw new CustomersApiError(
        "Can't reach the server — check EXPO_PUBLIC_API_BASE_URL in your .env file.",
      );
    }
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    let message = 'Could not load customers.';
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
    throw new CustomersApiError(message);
  }

  return (await response.json()) as CustomerSummary[];
}

// Section 6.3 steps 2–3 — resolve a scanned (or hand-typed, Section 6.1
// manual fallback) member ID into the minimal customer projection. Error
// messages from the server (400 malformed/check-digit, 404 unknown ID) are
// surfaced verbatim — the 400 message in particular tells the DSM which
// digit to re-check when the ID was typed by hand.
export async function getCustomerByMemberId(
  qrMemberId: string,
  accessToken: string,
): Promise<CustomerLookup> {
  let response: Response;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    try {
      response = await fetch(
        `${API_BASE_URL}/customers/by-member-id/${encodeURIComponent(qrMemberId)}`,
        {
          method: 'GET',
          headers: { Authorization: `Bearer ${accessToken}` },
          signal: controller.signal,
        },
      );
    } catch {
      // Same network/timeout handling as listCustomers() above.
      throw new CustomersApiError(
        "Can't reach the server — check EXPO_PUBLIC_API_BASE_URL in your .env file.",
      );
    }
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    let message = 'Could not look up that member ID.';
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
    throw new CustomersApiError(message);
  }

  return (await response.json()) as CustomerLookup;
}
