import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { PinLoginDto } from './dto/pin-login.dto';
import { Public } from './decorators/public.decorator';
import { CurrentUser } from './decorators/current-user.decorator';
import { AuthenticatedUser } from './types/jwt-payload.interface';
import { StaffLoginThrottlerGuard } from './guards/staff-login-throttler.guard';
import { LOGIN_IP_THROTTLE_LIMIT, LOGIN_IP_THROTTLE_TTL_MS } from './login-throttle.constants';

// Section 2 — /auth/login (web portal) and Section 4 — /auth/pin-login (DSM
// app), the only unauthenticated endpoints besides /health (see
// JwtAuthGuard, registered globally in app.module.ts). Both routes are
// additionally guarded by StaffLoginThrottlerGuard for per-IP+phone request
// throttling, on top of the per-account DB-backed lockout enforced inside
// AuthService itself — see login-throttle.constants.ts for the full
// two-layer brute-force defense this is part of.
@UseGuards(StaffLoginThrottlerGuard)
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Throttle({ default: { limit: LOGIN_IP_THROTTLE_LIMIT, ttl: LOGIN_IP_THROTTLE_TTL_MS } })
  @HttpCode(HttpStatus.OK)
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Public()
  @Throttle({ default: { limit: LOGIN_IP_THROTTLE_LIMIT, ttl: LOGIN_IP_THROTTLE_TTL_MS } })
  @HttpCode(HttpStatus.OK)
  @Post('pin-login')
  pinLogin(@Body() dto: PinLoginDto) {
    return this.authService.pinLogin(dto);
  }

  // Deliberately NOT @Public() — requires the global JwtAuthGuard's normal
  // valid-JWT check, same as any other protected route. Bumps
  // StaffAccount.tokenVersion, which invalidates every outstanding token for
  // this login identity (see AuthService.logout()'s comment) — a stateless
  // JWT can't be un-issued, so "log out" here means "every existing token
  // for this account stops passing JwtStrategy's tokenVersion check from now
  // on", not "delete this one token".
  @HttpCode(HttpStatus.OK)
  @Post('logout')
  async logout(@CurrentUser() user: AuthenticatedUser): Promise<{ success: true }> {
    await this.authService.logout(user.staffId);
    return { success: true };
  }
}
