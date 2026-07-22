import { UnauthorizedException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtStrategy } from './jwt.strategy';

describe('JwtStrategy', () => {
  const originalSecret = process.env.JWT_SECRET;

  beforeAll(() => {
    process.env.JWT_SECRET = 'test-secret-for-jwt-strategy-spec';
  });

  afterAll(() => {
    process.env.JWT_SECRET = originalSecret;
  });

  it('throws at construction time if JWT_SECRET is not set', () => {
    const secret = process.env.JWT_SECRET;
    delete process.env.JWT_SECRET;
    expect(() => new JwtStrategy()).toThrow(/JWT_SECRET is not set/);
    process.env.JWT_SECRET = secret;
  });

  it('maps a valid payload to { staffId, pumpId, role } on req.user', () => {
    const strategy = new JwtStrategy();
    const result = strategy.validate({
      staffId: 'staff-1',
      pumpId: 'pump-1',
      role: Role.OWNER,
      sub: 'staff-1',
    });
    expect(result).toEqual({ staffId: 'staff-1', pumpId: 'pump-1', role: Role.OWNER });
  });

  it('rejects a payload missing staffId, pumpId, or role', () => {
    const strategy = new JwtStrategy();
    expect(() => strategy.validate({ sub: 'staff-1' } as never)).toThrow(
      UnauthorizedException,
    );
    expect(() =>
      strategy.validate({ staffId: 'staff-1', role: Role.OWNER, sub: 'staff-1' } as never),
    ).toThrow(UnauthorizedException);
  });
});
