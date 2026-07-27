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

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
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
