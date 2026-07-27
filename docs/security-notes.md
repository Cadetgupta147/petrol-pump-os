# Security notes

Known, deliberately-accepted gaps and tradeoffs from security hardening work, tracked here so they
aren't forgotten once the immediate task that surfaced them is closed out. Not a replacement for
`docs/master-plan.md`'s open-items list (Section 17) — this file is specifically for security-review
findings that were consciously accepted rather than fixed, plus the condition under which they need
to be revisited.

## Must fix before horizontal scaling: in-memory ThrottlerStorage

`@nestjs/throttler`'s default `ThrottlerStorage` (used by both `AuthModule` and `CustomerAuthModule` —
see the `ThrottlerModule.forRoot(...)` registration in each) keeps attempt counts in the process's own
memory. This is fine for a single backend instance, which is the only deployment topology this repo
currently runs.

**It will silently stop working correctly the moment this backend runs as more than one instance** —
e.g. a zero-downtime rolling deploy that briefly runs two instances, or real horizontal scaling. Each
instance would track its own independent attempt count, so an attacker split across instances (by a
load balancer) gets a fresh throttle budget per instance instead of one shared budget — the per-IP+phone
login throttle (`src/auth/guards/staff-login-throttler.guard.ts`) and the OTP request throttle
(`src/customer-auth/customer-auth.controller.ts`) would both effectively multiply their limits by the
instance count without either the code or a test ever telling you.

**Fix**: swap in `@nestjs/throttler`'s Redis storage adapter (`ThrottlerStorageRedisService` from
`@nest-lab/throttler-storage-redis` or equivalent) before this backend is ever deployed as more than one
instance. The DB-backed lockout in `AuthService` (failed-attempt counter + `lockedUntil` on
`StaffAccount`) and the OTP attempt counter (`CustomerOtp.attemptCount`) are NOT affected by this — those
already live in Postgres, not in-memory, so they stay correct across instances regardless.
