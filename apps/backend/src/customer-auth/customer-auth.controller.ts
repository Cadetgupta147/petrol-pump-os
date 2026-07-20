import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { Public } from '../auth/decorators/public.decorator';
import { CustomerAuthService } from './customer-auth.service';
import { RequestOtpDto } from './dto/request-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import {
  OTP_IP_THROTTLE_TTL_MS,
  OTP_REQUEST_IP_THROTTLE_LIMIT,
  OTP_VERIFY_IP_THROTTLE_LIMIT,
} from './otp.constants';

// Section 5 — POST /auth/customer/otp/request + POST /auth/customer/otp/verify,
// the real backend for apps/customer-app's placeholder client
// (src/api/customerAuthApi.ts). Both routes are @Public() (they run before
// any token exists, so they must opt out of the global staff JwtAuthGuard —
// see auth/decorators/public.decorator.ts) and additionally guarded by
// ThrottlerGuard for per-IP rate limiting, on top of the per-phone
// rate-limiting/lockout enforced inside CustomerAuthService itself.
@UseGuards(ThrottlerGuard)
@Controller('auth/customer/otp')
export class CustomerAuthController {
  constructor(private readonly customerAuthService: CustomerAuthService) {}

  @Public()
  @Throttle({ default: { limit: OTP_REQUEST_IP_THROTTLE_LIMIT, ttl: OTP_IP_THROTTLE_TTL_MS } })
  @HttpCode(HttpStatus.OK)
  @Post('request')
  requestOtp(@Body() dto: RequestOtpDto) {
    return this.customerAuthService.requestOtp(dto);
  }

  @Public()
  @Throttle({ default: { limit: OTP_VERIFY_IP_THROTTLE_LIMIT, ttl: OTP_IP_THROTTLE_TTL_MS } })
  @HttpCode(HttpStatus.OK)
  @Post('verify')
  verifyOtp(@Body() dto: VerifyOtpDto) {
    return this.customerAuthService.verifyOtp(dto);
  }
}
