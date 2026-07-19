import type { AddressInfo } from 'net';
import type { Server } from 'http';
import { INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { Role } from '@prisma/client';
import { AuthModule } from './auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';

import { BillsModule } from '../bills/bills.module';
import { BillsService } from '../bills/bills.service';
import { CustomersModule } from '../customers/customers.module';
import { CustomersService } from '../customers/customers.service';
import { DashboardModule } from '../dashboard/dashboard.module';
import { DashboardService } from '../dashboard/dashboard.service';
import { CreditAlertsModule } from '../credit-alerts/credit-alerts.module';
import { CreditAlertsService } from '../credit-alerts/credit-alerts.service';
import { TallyExportModule } from '../tally-export/tally-export.module';
import { TallyExportService } from '../tally-export/tally-export.service';
import { MeterReadingsModule } from '../meter-readings/meter-readings.module';
import { MeterReadingsService } from '../meter-readings/meter-readings.service';
import { CreditConfigModule } from '../credit-config/credit-config.module';
import { CreditConfigService } from '../credit-config/credit-config.service';

// Closes the "real controllers, not just the synthetic test controller"
// coverage gap called out in the RBAC decorator task: confirms the
// @Roles(Role.OWNER, Role.ACCOUNTANT) decorator added to each of the 7
// controllers actually lets an Accountant through on a real route, and that
// an unauthenticated request is still rejected by the global JwtAuthGuard
// before RolesGuard is ever reached. Guard *mechanism* itself (403 for wrong
// role, @Public() bypass, etc.) is already covered by
// auth-guards.integration.spec.ts and roles.guard.spec.ts — not re-tested
// here.
//
// Every business service is overridden with a trivial stub so this stays a
// guard-wiring test, not a re-test of each service's real logic (which has
// its own unit coverage elsewhere) and so no real DB connection is needed.
describe('@Roles(Role.OWNER, Role.ACCOUNTANT) on real controllers — integration', () => {
  let app: INestApplication;
  let jwtService: JwtService;
  let baseUrl: string;

  beforeAll(async () => {
    process.env.JWT_SECRET =
      process.env.JWT_SECRET ?? 'test-secret-for-rbac-real-controllers-spec';

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [
        AuthModule,
        PrismaModule,
        BillsModule,
        CustomersModule,
        DashboardModule,
        CreditAlertsModule,
        TallyExportModule,
        MeterReadingsModule,
        CreditConfigModule,
      ],
      providers: [
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: APP_GUARD, useClass: RolesGuard },
      ],
    })
      .overrideProvider(PrismaService)
      .useValue({})
      .overrideProvider(BillsService)
      .useValue({ findAll: () => [], create: () => ({}), remove: () => ({}) })
      .overrideProvider(CustomersService)
      .useValue({ findAll: () => [], findByMemberId: () => ({}) })
      .overrideProvider(DashboardService)
      .useValue({ getSalesSummary: () => ({ totalSales: 0 }) })
      .overrideProvider(CreditAlertsService)
      .useValue({ findAll: () => [] })
      .overrideProvider(TallyExportService)
      .useValue({
        generateXml: () => ({ xml: '<ENVELOPE/>', filename: 'test.xml' }),
      })
      .overrideProvider(MeterReadingsService)
      .useValue({
        findAll: () => [],
        openShift: () => ({}),
        closeShift: () => ({}),
      })
      .overrideProvider(CreditConfigService)
      .useValue({ getOrCreate: () => ({}), update: () => ({}) })
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
    await app.listen(0);
    const httpServer = app.getHttpServer() as Server;
    const address = httpServer.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
    jwtService = moduleRef.get(JwtService);
  });

  afterAll(async () => {
    await app.close();
  });

  async function accountantToken(): Promise<string> {
    return jwtService.signAsync({
      staffId: 'staff-accountant',
      role: Role.ACCOUNTANT,
      sub: 'staff-accountant',
    });
  }

  async function dsmToken(): Promise<string> {
    return jwtService.signAsync({
      staffId: 'staff-dsm',
      role: Role.DSM,
      sub: 'staff-dsm',
    });
  }

  async function ownerToken(): Promise<string> {
    return jwtService.signAsync({
      staffId: 'staff-owner',
      role: Role.OWNER,
      sub: 'staff-owner',
    });
  }

  it.each([
    ['GET /bills', '/bills'],
    ['GET /customers', '/customers'],
    ['GET /dashboard/sales-summary', '/dashboard/sales-summary'],
    ['GET /credit-alerts', '/credit-alerts'],
    ['GET /tally-export/xml', '/tally-export/xml?from=2026-07-01&to=2026-07-17'],
    ['GET /meter-readings', '/meter-readings'],
  ])('allows an Accountant token through %s', async (_label, path) => {
    const token = await accountantToken();
    const res = await fetch(`${baseUrl}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBeGreaterThanOrEqual(200);
    expect(res.status).toBeLessThan(300);
  });

  it('rejects GET /bills with no Authorization header (401)', async () => {
    const res = await fetch(`${baseUrl}/bills`);
    expect(res.status).toBe(401);
  });

  it('rejects GET /customers with no Authorization header (401)', async () => {
    const res = await fetch(`${baseUrl}/customers`);
    expect(res.status).toBe(401);
  });

  it('rejects GET /customers/by-member-id/:qrMemberId with no Authorization header (401)', async () => {
    const res = await fetch(
      `${baseUrl}/customers/by-member-id/PUMP001-CUST-00001-8`,
    );
    expect(res.status).toBe(401);
  });

  // Section 2/4 — DSM/Cashier must reach the DSM app's core workflow
  // (create a bill, look up a customer for the credit picker, resolve a
  // scanned QR member ID for New Bill auto-fill (Section 6.3), open/close
  // their own shift) even though these controllers are class-level
  // Owner/Accountant-only. Each of these routes carries a method-level
  // @Roles(..., Role.DSM) override.
  it.each([
    ['POST /bills', 'POST', '/bills', {}],
    ['GET /customers', 'GET', '/customers', undefined],
    [
      'GET /customers/by-member-id/:qrMemberId',
      'GET',
      '/customers/by-member-id/PUMP001-CUST-00001-8',
      undefined,
    ],
    ['POST /meter-readings', 'POST', '/meter-readings', {}],
    ['PATCH /meter-readings/:id/close', 'PATCH', '/meter-readings/some-id/close', {}],
  ])('allows a DSM token through %s', async (_label, method, path, body) => {
    const token = await dsmToken();
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    expect(res.status).toBeGreaterThanOrEqual(200);
    expect(res.status).toBeLessThan(300);
  });

  it('rejects a DSM token on PATCH /bills/:id (403)', async () => {
    const token = await dsmToken();
    const res = await fetch(`${baseUrl}/bills/some-id`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(403);
  });

  // Section 3.2 deviation — bill deletion is Owner-only (narrower than the
  // edit/delete parity the section text otherwise describes), because
  // undoing billing history is treated as more consequential than edit
  // access. DELETE /bills/:id carries a method-level
  // @Roles(Role.OWNER) override on remove(), unlike PATCH which stays on the
  // class-level Owner/Accountant decorator.
  it('allows an Owner token through DELETE /bills/:id', async () => {
    const token = await ownerToken();
    const res = await fetch(`${baseUrl}/bills/some-id`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ deletedById: 'staff-owner' }),
    });
    expect(res.status).toBeGreaterThanOrEqual(200);
    expect(res.status).toBeLessThan(300);
  });

  it('rejects an Accountant token on DELETE /bills/:id (403)', async () => {
    const token = await accountantToken();
    const res = await fetch(`${baseUrl}/bills/some-id`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ deletedById: 'staff-accountant' }),
    });
    expect(res.status).toBe(403);
  });

  // Section 3.4A deviation — credit enforcement policy (enforcementMode,
  // defaultInformalCreditLimit) is business-settings policy, narrowed to
  // Owner-only, unlike the rest of this controller's class-level
  // Owner/Accountant decorator elsewhere in this file. CreditConfigController
  // now carries a class-level @Roles(Role.OWNER) override.
  it('rejects an Accountant token on GET /credit-config (403)', async () => {
    const token = await accountantToken();
    const res = await fetch(`${baseUrl}/credit-config`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(403);
  });

  it('rejects an Accountant token on PATCH /credit-config (403)', async () => {
    const token = await accountantToken();
    const res = await fetch(`${baseUrl}/credit-config`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(403);
  });
});
