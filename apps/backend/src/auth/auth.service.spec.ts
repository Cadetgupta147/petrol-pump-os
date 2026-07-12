import { UnauthorizedException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { Role } from '@prisma/client';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';

// Section 2 login — rule-heavy auth logic (CLAUDE.md: write tests for
// rule-heavy logic). Covers: successful login, wrong password, unknown
// phone, inactive staff, and staff with no passwordHash set (DSM-only staff
// shouldn't be able to log in to the web portal at all).
describe('AuthService', () => {
  let service: AuthService;
  let prisma: { staff: { findUnique: jest.Mock } };
  let jwtService: { signAsync: jest.Mock };

  const knownPassword = 'Correct-Horse-Battery-Staple-1';
  let knownPasswordHash: string;

  beforeAll(async () => {
    knownPasswordHash = await bcrypt.hash(knownPassword, 10);
  });

  beforeEach(async () => {
    prisma = { staff: { findUnique: jest.fn() } };
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
    prisma.staff.findUnique.mockResolvedValue({
      id: 'staff-1',
      name: 'Test Owner',
      phone: '9990000001',
      role: Role.OWNER,
      passwordHash: knownPasswordHash,
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
      expect.objectContaining({ staffId: 'staff-1', role: Role.OWNER, sub: 'staff-1' }),
    );
  });

  it('rejects a wrong password with UnauthorizedException', async () => {
    prisma.staff.findUnique.mockResolvedValue({
      id: 'staff-1',
      name: 'Test Owner',
      phone: '9990000001',
      role: Role.OWNER,
      passwordHash: knownPasswordHash,
      active: true,
    });

    await expect(
      service.login({ phone: '9990000001', password: 'wrong-password' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(jwtService.signAsync).not.toHaveBeenCalled();
  });

  it('rejects an unknown phone with UnauthorizedException (no user enumeration)', async () => {
    prisma.staff.findUnique.mockResolvedValue(null);

    await expect(
      service.login({ phone: '0000000000', password: knownPassword }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects login for an inactive staff member', async () => {
    prisma.staff.findUnique.mockResolvedValue({
      id: 'staff-1',
      name: 'Deactivated Accountant',
      phone: '9990000002',
      role: Role.ACCOUNTANT,
      passwordHash: knownPasswordHash,
      active: false,
    });

    await expect(
      service.login({ phone: '9990000002', password: knownPassword }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects login for staff with no passwordHash set (DSM-only PIN login staff)', async () => {
    prisma.staff.findUnique.mockResolvedValue({
      id: 'staff-3',
      name: 'DSM Staff',
      phone: '9990000003',
      role: Role.DSM,
      passwordHash: null,
      active: true,
    });

    await expect(
      service.login({ phone: '9990000003', password: 'anything' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
