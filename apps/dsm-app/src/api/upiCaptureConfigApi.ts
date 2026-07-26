import { API_BASE_URL } from '../config';

// Mirrors the backend contract (apps/backend/src/upi-capture-config/*,
// Section 8A.3). GET is readable by DSM (broader than the usual
// Owner/Accountant-only settings pattern — see that controller's comment):
// ShiftSalesSummaryScreen needs autoCaptureEnabled to decide whether UPI is
// an editable field or a read-only "auto-captured" one. Secret fields are
// never returned by the API regardless of role — this app never needs them
// (PATCH, which does accept credentials, is Owner-only and lives on the
// web-portal settings page, not here).
export interface UpiCaptureConfig {
  id: string;
  pumpId: string;
  autoCaptureEnabled: boolean;
  provider: 'PHONEPE' | 'PAYTM' | null;
  phonePeWebhookUsernameSet: boolean;
  phonePeWebhookPasswordSet: boolean;
  paytmMerchantKeySet: boolean;
  updatedAt: string;
}

export class UpiCaptureConfigApiError extends Error {}

const REQUEST_TIMEOUT_MS = 10_000;

export async function getUpiCaptureConfig(accessToken: string): Promise<UpiCaptureConfig> {
  let response: Response;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    try {
      response = await fetch(`${API_BASE_URL}/upi-capture-config`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: controller.signal,
      });
    } catch {
      throw new UpiCaptureConfigApiError(
        "Can't reach the server — check EXPO_PUBLIC_API_BASE_URL in your .env file.",
      );
    }
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    let message = 'The server rejected this request.';
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
    throw new UpiCaptureConfigApiError(message);
  }

  return (await response.json()) as UpiCaptureConfig;
}
