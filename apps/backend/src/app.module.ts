import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { resolve } from 'path';
import { PrismaModule } from './prisma/prisma.module';
import { HealthController } from './health/health.controller';
import { CustomersModule } from './customers/customers.module';
import { BillsModule } from './bills/bills.module';
import { CreditConfigModule } from './credit-config/credit-config.module';
import { CreditAlertsModule } from './credit-alerts/credit-alerts.module';
import { NozzlesModule } from './nozzles/nozzles.module';
import { MeterReadingsModule } from './meter-readings/meter-readings.module';
import { LoyaltyModule } from './loyalty/loyalty.module';
import { GiftCatalogModule } from './gift-catalog/gift-catalog.module';
import { RedemptionsModule } from './redemptions/redemptions.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { TallyExportModule } from './tally-export/tally-export.module';
import { TanksModule } from './tanks/tanks.module';
import { PurchasesModule } from './purchases/purchases.module';
import { RateMasterModule } from './rate-master/rate-master.module';
import { DensityLogsModule } from './density-logs/density-logs.module';
import { CashCustodyModule } from './cash-custody/cash-custody.module';
import { ShiftSalesModule } from './shift-sales/shift-sales.module';
import { UpiWebhookModule } from './upi-webhook/upi-webhook.module';
import { CreditAgingModule } from './credit-aging/credit-aging.module';
import { SalesPurchaseRegisterModule } from './sales-purchase-register/sales-purchase-register.module';
import { AttendanceModule } from './attendance/attendance.module';
import { StaffModule } from './staff/staff.module';
import { StaffManagementModule } from './staff-management/staff-management.module';
import { BusinessProfileModule } from './business-profile/business-profile.module';
import { AuthModule } from './auth/auth.module';
import { CustomerAuthModule } from './customer-auth/customer-auth.module';
import { CustomerPortalModule } from './customer-portal/customer-portal.module';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { RolesGuard } from './auth/guards/roles.guard';
import { TenantContextInterceptor } from './common/tenant-context.interceptor';

// .env lives at the repo root (npm workspace), not inside apps/backend.
//
// A relative envFilePath (e.g. '../../.env') is resolved by dotenv against
// process.cwd(), which is fragile: it happens to work when launched via
// `npm run start:dev -w backend` from the repo root (npm sets cwd to the
// workspace dir, apps/backend, so '../../.env' lands on the repo root), but
// it silently breaks for any other launch method (e.g. `node dist/main.js`
// run with a different cwd, a process manager, etc).
//
// Anchor on __dirname instead, which always points at the compiled module's
// own directory regardless of cwd. Nest's build output (nest-cli.json
// sourceRoot: "src") compiles this file to apps/backend/dist/app.module.js,
// so __dirname === apps/backend/dist both in `nest start --watch` (tsc
// watch + run dist/main.js) and in the production build. Three levels up
// from apps/backend/dist reaches the repo root.
const ROOT_ENV_PATH = resolve(__dirname, '../../../.env');

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ROOT_ENV_PATH,
    }),
    PrismaModule,
    AuthModule,
    CustomerAuthModule,
    CustomerPortalModule,
    CustomersModule,
    BillsModule,
    CreditConfigModule,
    CreditAlertsModule,
    NozzlesModule,
    MeterReadingsModule,
    LoyaltyModule,
    GiftCatalogModule,
    RedemptionsModule,
    DashboardModule,
    TallyExportModule,
    TanksModule,
    PurchasesModule,
    RateMasterModule,
    DensityLogsModule,
    CashCustodyModule,
    ShiftSalesModule,
    UpiWebhookModule,
    CreditAgingModule,
    SalesPurchaseRegisterModule,
    AttendanceModule,
    StaffModule,
    StaffManagementModule,
    BusinessProfileModule,
  ],
  controllers: [HealthController],
  providers: [
    // Section 2 — every endpoint requires a valid JWT by default (JwtAuthGuard),
    // then a role check (RolesGuard) for any route carrying @Roles(...).
    // Order matters: Nest runs APP_GUARD providers in registration order, so
    // JwtAuthGuard populates req.user before RolesGuard reads it.
    // Use @Public() (see auth/decorators/public.decorator.ts) to opt a route
    // out of authentication entirely — currently just /auth/login and /health.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    // Phase 2 (docs/multi-tenancy-plan.md) — runs after the guards above
    // (Nest always runs Guards before Interceptors, regardless of provider
    // registration order), populating the AsyncLocalStorage tenant context
    // that tenant-scoping.middleware.ts reads to auto-scope every
    // tenant-owned model's queries by pumpId.
    { provide: APP_INTERCEPTOR, useClass: TenantContextInterceptor },
  ],
})
export class AppModule {}
