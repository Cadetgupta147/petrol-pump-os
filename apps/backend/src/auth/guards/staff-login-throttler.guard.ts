import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

// Section 2/4 login brute-force defense, layer 1 (see
// ../login-throttle.constants.ts for the two-layer design this belongs to).
//
// Differs from customer-auth's CustomerAuthController, which uses the bare
// ThrottlerGuard (pure per-IP keying, see ThrottlerGuard.getTracker's
// default `req.ip`): that's fine there because CustomerAuthService already
// caps attempts per-phone independently of the IP throttle (the live-OTP
// check and the rolling per-phone request-count window in requestOtp()).
// Staff login has no equivalent per-phone request-count cap sitting below
// this guard — AuthService's DB-backed lockout is a per-ACCOUNT failure
// threshold, not a request-count window, and doesn't run until AFTER a
// credential comparison. So if this guard only keyed on IP, one legitimate
// shared office IP with several staff logging in throughout the day would
// either get needlessly blocked by a low per-IP cap, or the cap would have
// to be raised so high it stops being a meaningful defense against a
// targeted brute force against ONE phone number from that same IP. Keying
// on IP + phone together fixes both problems at once: every staff member at
// a shared IP gets their own budget, while repeated attempts against one
// phone number (from that IP) still get capped tightly.
@Injectable()
export class StaffLoginThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    // ValidationPipe (which would normalize/validate LoginDto/PinLoginDto)
    // runs AFTER guards in the Nest request pipeline, so `req.body` here is
    // whatever the raw JSON body parser produced — not yet guaranteed to
    // have a `phone` field, let alone a well-formed one. Fall back to
    // IP-only keying if it's missing or not a string, rather than throwing
    // here: a malformed body should surface as a 400 from the DTO
    // validation that runs later, not get preempted by this guard.
    const phone: unknown = req.body?.phone;
    const ip: string = req.ip;
    if (typeof phone === 'string' && phone.length > 0) {
      return `${ip}-${phone}`;
    }
    return ip;
  }
}
