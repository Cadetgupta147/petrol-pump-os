import { createHmac, timingSafeEqual } from 'crypto';

// Section 8A.3 — generic HMAC-SHA256 webhook signature verification.
//
// PROVIDER NOTE (open decision — see CLAUDE.md / master-plan Section 17:
// "PhonePe vs. Paytm Business ... isn't yet [chosen]"): this implements a
// GENERIC HMAC-SHA256-over-the-raw-body scheme as a placeholder. The actual
// header name (assumed here: `x-webhook-signature`), the exact algorithm,
// and the encoding (hex assumed here; some providers use base64) will need
// to be adjusted once a specific provider is chosen — e.g. PhonePe's
// checksum scheme is actually SHA256(payload + saltKey) + "###" + saltIndex
// in an `X-VERIFY` header, not a plain HMAC. Treat this function as the ONE
// place that needs to change when the provider is finalized.
export function verifyWebhookSignature(
  rawBody: Buffer | undefined,
  signatureHeader: string | undefined,
  secret: string | undefined,
): boolean {
  // Fail closed on any missing ingredient — an unsigned/unsignable payload
  // must never be trusted, and a missing UPI_WEBHOOK_SIGNING_SECRET is a
  // deployment misconfiguration, not a reason to accept requests unverified.
  if (!rawBody || !signatureHeader || !secret) {
    return false;
  }

  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  const expectedBuffer = Buffer.from(expected, 'utf8');
  const providedBuffer = Buffer.from(signatureHeader, 'utf8');

  // timingSafeEqual throws on length mismatch rather than returning false —
  // guard explicitly so a length-mismatched signature is just "invalid",
  // not an unhandled exception.
  if (expectedBuffer.length !== providedBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, providedBuffer);
}
