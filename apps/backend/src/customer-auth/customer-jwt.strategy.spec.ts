import { UnauthorizedException } from '@nestjs/common';
import { CustomerJwtStrategy } from './customer-jwt.strategy';
import { PrismaService } from '../prisma/prisma.service';

// Phase 0.2 (docs/multi-tenancy-plan.md): tokenVersion moved from Customer
// (the membership row) to CustomerAccount (the login identity) — validate()
// now reads it via the joined account, so every mock below returns
// { account: { tokenVersion } } instead of a bare { tokenVersion }.
describe('CustomerJwtStrategy', () => {
  const originalSecret = process.env.CUSTOMER_JWT_SECRET;
  let prisma: { customer: { findUnique: jest.Mock } };

  beforeAll(() => {
    process.env.CUSTOMER_JWT_SECRET = 'test-secret-for-customer-jwt-strategy-spec';
  });

  afterAll(() => {
    process.env.CUSTOMER_JWT_SECRET = originalSecret;
  });

  beforeEach(() => {
    prisma = { customer: { findUnique: jest.fn() } };
  });

  it('throws at construction time if CUSTOMER_JWT_SECRET is not set', () => {
    const secret = process.env.CUSTOMER_JWT_SECRET;
    delete process.env.CUSTOMER_JWT_SECRET;
    expect(() => new CustomerJwtStrategy(prisma as unknown as PrismaService)).toThrow(
      /CUSTOMER_JWT_SECRET is not set/,
    );
    process.env.CUSTOMER_JWT_SECRET = secret;
  });

  it('maps a valid payload to { customerId, pumpId, phone } when tokenVersion matches the DB value', async () => {
    prisma.customer.findUnique.mockResolvedValue({ account: { tokenVersion: 3 } });
    const strategy = new CustomerJwtStrategy(prisma as unknown as PrismaService);

    const result = await strategy.validate({
      customerId: 'customer-1',
      pumpId: 'pump-1',
      phone: '9990000001',
      scope: 'customer',
      tokenVersion: 3,
      sub: 'customer-1',
    });

    expect(result).toEqual({ customerId: 'customer-1', pumpId: 'pump-1', phone: '9990000001' });
    expect(prisma.customer.findUnique).toHaveBeenCalledWith({
      where: { id: 'customer-1' },
      select: { account: { select: { tokenVersion: true } } },
    });
  });

  // The session "kill switch" itself: a structurally/cryptographically
  // valid token must still be rejected once tokenVersion has been bumped in
  // the DB (e.g. a lost/stolen phone) — this is the entire point of the
  // claim, see prisma/schema.prisma's CustomerAccount.tokenVersion comment.
  it('rejects a payload whose tokenVersion no longer matches the DB value', async () => {
    prisma.customer.findUnique.mockResolvedValue({ account: { tokenVersion: 4 } }); // bumped since token was issued
    const strategy = new CustomerJwtStrategy(prisma as unknown as PrismaService);

    await expect(
      strategy.validate({
        customerId: 'customer-1',
        pumpId: 'pump-1',
        phone: '9990000001',
        scope: 'customer',
        tokenVersion: 3, // stale — token was signed before the bump
        sub: 'customer-1',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a payload for a customer that no longer exists', async () => {
    prisma.customer.findUnique.mockResolvedValue(null);
    const strategy = new CustomerJwtStrategy(prisma as unknown as PrismaService);

    await expect(
      strategy.validate({
        customerId: 'deleted-customer',
        pumpId: 'pump-1',
        phone: '9990000001',
        scope: 'customer',
        tokenVersion: 0,
        sub: 'deleted-customer',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a payload for a customer with no linked account', async () => {
    prisma.customer.findUnique.mockResolvedValue({ account: null });
    const strategy = new CustomerJwtStrategy(prisma as unknown as PrismaService);

    await expect(
      strategy.validate({
        customerId: 'customer-1',
        pumpId: 'pump-1',
        phone: '9990000001',
        scope: 'customer',
        tokenVersion: 0,
        sub: 'customer-1',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a payload missing customerId without ever hitting the DB', async () => {
    const strategy = new CustomerJwtStrategy(prisma as unknown as PrismaService);
    await expect(
      strategy.validate({
        pumpId: 'pump-1',
        phone: '9990000001',
        scope: 'customer',
        tokenVersion: 0,
        sub: 'x',
      } as never),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.customer.findUnique).not.toHaveBeenCalled();
  });

  it('rejects a payload missing pumpId without ever hitting the DB', async () => {
    const strategy = new CustomerJwtStrategy(prisma as unknown as PrismaService);
    await expect(
      strategy.validate({
        customerId: 'customer-1',
        phone: '9990000001',
        scope: 'customer',
        tokenVersion: 0,
        sub: 'customer-1',
      } as never),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.customer.findUnique).not.toHaveBeenCalled();
  });

  it('rejects a payload missing phone without ever hitting the DB', async () => {
    const strategy = new CustomerJwtStrategy(prisma as unknown as PrismaService);
    await expect(
      strategy.validate({
        customerId: 'customer-1',
        pumpId: 'pump-1',
        scope: 'customer',
        tokenVersion: 0,
        sub: 'x',
      } as never),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.customer.findUnique).not.toHaveBeenCalled();
  });

  it('rejects a payload missing tokenVersion without ever hitting the DB', async () => {
    const strategy = new CustomerJwtStrategy(prisma as unknown as PrismaService);
    await expect(
      strategy.validate({
        customerId: 'customer-1',
        pumpId: 'pump-1',
        phone: '9990000001',
        scope: 'customer',
        sub: 'customer-1',
      } as never),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.customer.findUnique).not.toHaveBeenCalled();
  });

  // Belt-and-suspenders discriminator check — see the header comment in
  // types/customer-jwt-payload.interface.ts. In practice a staff-signed
  // payload would never even reach validate() (different secret => the
  // signature check fails first), but this confirms the extra guard works
  // in case a payload with the wrong scope ever did make it this far.
  it('rejects a payload whose scope is not "customer" (e.g. a staff-shaped payload) without hitting the DB', async () => {
    const strategy = new CustomerJwtStrategy(prisma as unknown as PrismaService);
    await expect(
      strategy.validate({
        customerId: 'customer-1',
        pumpId: 'pump-1',
        phone: '9990000001',
        scope: 'staff' as never,
        tokenVersion: 0,
        sub: 'customer-1',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.customer.findUnique).not.toHaveBeenCalled();
  });
});
