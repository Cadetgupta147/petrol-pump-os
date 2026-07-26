import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

// Section 8A.3 follow-up — encrypts dealer-supplied third-party merchant
// credentials (UpiCaptureConfig.phonePeWebhookUsername/Password/
// paytmMerchantKey) at rest, instead of storing them in plaintext.
//
// WHY THIS EXISTS: those credentials aren't this app's own secrets — they're
// a dealer's PhonePe/Paytm merchant account credentials — AND they're what
// UpiWebhookService verifies inbound deliveries against. A leaked
// DATABASE_URL / mishandled backup / SQL-injection-level DB read would
// otherwise hand over both the dealer's third-party account credentials AND
// a way to forge signed "UPI payment received" webhook events that get
// counted straight into ShiftSalesSummary.walkInUpiCollected (CLAUDE.md:
// money-touching). This closes that gap the same way .env already protects
// this app's own secrets — the encryption key lives in .env
// (CREDENTIAL_ENCRYPTION_KEY), so a DB-only leak is no longer enough on its
// own to recover a usable credential or forge a webhook.
//
// AES-256-GCM: authenticated encryption — decrypt() throws on ANY tampering
// (not just a wrong key), so a corrupted/truncated/attacker-modified stored
// value fails closed rather than silently decrypting to garbage.
//
// Stored format: "v1:<ivBase64>:<authTagBase64>:<ciphertextBase64>" — a
// fresh random 12-byte IV per encryption (GCM requires a unique IV per
// message under the same key; reusing one would break its security
// guarantees), and a version prefix so a future algorithm change can still
// read old rows.
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH_BYTES = 12;
const VERSION_PREFIX = 'v1';

function getKey(): Buffer {
  const raw = process.env.CREDENTIAL_ENCRYPTION_KEY;
  if (!raw) {
    // Fail loudly rather than silently storing/reading plaintext — never
    // run this feature with encryption silently disabled (same posture as
    // JwtStrategy's missing-JWT_SECRET check).
    throw new Error(
      'CREDENTIAL_ENCRYPTION_KEY is not set. Add it to your .env before storing/reading UPI capture credentials (see .env.example) — generate one with `node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"`.',
    );
  }
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error(
      `CREDENTIAL_ENCRYPTION_KEY must decode (base64) to exactly 32 bytes for AES-256-GCM — got ${key.length}.`,
    );
  }
  return key;
}

// Passes null/undefined straight through — every caller (UpiCaptureConfigService)
// deals with genuinely-unset credential fields, and encrypting "nothing" isn't
// meaningful.
export function encryptCredential(plaintext: string | null | undefined): string | null {
  if (plaintext === null || plaintext === undefined) {
    return null;
  }
  const key = getKey();
  const iv = randomBytes(IV_LENGTH_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [VERSION_PREFIX, iv.toString('base64'), authTag.toString('base64'), ciphertext.toString('base64')].join(':');
}

export function decryptCredential(stored: string | null | undefined): string | null {
  if (stored === null || stored === undefined) {
    return null;
  }
  const parts = stored.split(':');
  if (parts.length !== 4 || parts[0] !== VERSION_PREFIX) {
    throw new Error('Stored credential is not in the expected v1:iv:authTag:ciphertext format.');
  }
  const [, ivB64, authTagB64, ciphertextB64] = parts;
  const key = getKey();
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(authTagB64, 'base64'));
  // decipher.final() throws if the auth tag doesn't match — tampered or
  // corrupted ciphertext fails closed here rather than returning garbage.
  const plaintext = Buffer.concat([decipher.update(Buffer.from(ciphertextB64, 'base64')), decipher.final()]);
  return plaintext.toString('utf8');
}
