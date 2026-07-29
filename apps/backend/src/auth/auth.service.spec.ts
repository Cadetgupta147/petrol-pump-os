import { HttpStatus, UnauthorizedException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { Role } from '@prisma/client';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';

// Section 2 login — rule-heavy auth logic (CLAUDE.md: write tests for
// rule-heavy logic). Covers: successful login, wrong password, unknown
// phone, inactive account, no passwordHash set, and no active membership.
//
// Phase 0.2 (docs/multi-tenancy-plan.md): the credential lives on
// StaffAccount; AuthService resolves the account first, then the account's
// active Staff (membership) row, so every mock below needs both.
describe('AuthService', () => {
  let service: AuthService;
  let prisma: {
    staffAccount: { findUnique: jest.Mock; update: jest.Mock };
    staff: { findFirst: jest.Mock };
  };
  let jwtService: { signAsync: jest.Mock };

  const knownPassword = 'Correct-Horse-Battery-Staple-1';
  let knownPasswordHash: string;

  beforeAll(async () => {
    knownPasswordHash = await bcrypt.hash(knownPassword, 10);
  });

  beforeEach(async () => {
    prisma = {
      // update() backs the login-lockout bookkeeping added alongside
      // failedLoginAttempts/lockedUntil (see auth.service.ts's
      // recordFailedLoginAttempt/resetLoginLockout) — every test below
      // exercises a code path that touches it, even the pre-existing ones,
      // since a successful login now always resets the lockout fields.
      staffAccount: { findUnique: jest.fn(), update: jest.fn().mockResolvedValue({}) },
      staff: { findFirst: jest.fn() },
    };
    jwtService = { signAsync: jest.fn().mockResolvedValue('signed.jwt.token') };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: jwtService },
      ],
    }).compile();

    service = module.get(AuthService);
  });

  it('returns a signed JWT + staff summary on correct phone + password', async () => {
    prisma.staffAccount.findUnique.mockResolvedValue({
      id: 'account-1',
      phone: '9990000001',
      passwordHash: knownPasswordHash,
      active: true,
      tokenVersion: 0,
    });
    prisma.staff.findFirst.mockResolvedValue({
      id: 'staff-1',
      accountId: 'account-1',
      pumpId: 'pump-1',
      name: 'Test Owner',
      role: Role.OWNER,
      active: true,
    });

    const result = await service.login({ phone: '9990000001', password: knownPassword });

    expect(result.accessToken).toBe('signed.jwt.token');
    expect(result.staff).toEqual({
      id: 'staff-1',
      name: 'Test Owner',
      role: Role.OWNER,
    });
    expect(jwtService.signAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        staffId: 'staff-1',
        pumpId: 'pump-1',
        role: Role.OWNER,
        tokenVersion: 0,
        sub: 'staff-1',
      }),
    );
    expect(prisma.staff.findFirst).toHaveBeenCalledWith({
      where: { accountId: 'account-1', active: true },
    });
  });

  it('rejects a wrong password with UnauthorizedException', async () => {
    prisma.staffAccount.findUnique.mockResolvedValue({
      id: 'account-1',
      phone: '9990000001',
      passwordHash: knownPasswordHash,
      active: true,
    });

    await expect(
      service.login({ phone: '9990000001', password: 'wrong-password' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(jwtService.signAsync).not.toHaveBeenCalled();
  });

  it('rejects an unknown phone with UnauthorizedException (no user enumeration)', async () => {
    prisma.staffAccount.findUnique.mockResolvedValue(null);

    await expect(
      service.login({ phone: '0000000000', password: knownPassword }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects login for an inactive account', async () => {
    prisma.staffAccount.findUnique.mockResolvedValue({
      id: 'account-2',
      phone: '9990000002',
      passwordHash: knownPasswordHash,
      active: false,
    });

    await expect(
      service.login({ phone: '9990000002', password: knownPassword }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects login for an account with no passwordHash set (DSM-only PIN login account)', async () => {
    prisma.staffAccount.findUnique.mockResolvedValue({
      id: 'account-3',
      phone: '9990000003',
      passwordHash: null,
      active: true,
    });

    await expect(
      service.login({ phone: '9990000003', password: 'anything' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects login for an account with no active membership at any pump', async () => {
    prisma.staffAccount.findUnique.mockResolvedValue({
      id: 'account-4',
      phone: '9990000007',
      passwordHash: knownPasswordHash,
      active: true,
    });
    prisma.staff.findFirst.mockResolvedValue(null);

    await expect(
      service.login({ phone: '9990000007', password: knownPassword }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(jwtService.signAsync).not.toHaveBeenCalled();
  });

  // Login brute-force defense, layer 2 (see login-throttle.constants.ts) —
  // rule-heavy logic per CLAUDE.md, hence the dedicated coverage below.
  it('rejects a locked-out account with a 429 BEFORE the password is ever compared', async () => {
    prisma.staffAccount.findUnique.mockResolvedValue({
      id: 'account-locked',
      phone: '9990000009',
      passwordHash: knownPasswordHash,
      active: true,
      failedLoginAttempts: 5,
      lockedUntil: new Date(Date.now() + 10 * 60 * 1000), // still 10 minutes out
    });

    // Deliberately supply the CORRECT password — if the lockout check ran
    // after (or didn't run at all), this would otherwise succeed.
    await expect(
      service.login({ phone: '9990000009', password: knownPassword }),
    ).rejects.toMatchObject({ status: HttpStatus.TOO_MANY_REQUESTS });
    expect(jwtService.signAsync).not.toHaveBeenCalled();
    // No bookkeeping update should happen either — the request never got
    // far enough to compare a credential, so there's nothing to record.
    expect(prisma.staffAccount.update).not.toHaveBeenCalled();
  });

  it('allows login once a past lockout has naturally expired', async () => {
    prisma.staffAccount.findUnique.mockResolvedValue({
      id: 'account-expired-lock',
      phone: '9990000010',
      passwordHash: knownPasswordHash,
      active: true,
      failedLoginAttempts: 5,
      lockedUntil: new Date(Date.now() - 1000), // expired 1 second ago
    });
    prisma.staff.findFirst.mockResolvedValue({
      id: 'staff-10',
      accountId: 'account-expired-lock',
      pumpId: 'pump-1',
      name: 'Test Owner',
      role: Role.OWNER,
      active: true,
    });

    const result = await service.login({ phone: '9990000010', password: knownPassword });
    expect(result.accessToken).toBe('signed.jwt.token');
  });

  it('increments failedLoginAttempts on a wrong password (atomic increment, not read-then-write)', async () => {
    prisma.staffAccount.findUnique.mockResolvedValue({
      id: 'account-11',
      phone: '9990000011',
      passwordHash: knownPasswordHash,
      active: true,
      failedLoginAttempts: 2,
      lockedUntil: null,
      lockoutEscalationLevel: 0,
    });

    await expect(
      service.login({ phone: '9990000011', password: 'wrong-password' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(prisma.staffAccount.update).toHaveBeenCalledWith({
      where: { id: 'account-11' },
      data: { failedLoginAttempts: { increment: 1 } },
    });
  });

  it('sets lockedUntil to a 2-minute cooldown the FIRST time the failed-attempt threshold is reached', async () => {
    prisma.staffAccount.findUnique.mockResolvedValue({
      id: 'account-12',
      phone: '9990000012',
      passwordHash: knownPasswordHash,
      active: true,
      failedLoginAttempts: 4, // this attempt is the 5th — crosses the threshold
      lockedUntil: null,
      lockoutEscalationLevel: 0, // never locked out before — lands on rung 1
    });

    const before = Date.now();
    await expect(
      service.login({ phone: '9990000012', password: 'wrong-password' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(prisma.staffAccount.update).toHaveBeenCalledWith({
      where: { id: 'account-12' },
      data: {
        failedLoginAttempts: { increment: 1 },
        lockoutEscalationLevel: { increment: 1 },
        lockedUntil: expect.any(Date),
      },
    });
    const call = prisma.staffAccount.update.mock.calls[0][0] as {
      data: { lockedUntil: Date };
    };
    const lockedForMs = call.data.lockedUntil.getTime() - before;
    // ~2 minutes — generous bounds to absorb test execution jitter.
    expect(lockedForMs).toBeGreaterThan(1.5 * 60 * 1000);
    expect(lockedForMs).toBeLessThanOrEqual(2 * 60 * 1000 + 1000);
  });

  // Escalating lockout (Section 2 amendment) — a SECOND lockout (the
  // account crosses the threshold again after already having been locked
  // out once before) must escalate to the 15-minute rung, not repeat the
  // 2-minute one.
  it('escalates to a 15-minute cooldown on the SECOND lockout', async () => {
    prisma.staffAccount.findUnique.mockResolvedValue({
      id: 'account-12b',
      phone: '9990000018',
      passwordHash: knownPasswordHash,
      active: true,
      failedLoginAttempts: 4,
      lockedUntil: null,
      lockoutEscalationLevel: 1, // already locked out once before
    });

    const before = Date.now();
    await expect(
      service.login({ phone: '9990000018', password: 'wrong-password' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    const call = prisma.staffAccount.update.mock.calls[0][0] as {
      data: { lockedUntil: Date };
    };
    const lockedForMs = call.data.lockedUntil.getTime() - before;
    expect(lockedForMs).toBeGreaterThan(14 * 60 * 1000);
    expect(lockedForMs).toBeLessThanOrEqual(15 * 60 * 1000 + 1000);
  });

  // Third and every subsequent lockout escalates to (and stays at) 1 hour.
  it('escalates to a 1-hour cooldown on the THIRD lockout, and stays there on a fourth', async () => {
    for (const priorLevel of [2, 3]) {
      prisma.staffAccount.update.mockClear();
      prisma.staffAccount.findUnique.mockResolvedValue({
        id: 'account-12c',
        phone: '9990000019',
        passwordHash: knownPasswordHash,
        active: true,
        failedLoginAttempts: 4,
        lockedUntil: null,
        lockoutEscalationLevel: priorLevel,
      });

      const before = Date.now();
      await expect(
        service.login({ phone: '9990000019', password: 'wrong-password' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);

      const call = prisma.staffAccount.update.mock.calls[0][0] as {
        data: { lockedUntil: Date };
      };
      const lockedForMs = call.data.lockedUntil.getTime() - before;
      expect(lockedForMs).toBeGreaterThan(59 * 60 * 1000);
      expect(lockedForMs).toBeLessThanOrEqual(60 * 60 * 1000 + 1000);
    }
  });

  it('resets failedLoginAttempts, lockedUntil, and lockoutEscalationLevel to 0/null on a successful login', async () => {
    prisma.staffAccount.findUnique.mockResolvedValue({
      id: 'account-13',
      phone: '9990000013',
      passwordHash: knownPasswordHash,
      active: true,
      failedLoginAttempts: 3,
      lockedUntil: null,
      lockoutEscalationLevel: 2,
    });
    prisma.staff.findFirst.mockResolvedValue({
      id: 'staff-13',
      accountId: 'account-13',
      pumpId: 'pump-1',
      name: 'Test Owner',
      role: Role.OWNER,
      active: true,
    });

    const result = await service.login({ phone: '9990000013', password: knownPassword });

    expect(result.accessToken).toBe('signed.jwt.token');
    expect(prisma.staffAccount.update).toHaveBeenCalledWith({
      where: { id: 'account-13' },
      data: { failedLoginAttempts: 0, lockedUntil: null, lockoutEscalationLevel: 0 },
    });
  });

  // A successful login must fully clear the escalation ladder, not just the
  // immediate lockout — so a LATER lockout (after a clean login in between)
  // starts back at the bottom (2-minute) rung rather than continuing from
  // wherever the ladder left off.
  it('restarts the escalation ladder at the 2-minute rung after a successful login resets it', async () => {
    // First: this account had already escalated to level 2 (would be a
    // 1-hour lockout next) — but then logs in successfully.
    prisma.staffAccount.findUnique.mockResolvedValueOnce({
      id: 'account-14',
      phone: '9990000020',
      passwordHash: knownPasswordHash,
      active: true,
      failedLoginAttempts: 3,
      lockedUntil: null,
      lockoutEscalationLevel: 2,
    });
    prisma.staff.findFirst.mockResolvedValueOnce({
      id: 'staff-14',
      accountId: 'account-14',
      pumpId: 'pump-1',
      name: 'Test Owner',
      role: Role.OWNER,
      active: true,
    });
    await service.login({ phone: '9990000020', password: knownPassword });
    expect(prisma.staffAccount.update).toHaveBeenLastCalledWith({
      where: { id: 'account-14' },
      data: { failedLoginAttempts: 0, lockedUntil: null, lockoutEscalationLevel: 0 },
    });

    // Now the account fails through to a lockout again — since the reset
    // above zeroed lockoutEscalationLevel, findUnique reflects level 0 for
    // this next read.
    prisma.staffAccount.update.mockClear();
    prisma.staffAccount.findUnique.mockResolvedValueOnce({
      id: 'account-14',
      phone: '9990000020',
      passwordHash: knownPasswordHash,
      active: true,
      failedLoginAttempts: 4,
      lockedUntil: null,
      lockoutEscalationLevel: 0,
    });

    const before = Date.now();
    await expect(
      service.login({ phone: '9990000020', password: 'wrong-password' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    const call = prisma.staffAccount.update.mock.calls[0][0] as {
      data: { lockedUntil: Date };
    };
    const lockedForMs = call.data.lockedUntil.getTime() - before;
    // Back to the SHORT 2-minute rung, not a continuation at 1 hour.
    expect(lockedForMs).toBeGreaterThan(1.5 * 60 * 1000);
    expect(lockedForMs).toBeLessThanOrEqual(2 * 60 * 1000 + 1000);
  });
});

// Section 4 — DSM app PIN login. Mirrors the login() describe block above:
// same enumeration-safety expectations, same mocking pattern.
describe('AuthService.pinLogin', () => {
  let service: AuthService;
  let prisma: {
    staffAccount: { findUnique: jest.Mock; update: jest.Mock };
    staff: { findFirst: jest.Mock };
  };
  let jwtService: { signAsync: jest.Mock };

  const knownPin = '1234';
  let knownPinHash: string;

  beforeAll(async () => {
    knownPinHash = await bcrypt.hash(knownPin, 10);
  });

  beforeEach(async () => {
    prisma = {
      staffAccount: { findUnique: jest.fn(), update: jest.fn().mockResolvedValue({}) },
      staff: { findFirst: jest.fn() },
    };
    jwtService = { signAsync: jest.fn().mockResolvedValue('signed.jwt.token') };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: jwtService },
      ],
    }).compile();

    service = module.get(AuthService);
  });

  it('returns a signed JWT + staff summary on correct phone + PIN', async () => {
    prisma.staffAccount.findUnique.mockResolvedValue({
      id: 'account-4',
      phone: '9990000004',
      pinHash: knownPinHash,
      active: true,
      tokenVersion: 1,
    });
    prisma.staff.findFirst.mockResolvedValue({
      id: 'staff-4',
      accountId: 'account-4',
      pumpId: 'pump-1',
      name: 'Test DSM',
      role: Role.DSM,
      active: true,
    });

    const result = await service.pinLogin({ phone: '9990000004', pin: knownPin });

    expect(result.accessToken).toBe('signed.jwt.token');
    expect(result.staff).toEqual({
      id: 'staff-4',
      name: 'Test DSM',
      role: Role.DSM,
    });
    expect(jwtService.signAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        staffId: 'staff-4',
        pumpId: 'pump-1',
        role: Role.DSM,
        tokenVersion: 1,
        sub: 'staff-4',
      }),
    );
  });

  it('rejects a wrong PIN with UnauthorizedException', async () => {
    prisma.staffAccount.findUnique.mockResolvedValue({
      id: 'account-4',
      phone: '9990000004',
      pinHash: knownPinHash,
      active: true,
    });

    await expect(
      service.pinLogin({ phone: '9990000004', pin: '9999' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(jwtService.signAsync).not.toHaveBeenCalled();
  });

  it('rejects an unknown phone with UnauthorizedException (no user enumeration)', async () => {
    prisma.staffAccount.findUnique.mockResolvedValue(null);

    await expect(
      service.pinLogin({ phone: '0000000000', pin: knownPin }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects PIN login for an inactive account', async () => {
    prisma.staffAccount.findUnique.mockResolvedValue({
      id: 'account-5',
      phone: '9990000005',
      pinHash: knownPinHash,
      active: false,
    });

    await expect(
      service.pinLogin({ phone: '9990000005', pin: knownPin }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects PIN login for an account with no pinHash set (web-portal-only account)', async () => {
    prisma.staffAccount.findUnique.mockResolvedValue({
      id: 'account-6',
      phone: '9990000006',
      pinHash: null,
      active: true,
    });

    await expect(
      service.pinLogin({ phone: '9990000006', pin: 'anything' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects PIN login for an account with no active membership at any pump', async () => {
    prisma.staffAccount.findUnique.mockResolvedValue({
      id: 'account-7',
      phone: '9990000008',
      pinHash: knownPinHash,
      active: true,
    });
    prisma.staff.findFirst.mockResolvedValue(null);

    await expect(
      service.pinLogin({ phone: '9990000008', pin: knownPin }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(jwtService.signAsync).not.toHaveBeenCalled();
  });

  // Login brute-force defense, layer 2 — mirrors the login() coverage
  // above; pinLogin() shares the same lockout fields/private helpers.
  it('rejects a locked-out account with a 429 BEFORE the PIN is ever compared', async () => {
    prisma.staffAccount.findUnique.mockResolvedValue({
      id: 'account-locked-pin',
      phone: '9990000014',
      pinHash: knownPinHash,
      active: true,
      failedLoginAttempts: 5,
      lockedUntil: new Date(Date.now() + 10 * 60 * 1000),
    });

    await expect(
      service.pinLogin({ phone: '9990000014', pin: knownPin }),
    ).rejects.toMatchObject({ status: HttpStatus.TOO_MANY_REQUESTS });
    expect(jwtService.signAsync).not.toHaveBeenCalled();
    expect(prisma.staffAccount.update).not.toHaveBeenCalled();
  });

  it('increments failedLoginAttempts on a wrong PIN (atomic increment, not read-then-write)', async () => {
    prisma.staffAccount.findUnique.mockResolvedValue({
      id: 'account-15',
      phone: '9990000015',
      pinHash: knownPinHash,
      active: true,
      failedLoginAttempts: 1,
      lockedUntil: null,
    });

    await expect(
      service.pinLogin({ phone: '9990000015', pin: '0000' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(prisma.staffAccount.update).toHaveBeenCalledWith({
      where: { id: 'account-15' },
      data: { failedLoginAttempts: { increment: 1 } },
    });
  });

  it('sets lockedUntil to a 2-minute cooldown once the failed-attempt threshold is reached (first lockout)', async () => {
    prisma.staffAccount.findUnique.mockResolvedValue({
      id: 'account-16',
      phone: '9990000016',
      pinHash: knownPinHash,
      active: true,
      failedLoginAttempts: 4,
      lockedUntil: null,
      lockoutEscalationLevel: 0,
    });

    const before = Date.now();
    await expect(
      service.pinLogin({ phone: '9990000016', pin: '0000' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(prisma.staffAccount.update).toHaveBeenCalledWith({
      where: { id: 'account-16' },
      data: {
        failedLoginAttempts: { increment: 1 },
        lockoutEscalationLevel: { increment: 1 },
        lockedUntil: expect.any(Date),
      },
    });
    const call = prisma.staffAccount.update.mock.calls[0][0] as {
      data: { lockedUntil: Date };
    };
    const lockedForMs = call.data.lockedUntil.getTime() - before;
    expect(lockedForMs).toBeGreaterThan(1.5 * 60 * 1000);
    expect(lockedForMs).toBeLessThanOrEqual(2 * 60 * 1000 + 1000);
  });

  it('resets failedLoginAttempts, lockedUntil, and lockoutEscalationLevel to 0/null on a successful PIN login', async () => {
    prisma.staffAccount.findUnique.mockResolvedValue({
      id: 'account-17',
      phone: '9990000017',
      pinHash: knownPinHash,
      active: true,
      failedLoginAttempts: 2,
      lockedUntil: null,
      lockoutEscalationLevel: 1,
    });
    prisma.staff.findFirst.mockResolvedValue({
      id: 'staff-17',
      accountId: 'account-17',
      pumpId: 'pump-1',
      name: 'Test DSM',
      role: Role.DSM,
      active: true,
    });

    const result = await service.pinLogin({ phone: '9990000017', pin: knownPin });

    expect(result.accessToken).toBe('signed.jwt.token');
    expect(prisma.staffAccount.update).toHaveBeenCalledWith({
      where: { id: 'account-17' },
      data: { failedLoginAttempts: 0, lockedUntil: null, lockoutEscalationLevel: 0 },
    });
  });
});

// Security-audit finding: no self-service way to invalidate a staff JWT
// existed before this — see AuthService.logout()'s comment.
describe('AuthService.logout', () => {
  let service: AuthService;
  let prisma: {
    staff: { findUnique: jest.Mock };
    staffAccount: { update: jest.Mock };
    $transaction: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      staff: { findUnique: jest.fn() },
      staffAccount: { update: jest.fn().mockResolvedValue({}) },
      $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(prisma)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: { signAsync: jest.fn() } },
      ],
    }).compile();

    service = module.get(AuthService);
  });

  it('bumps StaffAccount.tokenVersion for the calling staff member\'s account', async () => {
    prisma.staff.findUnique.mockResolvedValue({ accountId: 'account-99' });

    await service.logout('staff-99');

    expect(prisma.staff.findUnique).toHaveBeenCalledWith({
      where: { id: 'staff-99' },
      select: { accountId: true },
    });
    expect(prisma.staffAccount.update).toHaveBeenCalledWith({
      where: { id: 'account-99' },
      data: { tokenVersion: { increment: 1 } },
    });
  });

  it('throws NotFoundException if the staff membership has no linked account', async () => {
    prisma.staff.findUnique.mockResolvedValue({ accountId: null });

    await expect(service.logout('staff-orphan')).rejects.toThrow(
      'Staff membership not found',
    );
    expect(prisma.staffAccount.update).not.toHaveBeenCalled();
  });
});
