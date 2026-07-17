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
      .useValue({ findAll: () => [] })
      .overrideProvider(CustomersService)
      .useValue({ findAll: () => [] })
      .overrideProvider(DashboardService)
      .useValue({ getSalesSummary: () => ({ totalSales: 0 }) })
      .overrideProvider(CreditAlertsService)
      .useValue({ findAll: () => [] })
      .overrideProvider(TallyExportService)
      .useValue({
        generateXml: () => ({ xml: '<ENVELOPE/>', filename: 'test.xml' }),
      })
      .overrideProvider(MeterReadingsService)
      .useValue({ findAll: () => [] })
      .overrideProvider(CreditConfigService)
      .useValue({ getOrCreate: () => ({}) })
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
    await app.listen(0);
    const address = app.getHttpServer().address();
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

  it.each([
    ['GET /bills', '/bills'],
    ['GET /customers', '/customers'],
    ['GET /dashboard/sales-summary', '/dashboard/sales-summary'],
    ['GET /credit-alerts', '/credit-alerts'],
    ['GET /tally-export/xml', '/tally-export/xml?from=2026-07-01&to=2026-07-17'],
    ['GET /meter-readings', '/meter-readings'],
    ['GET /credit-config', '/credit-config'],
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
});
