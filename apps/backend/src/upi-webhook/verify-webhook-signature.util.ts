import { createHash, timingSafeEqual } from 'crypto';
// @ts-expect-error — paytmchecksum ships no type declarations.
import PaytmChecksum from 'paytmchecksum';

function timingSafeEqualStrings(expected: string, provided: string): boolean {
  const expectedBuffer = Buffer.from(expected, 'utf8');
  const providedBuffer = Buffer.from(provided, 'utf8');
  // timingSafeEqual throws on length mismatch rather than returning false —
  // guard explicitly so a length-mismatched signature is just "invalid",
  // not an unhandled exception.
  if (expectedBuffer.length !== providedBuffer.length) {
    return false;
  }
  return timingSafeEqual(expectedBuffer, providedBuffer);
}

// Section 8A.3 — PhonePe Business webhook verification.
//
// PhonePe's Standard Checkout webhook scheme (per their developer docs): the
// dealer configures a username/password pair in their PhonePe Business
// dashboard alongside the callback URL. On every delivery PhonePe computes
// `Authorization: SHA256("<username>:<password>")` (hex digest) — the
// merchant independently recomputes the same hash from their own stored
// credentials (UpiCaptureConfig.phonePeWebhookUsername/Password, dealer's
// own merchant account, see that model's comment) and compares.
//
// NOTE: this differs from the older X-VERIFY salt-key checksum PhonePe uses
// for its outbound Status-check API calls — that scheme doesn't apply to
// inbound webhooks and was a placeholder guess in an earlier version of
// this file. Re-confirm this exact header/format against your dealer's
// actual registered PhonePe Business webhook payload once one is live —
// see CLAUDE.md's open-items note on this integration.
export function verifyPhonePeSignature(
  authorizationHeader: string | undefined,
  username: string | undefined,
  password: string | undefined,
): boolean {
  if (!authorizationHeader || !username || !password) {
    return false;
  }
  const expected = createHash('sha256')
    .update(`${username}:${password}`)
    .digest('hex');
  return timingSafeEqualStrings(expected, authorizationHeader);
}

// Section 8A.3 — Paytm Business webhook verification, via Paytm's own
// official `paytmchecksum` package rather than a hand-rolled reimplementation
// of their AES-128-CBC + salt scheme (getting a payment-provider's
// proprietary checksum algorithm subtly wrong is exactly the kind of bug
// that's invisible until it either rejects everything or accepts a forged
// payload — safer to depend on their maintained implementation).
//
// Paytm sends the checksum as a `CHECKSUMHASH` field INSIDE the JSON body
// (not a header) — verifySignature() strips it out internally before
// recomputing, so the raw body (including CHECKSUMHASH) can be passed
// through as-is. Returns false (never throws) for a malformed body, so a
// bad delivery is just "invalid", same as the PhonePe path.
export function verifyPaytmSignature(
  body: Record<string, unknown> | undefined,
  merchantKey: string | undefined,
): boolean {
  const checksum = body?.CHECKSUMHASH;
  if (!body || !merchantKey || typeof checksum !== 'string' || !checksum) {
    return false;
  }
  try {
    return PaytmChecksum.verifySignature(body, merchantKey, checksum) === true;
  } catch {
    return false;
  }
}
