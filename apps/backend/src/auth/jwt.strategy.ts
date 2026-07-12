import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { JwtPayload, AuthenticatedUser } from './types/jwt-payload.interface';

// Validates the JWT signature/expiry (passport-jwt handles that part) and
// shapes what ends up on req.user. No DB round-trip here on purpose — the
// token already carries staffId + role (see AuthService.login).
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
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

  validate(payload: JwtPayload): AuthenticatedUser {
    if (!payload?.staffId || !payload?.role) {
      throw new UnauthorizedException('Invalid token payload');
    }
    return { staffId: payload.staffId, role: payload.role };
  }
}
