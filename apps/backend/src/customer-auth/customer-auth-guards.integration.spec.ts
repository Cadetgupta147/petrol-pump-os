import type { AddressInfo } from 'net';
import type { Server } from 'http';
import { Controller, Get, INestApplication, UseGuards } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { Role } from '@prisma/client';
import { AuthModule } from '../auth/auth.module';
import { CustomerAuthModule } from './customer-auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { Public } from '../auth/decorators/public.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CustomerJwtAuthGuard } from './guards/customer-jwt-auth.guard';

// This is the hard security requirement called out for this slice: a
// customer token must never work against a staff-only endpoint, and a staff
// token must never work against a customer-only endpoint — even though both
// are just JWTs extracted the same way (Bearer header). The two temp
// controllers below stand in for "a real staff-only route" (every existing
// controller, guarded globally by JwtAuthGuard) and "a real future
// customer-only route" (none exist yet — Section 5/6 bill history, points
// balance, etc. will follow this exact pattern once built).
@Controller('test-customer-only')
class TestCustomerOnlyController {
  // @Public() opts this route OUT of the global staff JwtAuthGuard (which
  // would otherwise 401 a customer token before CustomerJwtAuthGuard even
  // runs — see CustomerJwtAuthGuard's header comment for why both
  // decorators are required together on every real customer-only route).
  @Public()
  @UseGuards(CustomerJwtAuthGuard)
  @Get('protected')
  protectedRoute() {
    return { ok: true };
  }
}

@Controller('test-staff-only')
class TestStaffOnlyController {
  // No @Public() — covered by the global JwtAuthGuard/RolesGuard exactly
  // like every real staff controller in the app.
  @Get('protected')
  protectedRoute() {
    return { ok: true };
  }
}

describe('Customer JWT vs Staff JWT — cross-guard rejection (integration)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let staffJwtService: JwtService;
  let customerJwtService: JwtService;

  beforeAll(async () => {
    process.env.JWT_SECRET =
      process.env.JWT_SECRET ?? 'test-secret-for-customer-auth-guards-spec-staff';
    process.env.CUSTOMER_JWT_SECRET =
      process.env.CUSTOMER_JWT_SECRET ?? 'test-secret-for-customer-auth-guards-spec-customer';

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AuthModule, CustomerAuthModule, PrismaModule],
      controllers: [TestCustomerOnlyController, TestStaffOnlyController],
      providers: [
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: APP_GUARD, useClass: RolesGuard },
      ],
    })
      .overrideProvider(PrismaService)
      .useValue({
        // CustomerJwtStrategy.validate() now hits the DB on every request to
        // enforce the tokenVersion "kill switch" (see
        // prisma/schema.prisma's Customer.tokenVersion comment) — stub a
        // small in-memory table keyed by customerId so both the "matches"
        // and "stale tokenVersion" cases below are exercisable.
        customer: {
          findUnique: (args: { where: { id: string } }) => {
            const table: Record<string, { tokenVersion: number } | undefined> = {
              c1: { tokenVersion: 0 },
              'c-bumped': { tokenVersion: 5 }, // simulates a bump AFTER the token below was issued
            };
            return Promise.resolve(table[args.where.id] ?? null);
          },
        },
      })
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
    await app.listen(0);
    const httpServer = app.getHttpServer() as Server;
    const address = httpServer.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;

    // AuthModule and CustomerAuthModule each register their OWN JwtModule
    // instance with a DIFFERENT secret (that's the whole point) — select()
    // each module explicitly rather than a bare moduleRef.get(JwtService),
    // which would be ambiguous between the two.
    // AuthModule and CustomerAuthModule each register their OWN JwtModule
    // instance internally, so pulling a JwtService out of the compiled test
    // module via moduleRef.get()/select() is ambiguous (two distinct
    // instances share the same DI token in different module scopes). A
    // JwtService is a plain class that can be constructed directly with the
    // options it would otherwise receive via JwtModule.register() — this
    // sidesteps the ambiguity while still producing tokens signed exactly
    // the way each real module signs them (same secret, same signOptions).
    staffJwtService = new JwtService({ secret: process.env.JWT_SECRET, signOptions: { expiresIn: '12h' } });
    customerJwtService = new JwtService({
      secret: process.env.CUSTOMER_JWT_SECRET,
      signOptions: { expiresIn: '30d' },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects a staff token on a customer-only route (401)', async () => {
    const token = await staffJwtService.signAsync({ staffId: 's1', role: Role.OWNER, sub: 's1' });
    const res = await fetch(`${baseUrl}/test-customer-only/protected`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(401);
  });

  it('allows a customer token on a customer-only route', async () => {
    const token = await customerJwtService.signAsync({
      customerId: 'c1',
      phone: '9990000001',
      scope: 'customer',
      tokenVersion: 0,
      sub: 'c1',
    });
    const res = await fetch(`${baseUrl}/test-customer-only/protected`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
  });

  it('rejects a customer token on a staff-only route (401)', async () => {
    const token = await customerJwtService.signAsync({
      customerId: 'c1',
      phone: '9990000001',
      scope: 'customer',
      tokenVersion: 0,
      sub: 'c1',
    });
    const res = await fetch(`${baseUrl}/test-staff-only/protected`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(401);
  });

  it('allows a staff token on a staff-only route (regression sanity check)', async () => {
    const token = await staffJwtService.signAsync({ staffId: 's1', role: Role.OWNER, sub: 's1' });
    const res = await fetch(`${baseUrl}/test-staff-only/protected`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
  });

  it('rejects a request with no token on the customer-only route (401)', async () => {
    const res = await fetch(`${baseUrl}/test-customer-only/protected`);
    expect(res.status).toBe(401);
  });

  // The tokenVersion "kill switch" itself (see prisma/schema.prisma's
  // Customer.tokenVersion comment): a token that is otherwise perfectly
  // valid (right secret, right shape, not expired) must still be rejected
  // once the DB's tokenVersion no longer matches the claim it was issued
  // with — e.g. a lost/stolen phone scenario where every existing session
  // needs to die immediately, without waiting for natural expiry.
  it('rejects a customer token whose tokenVersion claim is stale vs. the current DB value (401)', async () => {
    const token = await customerJwtService.signAsync({
      customerId: 'c-bumped',
      phone: '9990000002',
      scope: 'customer',
      tokenVersion: 3, // stale — the stubbed DB above has this customer at tokenVersion 5
      sub: 'c-bumped',
    });
    const res = await fetch(`${baseUrl}/test-customer-only/protected`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(401);
  });

  it('allows a customer token whose tokenVersion claim still matches the current DB value', async () => {
    const token = await customerJwtService.signAsync({
      customerId: 'c-bumped',
      phone: '9990000002',
      scope: 'customer',
      tokenVersion: 5, // matches the stubbed DB value
      sub: 'c-bumped',
    });
    const res = await fetch(`${baseUrl}/test-customer-only/protected`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
  });
});
