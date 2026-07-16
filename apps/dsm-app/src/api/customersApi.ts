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

export class CustomersApiError extends Error {}

const REQUEST_TIMEOUT_MS = 10_000;

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
