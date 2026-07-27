// Tunables for the Section 2 (web portal password login) and Section 4 (DSM
// app PIN login) brute-force defenses. Two independent layers, mirroring
// customer-auth's OTP defense-in-depth (per-IP request throttling, plus a
// DB-backed per-identifier lockout underneath it):
//
//   1. Per-IP+phone request throttling (ThrottlerModule, enforced by
//      StaffLoginThrottlerGuard) — stops a single attacker (one IP, one
//      targeted phone) from firing unlimited login requests.
//   2. DB-backed lockout on StaffAccount itself (AuthService.login /
//      pinLogin) — stops a DISTRIBUTED attacker who rotates IPs (or spreads
//      requests thin enough to stay under the layer-1 window) from
//      brute-forcing one specific account, since layer 1 alone can't see
//      across IPs.
//
// Neither figure is specified in docs/master-plan.md (which doesn't mention
// login rate-limit policy at all) — these are reasonable defaults per the
// security review driving this task, flagged for human review same as the
// rest of this slice.

// Layer 1 — per-IP+phone request throttle (see
// guards/staff-login-throttler.guard.ts). Same limit applied to both
// /auth/login and /auth/pin-login: 5 attempts per 15-minute window.
export const LOGIN_IP_THROTTLE_LIMIT = 5;
export const LOGIN_IP_THROTTLE_TTL_MS = 15 * 60 * 1000;

// Layer 2 — DB-backed account lockout (see AuthService.login/pinLogin).
// The threshold below is deliberately the same number as layer 1's request
// limit per this task's original spec, but kept as a separate constant since
// the two layers are independent mechanisms that could reasonably diverge
// later (e.g. if the IP throttle window is loosened, the account lockout
// doesn't have to move with it).
export const LOGIN_LOCKOUT_THRESHOLD = 5;

// Escalating lockout schedule — replaces what used to be a single flat
// LOGIN_LOCKOUT_DURATION_MS. Each time an account crosses
// LOGIN_LOCKOUT_THRESHOLD, StaffAccount.lockoutEscalationLevel (see that
// field's comment in prisma/schema.prisma) increments, and the cooldown
// length is looked up here by the NEW level: the 1st lockout gets a short
// 2-minute cooldown (cheap to recover from if it was a genuine typo spree),
// but an account that keeps getting locked out — i.e. failing the threshold
// again shortly after a previous cooldown expired — escalates to a much
// longer wait, on the theory that repeat lockouts look increasingly like an
// actual brute-force attempt rather than a one-off mistake. The level (and
// therefore the cooldown) only resets to the bottom rung on an actual
// successful login (AuthService.resetLoginLockout) or a manual unlock
// (StaffManagementService.clearLockout) — merely waiting out an expired
// lockout does NOT reset it.
//
// Indexed via `Math.min(level, LOCKOUT_ESCALATION_DURATIONS_MS.length) - 1`
// (see AuthService.recordFailedLoginAttempt) so level 1 -> index 0 (2 min),
// level 2 -> index 1 (15 min), and level 3 and every level after reuses the
// last entry (1 hour) rather than needing an entry per level forever.
export const LOCKOUT_ESCALATION_DURATIONS_MS = [
  2 * 60 * 1000, // 1st lockout
  15 * 60 * 1000, // 2nd lockout
  60 * 60 * 1000, // 3rd and every subsequent lockout
];
