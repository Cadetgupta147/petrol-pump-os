import { normalizeIndianMobile } from './phone.util';

// Rule-heavy per CLAUDE.md ("write tests for rule-heavy logic") because a
// bug here is a rate-limit bypass: CustomerAuthService.requestOtp keys its
// per-phone rate limiting off the exact `phone` string, so every format a
// real caller might send for the same number MUST collapse to one
// canonical value before it ever reaches that logic (see
// dto/request-otp.dto.ts and dto/verify-otp.dto.ts, which apply this via
// @Transform ahead of @Matches).
describe('normalizeIndianMobile', () => {
  it('leaves a bare 10-digit number unchanged', () => {
    expect(normalizeIndianMobile('9876543210')).toBe('9876543210');
  });

  it('strips a "+91" country-code prefix', () => {
    expect(normalizeIndianMobile('+919876543210')).toBe('9876543210');
  });

  it('strips a bare "91" country-code prefix (no +)', () => {
    expect(normalizeIndianMobile('919876543210')).toBe('9876543210');
  });

  it('strips spaces/dashes commonly used in human-entered formatting', () => {
    expect(normalizeIndianMobile('+91 98765-43210')).toBe('9876543210');
    expect(normalizeIndianMobile('98765 43210')).toBe('9876543210');
  });

  it('does NOT strip "91" from a bare 10-digit number that happens to start with 9 followed by 1', () => {
    // 9199999999 is a plausible bare 10-digit Indian mobile number (starts
    // with 9, second digit can be anything) — length disambiguates this
    // from a 12-digit "91-prefixed" input, so it must be left untouched.
    expect(normalizeIndianMobile('9199999999')).toBe('9199999999');
  });

  it('all three real-world formats for the same number collapse to the same canonical value', () => {
    const canonical = normalizeIndianMobile('9876543210');
    expect(normalizeIndianMobile('+919876543210')).toBe(canonical);
    expect(normalizeIndianMobile('919876543210')).toBe(canonical);
  });
});
