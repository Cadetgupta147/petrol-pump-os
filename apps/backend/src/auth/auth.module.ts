import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';
import { LOGIN_IP_THROTTLE_LIMIT, LOGIN_IP_THROTTLE_TTL_MS } from './login-throttle.constants';

@Module({
  imports: [
    PassportModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET,
      signOptions: { expiresIn: '12h' }, // matches a typical shift-plus-buffer window
    }),
    // Login brute-force defense, layer 1 — see login-throttle.constants.ts
    // and guards/staff-login-throttler.guard.ts for the full two-layer
    // design (this per-IP+phone request throttle plus the DB-backed
    // AuthService lockout). Registered here, per-module, rather than
    // globally in app.module.ts — mirrors CustomerAuthModule's own
    // ThrottlerModule registration; each feature owns its own rate-limit
    // policy instead of sharing one global one.
    ThrottlerModule.forRoot([
      { name: 'default', ttl: LOGIN_IP_THROTTLE_TTL_MS, limit: LOGIN_IP_THROTTLE_LIMIT },
    ]),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy],
})
export class AuthModule {}
