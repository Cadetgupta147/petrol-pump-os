import { HttpException, HttpStatus, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';
import { PinLoginDto } from './dto/pin-login.dto';
import { JwtPayload } from './types/jwt-payload.interface';
import { LOGIN_LOCKOUT_DURATION_MS, LOGIN_LOCKOUT_THRESHOLD } from './login-throttle.constants';

// Section 2 — web portal login (Owner/Accountant today; Manager/Read-only
// once those roles get real endpoints) via `login()`, plus Section 4's DSM
// app PIN login (StaffAccount.pinHash) via `pinLogin()`.
//
// Phase 0.2 (docs/multi-tenancy-plan.md): the credential lives on
// StaffAccount (the login identity); the resolved Staff row is the per-pump
// MEMBERSHIP that everything downstream (Bill.enteredById, etc.) actually
// points at. v1 takes the account's first active membership — a person with
// memberships at more than one pump needs a picker UI that doesn't exist
// yet (see the plan doc's "not in scope" list).
@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  async login(dto: LoginDto) {
    const account = await this.prisma.staffAccount.findUnique({
      where: { phone: dto.phone },
    });

    // Same error for "no such account", "inactive account", and "wrong
    // password" — never reveal which part of the credential was wrong
    // (standard login-enumeration hygiene).
    if (!account || !account.active || !account.passwordHash) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Login brute-force defense, layer 2 — checked BEFORE the credential is
    // even compared, so a locked-out account can't be used to keep probing
    // passwords while the lockout is active. See assertAccountNotLockedOut
    // for why this gets a different response shape than the rest of this
    // method.
    this.assertAccountNotLockedOut(account);

    const passwordMatches = await bcrypt.compare(dto.password, account.passwordHash);
    if (!passwordMatches) {
      await this.recordFailedLoginAttempt(account.id, account.failedLoginAttempts);
      throw new UnauthorizedException('Invalid credentials');
    }

    const membership = await this.prisma.staff.findFirst({
      where: { accountId: account.id, active: true },
    });
    if (!membership || !membership.pumpId) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // A prior lockout shouldn't outlive a later successful login. This
    // matters even though a still-active lockout can never reach this line
    // (assertAccountNotLockedOut above would have already rejected it) —
    // it's for the case where lockedUntil expired naturally on its own but
    // failedLoginAttempts was never cleared, since that counter alone
    // doesn't block anything by itself (only lockedUntil does).
    await this.resetLoginLockout(account.id);

    const payload: JwtPayload = {
      staffId: membership.id,
      pumpId: membership.pumpId,
      role: membership.role,
      sub: membership.id,
    };

    return {
      accessToken: await this.jwtService.signAsync(payload),
      staff: {
        id: membership.id,
        name: membership.name,
        phone: account.phone,
        role: membership.role,
      },
    };
  }

  // Section 4 — this is *the DSM app's* login method, but nothing here
  // restricts it to Role.DSM: any account with a pinHash set (Owner/
  // Accountant included, if one is ever provisioned) can use it. Role-based
  // screen routing, if any, is a mobile-app concern, not this endpoint's job.
  async pinLogin(dto: PinLoginDto) {
    const account = await this.prisma.staffAccount.findUnique({
      where: { phone: dto.phone },
    });

    // Same error for "no such account", "inactive account", "no PIN set",
    // and "wrong PIN" — mirrors login()'s enumeration-safety reasoning above.
    if (!account || !account.active || !account.pinHash) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Login brute-force defense, layer 2 — see login()'s identical check
    // above for the full reasoning. PIN login shares the same lockout
    // fields on StaffAccount as password login (a 4-digit PIN has a far
    // smaller keyspace than a password, so this matters at least as much
    // here, arguably more).
    this.assertAccountNotLockedOut(account);

    const pinMatches = await bcrypt.compare(dto.pin, account.pinHash);
    if (!pinMatches) {
      await this.recordFailedLoginAttempt(account.id, account.failedLoginAttempts);
      throw new UnauthorizedException('Invalid credentials');
    }

    const membership = await this.prisma.staff.findFirst({
      where: { accountId: account.id, active: true },
    });
    if (!membership || !membership.pumpId) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // See login()'s identical call above for why this runs even though a
    // still-active lockout can't reach this line.
    await this.resetLoginLockout(account.id);

    const payload: JwtPayload = {
      staffId: membership.id,
      pumpId: membership.pumpId,
      role: membership.role,
      sub: membership.id,
    };

    return {
      accessToken: await this.jwtService.signAsync(payload),
      staff: {
        id: membership.id,
        name: membership.name,
        phone: account.phone,
        role: membership.role,
      },
    };
  }

  // Login brute-force defense, layer 2 (see login-throttle.constants.ts for
  // the full two-layer design). Shared by both login() and pinLogin() since
  // the lockout lives on StaffAccount, not on either credential type
  // specifically.

  // Rejects with 429 if the account is currently within an active lockout
  // window. Deliberately a DIFFERENT response shape than the generic
  // UnauthorizedException('Invalid credentials') used everywhere else in
  // this file — mirrors the OTP rate-limit responses in
  // customer-auth.service.ts: telling a legitimate user "you're locked out,
  // try later" is not a credential-enumeration leak the way revealing
  // "wrong password vs unknown user" would be. It only reveals that SOME
  // account exists at this phone in this particular state, which the
  // lockout's own timing (repeated 429s vs. a 401) would reveal regardless
  // of what the message says.
  private assertAccountNotLockedOut(account: { lockedUntil: Date | null }): void {
    if (account.lockedUntil && account.lockedUntil.getTime() > Date.now()) {
      throw new HttpException(
        'Too many failed attempts. Try again later.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  // Records a failed credential check and locks the account out once the
  // threshold is reached, in a single update.
  //
  // `currentFailedAttempts` is the count as of the findUnique() the caller
  // already did earlier in the same request — used only to decide whether
  // THIS attempt crosses the lockout threshold, so the lockedUntil write can
  // happen in the same round trip as the increment. The increment itself
  // uses Prisma's `{ increment: 1 }` (translates to `SET x = x + 1` in SQL)
  // rather than writing back a JS-computed "current + 1" value, so it stays
  // correct under a race between two concurrent wrong-credential requests
  // for the same account — a plain read-then-write could silently lose one
  // of the two increments. The lockout decision below is necessarily based
  // on the pre-race read, which is a reasonable approximation: worst case, a
  // concurrent burst crosses the threshold and locks out slightly "early"
  // rather than "late" — the safe direction to be wrong in for a
  // brute-force defense.
  private async recordFailedLoginAttempt(
    accountId: string,
    currentFailedAttempts: number,
  ): Promise<void> {
    const nextAttemptCount = currentFailedAttempts + 1;
    await this.prisma.staffAccount.update({
      where: { id: accountId },
      data: {
        failedLoginAttempts: { increment: 1 },
        ...(nextAttemptCount >= LOGIN_LOCKOUT_THRESHOLD
          ? { lockedUntil: new Date(Date.now() + LOGIN_LOCKOUT_DURATION_MS) }
          : {}),
      },
    });
  }

  // Clears both lockout fields after a fully successful login.
  private async resetLoginLockout(accountId: string): Promise<void> {
    await this.prisma.staffAccount.update({
      where: { id: accountId },
      data: { failedLoginAttempts: 0, lockedUntil: null },
    });
  }
}
