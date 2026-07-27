import { UnauthorizedException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtStrategy } from './jwt.strategy';
import { PrismaService } from '../prisma/prisma.service';

// tokenVersion revocation (mirrors CustomerJwtStrategy's own spec/mocking
// style — see customer-jwt.strategy.spec.ts) — validate() now hits the DB on
// every request, reading the tokenVersion off the joined StaffAccount via
// the Staff (membership) row, so every mock below returns
// { account: { tokenVersion } } instead of a bare payload-only check.
describe('JwtStrategy', () => {
  const originalSecret = process.env.JWT_SECRET;
  let prisma: { staff: { findUnique: jest.Mock } };

  beforeAll(() => {
    process.env.JWT_SECRET = 'test-secret-for-jwt-strategy-spec';
  });

  afterAll(() => {
    process.env.JWT_SECRET = originalSecret;
  });

  beforeEach(() => {
    prisma = { staff: { findUnique: jest.fn() } };
  });

  it('throws at construction time if JWT_SECRET is not set', () => {
    const secret = process.env.JWT_SECRET;
    delete process.env.JWT_SECRET;
    expect(() => new JwtStrategy(prisma as unknown as PrismaService)).toThrow(
      /JWT_SECRET is not set/,
    );
    process.env.JWT_SECRET = secret;
  });

  it('maps a valid payload to { staffId, pumpId, role } when tokenVersion matches the DB value', async () => {
    prisma.staff.findUnique.mockResolvedValue({ account: { tokenVersion: 2 } });
    const strategy = new JwtStrategy(prisma as unknown as PrismaService);

    const result = await strategy.validate({
      staffId: 'staff-1',
      pumpId: 'pump-1',
      role: Role.OWNER,
      tokenVersion: 2,
      sub: 'staff-1',
    });

    expect(result).toEqual({ staffId: 'staff-1', pumpId: 'pump-1', role: Role.OWNER });
    expect(prisma.staff.findUnique).toHaveBeenCalledWith({
      where: { id: 'staff-1' },
      select: { account: { select: { tokenVersion: true } } },
    });
  });

  it('rejects a payload missing staffId, pumpId, role, or tokenVersion without hitting the DB', async () => {
    const strategy = new JwtStrategy(prisma as unknown as PrismaService);
    await expect(strategy.validate({ sub: 'staff-1' } as never)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    await expect(
      strategy.validate({
        staffId: 'staff-1',
        role: Role.OWNER,
        sub: 'staff-1',
      } as never),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(
      strategy.validate({
        staffId: 'staff-1',
        pumpId: 'pump-1',
        role: Role.OWNER,
        sub: 'staff-1',
      } as never),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.staff.findUnique).not.toHaveBeenCalled();
  });

  // The session "kill switch" itself: a structurally/cryptographically valid
  // token must still be rejected once tokenVersion has been bumped in the DB
  // (e.g. the staff member was deactivated) — see
  // prisma/schema.prisma's StaffAccount.tokenVersion comment.
  it('rejects a payload whose tokenVersion no longer matches the DB value', async () => {
    prisma.staff.findUnique.mockResolvedValue({ account: { tokenVersion: 3 } }); // bumped since token was issued
    const strategy = new JwtStrategy(prisma as unknown as PrismaService);

    await expect(
      strategy.validate({
        staffId: 'staff-1',
        pumpId: 'pump-1',
        role: Role.OWNER,
        tokenVersion: 2, // stale — token was signed before the bump
        sub: 'staff-1',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a payload for a Staff membership that no longer exists', async () => {
    prisma.staff.findUnique.mockResolvedValue(null);
    const strategy = new JwtStrategy(prisma as unknown as PrismaService);

    await expect(
      strategy.validate({
        staffId: 'deleted-staff',
        pumpId: 'pump-1',
        role: Role.OWNER,
        tokenVersion: 0,
        sub: 'deleted-staff',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a payload for a Staff membership with no linked account', async () => {
    prisma.staff.findUnique.mockResolvedValue({ account: null });
    const strategy = new JwtStrategy(prisma as unknown as PrismaService);

    await expect(
      strategy.validate({
        staffId: 'staff-1',
        pumpId: 'pump-1',
        role: Role.OWNER,
        tokenVersion: 0,
        sub: 'staff-1',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
