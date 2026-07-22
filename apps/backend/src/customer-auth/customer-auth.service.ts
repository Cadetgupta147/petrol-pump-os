import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { randomInt } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { RequestOtpDto } from './dto/request-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { CustomerJwtPayload } from './types/customer-jwt-payload.interface';
import { OTP_PROVIDER, OtpProvider } from './otp/otp-provider.interface';
import {
  MAX_OTP_REQUESTS_PER_PHONE_PER_WINDOW,
  MAX_OTP_VERIFY_ATTEMPTS,
  OTP_REQUEST_RATE_LIMIT_WINDOW_SECONDS,
  OTP_TTL_SECONDS,
} from './otp.constants';

// Section 5 — Credit Customer App login: phone + OTP, no password. See
// prisma/schema.prisma's CustomerOtp model comment for the storage design,
// and otp.constants.ts for the rate-limit/lockout tunables used below.
@Injectable()
export class CustomerAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    @Inject(OTP_PROVIDER) private readonly otpProvider: OtpProvider,
  ) {}

  async requestOtp(dto: RequestOtpDto) {
    const { phone } = dto;
    const now = new Date();

    // Rate-limit rule 1: only one *live* (unexpired, unconsumed) OTP per
    // phone at a time. apps/customer-app's OtpEntryScreen already disables
    // its own "Resend OTP" button until `expiresInSeconds` counts down to
    // zero — this enforces that same rule server-side, since CLAUDE.md
    // forbids relying on the frontend alone for a security control.
    const liveOtp = await this.prisma.customerOtp.findFirst({
      where: { phone, consumedAt: null, expiresAt: { gt: now } },
      orderBy: { createdAt: 'desc' },
    });
    if (liveOtp) {
      const secondsRemaining = Math.ceil(
        (liveOtp.expiresAt.getTime() - now.getTime()) / 1000,
      );
      throw new HttpException(
        {
          message: `An OTP was already sent to this number. Please wait ${secondsRemaining}s before requesting another.`,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // Rate-limit rule 2: cap total requests per phone within a rolling
    // window, so an attacker can't just wait out each expiry in a loop and
    // keep triggering OTP sends indefinitely (every send is a real SMS cost
    // once a real provider is wired in — see otp/otp-provider.interface.ts).
    const windowStart = new Date(
      now.getTime() - OTP_REQUEST_RATE_LIMIT_WINDOW_SECONDS * 1000,
    );
    const recentRequestCount = await this.prisma.customerOtp.count({
      where: { phone, createdAt: { gt: windowStart } },
    });
    if (recentRequestCount >= MAX_OTP_REQUESTS_PER_PHONE_PER_WINDOW) {
      throw new HttpException(
        { message: 'Too many OTP requests for this number. Please try again later.' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // 6-digit numeric OTP, cryptographically random (never Math.random()).
    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const codeHash = await bcrypt.hash(code, 10);
    const expiresAt = new Date(now.getTime() + OTP_TTL_SECONDS * 1000);

    // Best-effort link to an existing Customer, if one is already
    // registered under this phone (see prisma/schema.prisma CustomerOtp
    // comment) — this does NOT change the response, so the request
    // endpoint never reveals whether a phone number has an account.
    //
    // Phase 0.2 (docs/multi-tenancy-plan.md): Customer.phone is no longer
    // unique (one CustomerAccount can have a membership at more than one
    // pump) — findFirst, not findUnique. v1 takes whichever membership
    // matches first; a multi-pump picker isn't built yet (see the plan
    // doc's "not in scope" list).
    const existingCustomer = await this.prisma.customer.findFirst({
      where: { phone },
      select: { id: true, pumpId: true },
    });

    const otpRow = await this.prisma.customerOtp.create({
      data: {
        phone,
        customerId: existingCustomer?.id,
        // Phase 0.3 (docs/multi-tenancy-plan.md) — best-effort only:
        // resolved from the matched customer's own pump when one exists,
        // left null for an unregistered phone (no pump to attribute it to
        // — see CustomerOtp's schema comment for why this is the one
        // tenant table that stays nullable). Never load-bearing either
        // way: verifyOtp() always re-resolves pumpId fresh from a real
        // Customer lookup for the JWT, never from this row.
        pumpId: existingCustomer?.pumpId,
        codeHash,
        expiresAt,
      },
    });

    await this.otpProvider.sendOtp(phone, code);

    return {
      requestId: otpRow.id,
      expiresInSeconds: OTP_TTL_SECONDS,
      // Dev convenience ONLY — never included outside NODE_ENV=development.
      // The real delivery channel (SMS/WhatsApp provider, Section 17 open
      // item) is not wired up yet; ConsoleOtpProvider logs this same code to
      // the server console under the identical NODE_ENV=development guard
      // (see otp/console-otp-provider.ts) — the two never diverge.
      ...(process.env.NODE_ENV === 'development' ? { otp: code } : {}),
    };
  }

  async verifyOtp(dto: VerifyOtpDto) {
    const { phone, otp, requestId } = dto;
    const now = new Date();

    const otpRow = await this.prisma.customerOtp.findUnique({
      where: { id: requestId },
    });

    // Same generic "invalid or expired" message for every failure mode
    // (no row, phone mismatch, already consumed, expired, locked out, wrong
    // code) — mirrors the staff AuthService's enumeration-safety pattern:
    // never let a caller distinguish *why* verification failed.
    const genericFailure = () =>
      new UnauthorizedException('Invalid or expired OTP');

    if (!otpRow || otpRow.phone !== phone) {
      throw genericFailure();
    }
    if (otpRow.consumedAt) {
      throw genericFailure();
    }
    if (otpRow.expiresAt.getTime() < now.getTime()) {
      throw genericFailure();
    }
    if (otpRow.attemptCount >= MAX_OTP_VERIFY_ATTEMPTS) {
      // Already locked out from a previous call — make sure it's marked
      // consumed so it can never be retried again even if this exact race
      // is hit repeatedly.
      await this.prisma.customerOtp.update({
        where: { id: otpRow.id },
        data: { consumedAt: now },
      });
      throw genericFailure();
    }

    const codeMatches = await bcrypt.compare(otp, otpRow.codeHash);
    if (!codeMatches) {
      const nextAttemptCount = otpRow.attemptCount + 1;
      await this.prisma.customerOtp.update({
        where: { id: otpRow.id },
        data: {
          attemptCount: nextAttemptCount,
          // Lock out immediately once the threshold is reached, rather than
          // waiting for one more failed call to notice.
          ...(nextAttemptCount >= MAX_OTP_VERIFY_ATTEMPTS
            ? { consumedAt: now }
            : {}),
        },
      });
      throw genericFailure();
    }

    // Correct code — the Customer record must already exist (Section 5's
    // login flow is for existing loyalty/credit customers onboarded via the
    // dealer's web portal, Section 3.4; this is not a self-signup flow).
    // Look this up BEFORE consuming the OTP so a customer who genuinely
    // isn't registered yet can still get a clear error without burning
    // their one valid OTP entry on it.
    //
    // Phase 0.2 (docs/multi-tenancy-plan.md): every Customer created via
    // POST /customers gets a linked CustomerAccount automatically
    // (CustomersService.create()), so a phone with a Customer row should
    // always have one — the !customer.account branch below is a defensive
    // check for a legacy/inconsistent row, not an expected path.
    // findFirst (not findUnique) — Customer.phone is no longer unique post
    // account/membership split (see the comment on requestOtp()'s lookup
    // above for why).
    const customer = await this.prisma.customer.findFirst({
      where: { phone },
      include: { account: true },
    });
    if (!customer || !customer.account || !customer.pumpId) {
      throw new NotFoundException(
        "This number isn't registered yet — ask at the pump counter to get set up.",
      );
    }

    // Single-use: mark consumed only once we know verification fully
    // succeeds (correct code + real account).
    await this.prisma.customerOtp.update({
      where: { id: otpRow.id },
      data: { consumedAt: now },
    });

    const payload: CustomerJwtPayload = {
      customerId: customer.id,
      pumpId: customer.pumpId,
      phone: customer.phone ?? phone,
      scope: 'customer',
      tokenVersion: customer.account.tokenVersion,
      sub: customer.id,
    };

    return {
      accessToken: await this.jwtService.signAsync(payload),
      customer: {
        id: customer.id,
        name: customer.name,
        phone: customer.phone,
        qrMemberId: customer.qrMemberId,
        vehicleNumber: customer.vehicleNumber,
      },
    };
  }
}
