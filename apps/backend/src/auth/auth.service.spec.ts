import { UnauthorizedException } from '@nestjs/common';
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
  let prisma: { staffAccount: { findUnique: jest.Mock }; staff: { findFirst: jest.Mock } };
  let jwtService: { signAsync: jest.Mock };

  const knownPassword = 'Correct-Horse-Battery-Staple-1';
  let knownPasswordHash: string;

  beforeAll(async () => {
    knownPasswordHash = await bcrypt.hash(knownPassword, 10);
  });

  beforeEach(async () => {
    prisma = { staffAccount: { findUnique: jest.fn() }, staff: { findFirst: jest.fn() } };
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
      phone: '9990000001',
      role: Role.OWNER,
    });
    expect(jwtService.signAsync).toHaveBeenCalledWith(
      expect.objectContaining({ staffId: 'staff-1', pumpId: 'pump-1', role: Role.OWNER, sub: 'staff-1' }),
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
});

// Section 4 — DSM app PIN login. Mirrors the login() describe block above:
// same enumeration-safety expectations, same mocking pattern.
describe('AuthService.pinLogin', () => {
  let service: AuthService;
  let prisma: { staffAccount: { findUnique: jest.Mock }; staff: { findFirst: jest.Mock } };
  let jwtService: { signAsync: jest.Mock };

  const knownPin = '1234';
  let knownPinHash: string;

  beforeAll(async () => {
    knownPinHash = await bcrypt.hash(knownPin, 10);
  });

  beforeEach(async () => {
    prisma = { staffAccount: { findUnique: jest.fn() }, staff: { findFirst: jest.fn() } };
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
      phone: '9990000004',
      role: Role.DSM,
    });
    expect(jwtService.signAsync).toHaveBeenCalledWith(
      expect.objectContaining({ staffId: 'staff-4', pumpId: 'pump-1', role: Role.DSM, sub: 'staff-4' }),
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
});
