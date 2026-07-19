import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { resolve } from 'path';
import { PrismaModule } from './prisma/prisma.module';
import { HealthController } from './health/health.controller';
import { CustomersModule } from './customers/customers.module';
import { BillsModule } from './bills/bills.module';
import { CreditConfigModule } from './credit-config/credit-config.module';
import { CreditAlertsModule } from './credit-alerts/credit-alerts.module';
import { MeterReadingsModule } from './meter-readings/meter-readings.module';
import { LoyaltyModule } from './loyalty/loyalty.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { TallyExportModule } from './tally-export/tally-export.module';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { RolesGuard } from './auth/guards/roles.guard';

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
    CustomersModule,
    BillsModule,
    CreditConfigModule,
    CreditAlertsModule,
    MeterReadingsModule,
    LoyaltyModule,
    DashboardModule,
    TallyExportModule,
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
  ],
})
export class AppModule {}
