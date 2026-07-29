import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../prisma/prisma.service';
import { JwtPayload, AuthenticatedUser } from './types/jwt-payload.interface';

// Validates the JWT signature/expiry (passport-jwt handles that part) and
// shapes what ends up on req.user.
//
// This DOES hit the DB on every staff-authenticated request — that's the
// whole point of the tokenVersion "kill switch" (see prisma/schema.prisma's
// StaffAccount.tokenVersion comment, and CustomerJwtStrategy.validate() for
// the identical tradeoff on the customer side): a token that's structurally/
// cryptographically valid must still be rejected once the account's
// tokenVersion has been bumped (e.g. a staff member is deactivated, or a
// device is lost), without waiting for the token's own natural 12h expiry.
// This trades a little latency on every authenticated request for the
// ability to kill one specific session on demand — previously this strategy
// deliberately had NO DB round-trip, relying solely on the token's own
// staffId + role; that tradeoff no longer holds now that revocation matters.
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly prisma: PrismaService) {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
      // Fail loudly at boot rather than silently accepting unsigned/forged
      // tokens — never trust the frontend to enforce permissions, and never
      // run auth with an empty secret.
      throw new Error(
        'JWT_SECRET is not set. Add it to your .env before starting the backend (see .env.example).',
      );
    }
    // Security-audit finding: presence alone doesn't stop someone setting
    // JWT_SECRET="test" or similar. 32 chars is a practical floor for an
    // HS256 HMAC key (matches the generation instructions and the
    // `randomBytes(32).toString('base64')`-style advice already used
    // elsewhere in this codebase, e.g. CREDENTIAL_ENCRYPTION_KEY) — not a
    // perfect entropy measure, but it rules out short/guessable literals
    // without rejecting any secret actually generated per .env.example.
    if (secret.length < 32) {
      throw new Error(
        'JWT_SECRET is too short (must be at least 32 characters) — generate a long random string, e.g. `node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"`.',
      );
    }

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      // Security-audit finding: pin the accepted algorithm explicitly
      // rather than relying on jsonwebtoken's library default. This is a
      // symmetric HS256 secret (no RSA/EC public key exists anywhere in
      // this app to be confused with), and modern jsonwebtoken already
      // rejects `alg: none` by default — so this isn't currently
      // exploitable — but an explicit allowlist means it stays that way
      // regardless of what a future jsonwebtoken/passport-jwt upgrade
      // changes about its own defaults.
      algorithms: ['HS256'],
      secretOrKey: secret,
    });
  }

  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    if (
      !payload?.staffId ||
      !payload?.role ||
      !payload?.pumpId ||
      typeof payload.tokenVersion !== 'number'
    ) {
      throw new UnauthorizedException('Invalid token payload');
    }

    // JwtPayload.staffId is a Staff (per-pump MEMBERSHIP) row id, not a
    // StaffAccount (login identity) id — see that field's comment in
    // types/jwt-payload.interface.ts. tokenVersion lives on the account, so
    // this looks up Staff and reads the joined account's tokenVersion,
    // mirroring how CustomerJwtStrategy looks up Customer and reads
    // customer.account.tokenVersion (not Customer's own id).
    const staff = await this.prisma.staff.findUnique({
      where: { id: payload.staffId },
      select: { account: { select: { tokenVersion: true } } },
    });
    if (!staff || !staff.account || staff.account.tokenVersion !== payload.tokenVersion) {
      throw new UnauthorizedException('Session has been invalidated');
    }

    return { staffId: payload.staffId, pumpId: payload.pumpId, role: payload.role };
  }
}
