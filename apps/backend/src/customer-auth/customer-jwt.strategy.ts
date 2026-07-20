import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../prisma/prisma.service';
import { CustomerJwtPayload, AuthenticatedCustomer } from './types/customer-jwt-payload.interface';

// Registered under the Passport strategy name 'customer-jwt' (the second
// constructor arg to PassportStrategy), NOT the default 'jwt' name the staff
// JwtStrategy uses — this is what lets CustomerJwtAuthGuard
// (AuthGuard('customer-jwt')) and the staff JwtAuthGuard (AuthGuard('jwt'))
// coexist without either accidentally validating the other's tokens.
//
// Verifies against CUSTOMER_JWT_SECRET, a secret distinct from the staff
// JWT_SECRET (see .env.example) — so a customer token is not just
// shaped differently than a staff token, it is cryptographically
// unverifiable under the staff strategy (and vice versa), regardless of
// which strategy name ends up wired to which guard in future refactors.
@Injectable()
export class CustomerJwtStrategy extends PassportStrategy(Strategy, 'customer-jwt') {
  constructor(private readonly prisma: PrismaService) {
    const secret = process.env.CUSTOMER_JWT_SECRET;
    if (!secret) {
      // Fail loudly at boot, same reasoning as the staff JwtStrategy: never
      // run customer auth with an empty/undefined secret.
      throw new Error(
        'CUSTOMER_JWT_SECRET is not set. Add it to your .env before starting the backend (see .env.example).',
      );
    }

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
    });
  }

  // Unlike the staff JwtStrategy (deliberately no DB round-trip per
  // request), this DOES hit the DB on every customer-authenticated request
  // — that's the whole point of the tokenVersion "kill switch" (see
  // prisma/schema.prisma's Customer.tokenVersion comment): a token that's
  // structurally/cryptographically valid must still be rejected once the
  // customer's tokenVersion has been bumped (e.g. lost/stolen phone),
  // without waiting for the token's own expiry.
  async validate(payload: CustomerJwtPayload): Promise<AuthenticatedCustomer> {
    if (
      !payload?.customerId ||
      !payload?.phone ||
      payload.scope !== 'customer' ||
      typeof payload.tokenVersion !== 'number'
    ) {
      throw new UnauthorizedException('Invalid token payload');
    }

    const customer = await this.prisma.customer.findUnique({
      where: { id: payload.customerId },
      select: { tokenVersion: true },
    });
    if (!customer || customer.tokenVersion !== payload.tokenVersion) {
      throw new UnauthorizedException('Session has been invalidated');
    }

    return { customerId: payload.customerId, phone: payload.phone };
  }
}
