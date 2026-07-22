import type { AddressInfo } from 'net';
import type { Server } from 'http';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { Role, RedemptionType } from '@prisma/client';
import { AuthModule } from '../auth/auth.module';
import { CustomerAuthModule } from '../customer-auth/customer-auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CustomerPortalController } from './customer-portal.controller';
import { CustomerPortalService } from './customer-portal.service';
import { CustomersService } from '../customers/customers.service';
import { LoyaltyService } from '../loyalty/loyalty.service';
import { GiftCatalogService } from '../gift-catalog/gift-catalog.service';
import { RedemptionsService } from '../redemptions/redemptions.service';

// Section 5/6 — guard-wiring + "never trust the caller's customerId"
// coverage for the new customer-portal routes, mirroring
// customer-auth-guards.integration.spec.ts (customer-vs-staff-token
// rejection) and rbac-real-controllers.integration.spec.ts (real
// controller + real global guards, business services stubbed).
//
// The real global ValidationPipe config from main.ts is applied here
// (whitelist + forbidNonWhitelisted) specifically so the "smuggled
// customerId" test below exercises the actual runtime behavior a real
// request would hit, not just a unit-level assumption about it.
describe('CustomerPortalController — guard enforcement + cross-customer protection (integration)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let staffJwtService: JwtService;
  let customerJwtService: JwtService;

  const activeCustomerId = 'cust-active';
  const otherCustomerId = 'cust-other';

  let customersServiceMock: { ledger: jest.Mock };
  let loyaltyServiceMock: { getBalance: jest.Mock; getConfig: jest.Mock };
  let giftCatalogServiceMock: { findAll: jest.Mock };
  let redemptionsServiceMock: { create: jest.Mock };

  beforeAll(async () => {
    process.env.JWT_SECRET =
      process.env.JWT_SECRET ?? 'test-secret-for-customer-portal-spec-staff';
    process.env.CUSTOMER_JWT_SECRET =
      process.env.CUSTOMER_JWT_SECRET ?? 'test-secret-for-customer-portal-spec-customer';

    customersServiceMock = {
      ledger: jest.fn().mockResolvedValue({
        customer: {
          id: activeCustomerId,
          name: 'Asha Transport',
          phone: '9990000001',
          vehicleNumber: 'KA01AB1234',
          qrMemberId: 'PUMP001-CUST-00001-8',
          verificationStatus: 'VERIFIED',
        },
        entries: [],
        outstandingBalance: 250,
        creditLimit: 5000,
      }),
    };
    loyaltyServiceMock = {
      getBalance: jest.fn().mockResolvedValue(120),
      getConfig: jest.fn().mockResolvedValue(null),
    };
    giftCatalogServiceMock = { findAll: jest.fn().mockResolvedValue([]) };
    redemptionsServiceMock = {
      create: jest.fn().mockResolvedValue({ id: 'redemption-1' }),
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AuthModule, CustomerAuthModule, PrismaModule],
      controllers: [CustomerPortalController],
      providers: [
        CustomerPortalService,
        { provide: CustomersService, useValue: customersServiceMock },
        { provide: LoyaltyService, useValue: loyaltyServiceMock },
        { provide: GiftCatalogService, useValue: giftCatalogServiceMock },
        { provide: RedemptionsService, useValue: redemptionsServiceMock },
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: APP_GUARD, useClass: RolesGuard },
      ],
    })
      .overrideProvider(PrismaService)
      .useValue({
        // CustomerJwtStrategy.validate() re-checks tokenVersion against this
        // on every request — stub a tiny in-memory table. Phase 0.2
        // (docs/multi-tenancy-plan.md): tokenVersion moved onto the joined
        // account, so the stub returns { account: { tokenVersion } }.
        customer: {
          findUnique: (args: { where: { id: string } }) => {
            const table: Record<string, { tokenVersion: number } | undefined> = {
              [activeCustomerId]: { tokenVersion: 0 },
              [otherCustomerId]: { tokenVersion: 0 },
            };
            const account = table[args.where.id];
            return Promise.resolve(account ? { account } : null);
          },
        },
        // CustomerPortalService.getBills() queries this directly (not via
        // CustomersService), so it needs its own stub here too.
        bill: { findMany: jest.fn().mockResolvedValue([]) },
      })
      .compile();

    app = moduleRef.createNestApplication();
    // Mirrors main.ts exactly — this is what makes the "smuggled customerId"
    // test below meaningful (real whitelist/forbidNonWhitelisted behavior).
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
    await app.listen(0);
    const httpServer = app.getHttpServer() as Server;
    const address = httpServer.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;

    staffJwtService = new JwtService({
      secret: process.env.JWT_SECRET,
      signOptions: { expiresIn: '12h' },
    });
    customerJwtService = new JwtService({
      secret: process.env.CUSTOMER_JWT_SECRET,
      signOptions: { expiresIn: '30d' },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  async function customerToken(customerId: string): Promise<string> {
    return customerJwtService.signAsync({
      customerId,
      pumpId: 'pump-1',
      phone: '9990000001',
      scope: 'customer',
      tokenVersion: 0,
      sub: customerId,
    });
  }

  async function staffToken(): Promise<string> {
    return staffJwtService.signAsync({
      staffId: 'staff-1',
      pumpId: 'pump-1',
      role: Role.OWNER,
      sub: 'staff-1',
    });
  }

  const routes: Array<[string, string, string]> = [
    ['GET', '/customer-portal/me', 'me'],
    ['GET', '/customer-portal/bills', 'bills'],
    ['GET', '/customer-portal/gift-catalog', 'gift-catalog'],
  ];

  describe.each(routes)('%s %s', (method, path) => {
    it('rejects a request with no token (401)', async () => {
      const res = await fetch(`${baseUrl}${path}`, { method });
      expect(res.status).toBe(401);
    });

    it('rejects a staff JWT — wrong scope/secret (401)', async () => {
      const token = await staffToken();
      const res = await fetch(`${baseUrl}${path}`, {
        method,
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(401);
    });

    it('allows a valid customer JWT (200)', async () => {
      const token = await customerToken(activeCustomerId);
      const res = await fetch(`${baseUrl}${path}`, {
        method,
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(200);
    });
  });

  describe('POST /customer-portal/redemptions', () => {
    it('rejects a request with no token (401)', async () => {
      const res = await fetch(`${baseUrl}/customer-portal/redemptions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pointsToRedeem: 10 }),
      });
      expect(res.status).toBe(401);
    });

    it('rejects a staff JWT — wrong scope/secret (401)', async () => {
      const token = await staffToken();
      const res = await fetch(`${baseUrl}/customer-portal/redemptions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ pointsToRedeem: 10 }),
      });
      expect(res.status).toBe(401);
    });

    it('processes a redemption for the authenticated customer using their own id', async () => {
      redemptionsServiceMock.create.mockResolvedValueOnce({ id: 'redemption-ok' });
      const token = await customerToken(activeCustomerId);
      const res = await fetch(`${baseUrl}/customer-portal/redemptions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          redemptionType: RedemptionType.CASH,
          pointsToRedeem: 10,
        }),
      });
      expect(res.status).toBe(201);
      expect(redemptionsServiceMock.create).toHaveBeenCalledWith(
        expect.objectContaining({ customerId: activeCustomerId }),
      );
    });

    // This is the test that matters most: a customer authenticated as
    // `activeCustomerId` must never be able to make a redemption act on
    // `otherCustomerId`, even by smuggling a customerId field into the body.
    // CreateCustomerRedemptionDto has no customerId field at all, and the
    // global ValidationPipe is configured with forbidNonWhitelisted: true
    // (same as main.ts), so the extra field is rejected outright rather than
    // silently dropped or honored.
    it('rejects (400) a smuggled customerId in the body instead of silently honoring or dropping it', async () => {
      const token = await customerToken(activeCustomerId);
      const res = await fetch(`${baseUrl}/customer-portal/redemptions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          customerId: otherCustomerId,
          redemptionType: RedemptionType.CASH,
          pointsToRedeem: 10,
        }),
      });
      expect(res.status).toBe(400);
      // The redemption must never have been attempted against the smuggled
      // customer id.
      expect(redemptionsServiceMock.create).not.toHaveBeenCalledWith(
        expect.objectContaining({ customerId: otherCustomerId }),
      );
    });
  });
});
