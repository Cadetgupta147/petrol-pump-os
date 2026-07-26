import { randomBytes } from 'crypto';
import { decryptCredential, encryptCredential } from './credential-encryption.util';

const ORIGINAL_ENV = process.env.CREDENTIAL_ENCRYPTION_KEY;

describe('credential-encryption.util', () => {
  beforeEach(() => {
    process.env.CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString('base64');
  });

  afterAll(() => {
    process.env.CREDENTIAL_ENCRYPTION_KEY = ORIGINAL_ENV;
  });

  it('round-trips a plaintext credential', () => {
    const encrypted = encryptCredential('dealer-secret-value');
    expect(encrypted).not.toBe('dealer-secret-value');
    expect(encrypted).not.toBeNull();
    expect(decryptCredential(encrypted)).toBe('dealer-secret-value');
  });

  it('produces a different ciphertext each time (random IV), same plaintext both times', () => {
    const a = encryptCredential('same-value');
    const b = encryptCredential('same-value');
    expect(a).not.toBe(b);
    expect(decryptCredential(a)).toBe('same-value');
    expect(decryptCredential(b)).toBe('same-value');
  });

  it('passes null/undefined straight through without touching the key', () => {
    delete process.env.CREDENTIAL_ENCRYPTION_KEY;
    expect(encryptCredential(null)).toBeNull();
    expect(encryptCredential(undefined)).toBeNull();
    expect(decryptCredential(null)).toBeNull();
    expect(decryptCredential(undefined)).toBeNull();
  });

  it('throws when CREDENTIAL_ENCRYPTION_KEY is missing', () => {
    delete process.env.CREDENTIAL_ENCRYPTION_KEY;
    expect(() => encryptCredential('x')).toThrow('CREDENTIAL_ENCRYPTION_KEY is not set');
  });

  it('throws when CREDENTIAL_ENCRYPTION_KEY is the wrong length', () => {
    process.env.CREDENTIAL_ENCRYPTION_KEY = Buffer.from('too-short').toString('base64');
    expect(() => encryptCredential('x')).toThrow('exactly 32 bytes');
  });

  it('fails closed (throws) on tampered ciphertext instead of returning garbage', () => {
    const encrypted = encryptCredential('a-reasonably-long-dealer-secret-value-for-tampering')!;
    const parts = encrypted.split(':');
    // Flip a character in the MIDDLE of the ciphertext segment — flipping
    // the last char of a base64 string can land entirely in padding bits
    // that don't affect the decoded bytes, which would defeat this test.
    const mid = Math.floor(parts[3].length / 2);
    const flipped = parts[3][mid] === 'A' ? 'B' : 'A';
    const tamperedCiphertext = parts[3].slice(0, mid) + flipped + parts[3].slice(mid + 1);
    const tampered = [parts[0], parts[1], parts[2], tamperedCiphertext].join(':');

    expect(() => decryptCredential(tampered)).toThrow();
  });

  it('fails closed (throws) when decrypted with the wrong key', () => {
    const encrypted = encryptCredential('dealer-secret-value');
    process.env.CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString('base64'); // different key
    expect(() => decryptCredential(encrypted)).toThrow();
  });

  it('rejects a malformed stored value', () => {
    expect(() => decryptCredential('not-the-right-format')).toThrow('expected v1:iv:authTag:ciphertext format');
  });
});
