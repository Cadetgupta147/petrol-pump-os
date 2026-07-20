import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ThrottlerModule } from '@nestjs/throttler';
import { CustomerAuthController } from './customer-auth.controller';
import { CustomerAuthService } from './customer-auth.service';
import { CustomerJwtStrategy } from './customer-jwt.strategy';
import { ConsoleOtpProvider } from './otp/console-otp-provider';
import { OTP_PROVIDER } from './otp/otp-provider.interface';
import { OTP_IP_THROTTLE_TTL_MS, OTP_REQUEST_IP_THROTTLE_LIMIT } from './otp.constants';

// Section 5 — Credit Customer App phone+OTP login. Deliberately its own
// module (not folded into the staff AuthModule): a completely separate
// PassportModule registration under the 'customer-jwt' strategy name, its
// own JwtModule instance signing with CUSTOMER_JWT_SECRET (not the staff
// JWT_SECRET), and its own OTP delivery/rate-limit machinery. See
// customer-jwt.strategy.ts for why the separate secret matters.
@Module({
  imports: [
    PassportModule,
    JwtModule.register({
      secret: process.env.CUSTOMER_JWT_SECRET,
      // Longer-lived than the staff token (12h, shift-oriented) since the
      // Credit Customer App isn't shift-scoped — this figure isn't
      // specified anywhere in docs/master-plan.md Section 5 and should be
      // revisited by a human alongside the rest of this slice's open items
      // (see this slice's summary).
      signOptions: { expiresIn: '30d' },
    }),
    ThrottlerModule.forRoot([
      { name: 'default', ttl: OTP_IP_THROTTLE_TTL_MS, limit: OTP_REQUEST_IP_THROTTLE_LIMIT },
    ]),
  ],
  controllers: [CustomerAuthController],
  providers: [
    CustomerAuthService,
    CustomerJwtStrategy,
    { provide: OTP_PROVIDER, useClass: ConsoleOtpProvider },
  ],
})
export class CustomerAuthModule {}
