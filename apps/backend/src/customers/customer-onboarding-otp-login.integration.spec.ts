import type { AddressInfo } from 'net';
import type { Server } from 'http';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { Role } from '@prisma/client';
import { CustomersModule } from './customers.module';
import { CustomerAuthModule } from '../customer-auth/customer-auth.module';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { TenantContextInterceptor } from '../common/tenant-context.interceptor';

// Section 3.4/6.1 — the concrete cross-module regression this slice fixes:
// a customer created by a dealer through the web portal (POST /customers,
// phone typed in some human-friendly format) must be able to log into the
// Credit Customer App via phone+OTP (Section 5) using the SAME real number
// typed in a DIFFERENT format. This only passes if CustomersService.create()
// and CustomerAuthService.verifyOtp() converge on the exact same canonical
// phone string — see phone.util.ts's normalizeIndianMobile, imported by
// both customers.service.ts (this module) and the (untouched, read-only
// reference) customer-auth module.
//
// Minimal in-memory fake PrismaService — every existing spec in this
// codebase fakes/mocks PrismaService rather than hitting the real (Supabase)
// database; this follows the same convention. Supports exactly the calls
// the two flows under test make: customer.create/findUnique/findFirst,
// customerAccount.upsert (Phase 0.2, docs/multi-tenancy-plan.md — the
// find-or-create-by-phone account link), pump.findUniqueOrThrow +
// memberIdCounter.update (inside the same $transaction as customer.create,
// per member-id.ts), and the customerOtp CRUD CustomerAuthService needs.
class FakePrisma {
  private customers = new Map<string, Record<string, unknown>>();
  private customerAccounts = new Map<string, Record<string, unknown>>();
  private otps = new Map<string, Record<string, unknown>>();
  private counterSeq = 0;
  private nextCustomerSeq = 1;
  private nextAccountSeq = 1;
  private nextOtpSeq = 1;

  private hydrateAccount(row: Record<string, unknown>): Record<string, unknown> {
    const accountId = row.accountId as string | null | undefined;
    const account = accountId ? this.customerAccounts.get(accountId) ?? null : null;
    return { ...row, account };
  }

  customer = {
    create: ({ data }: { data: Record<string, unknown> }) => {
      const id = `cust-${this.nextCustomerSeq++}`;
      // Phase 2: the real tenant-scoping.extension.ts auto-stamps pumpId
      // from the request's tenant context when it's not explicitly set in
      // `data` (CustomersService.create() deliberately omits it, relying on
      // that injection) — this fake doesn't run the real extension, so it
      // mimics that one behavior directly rather than silently leaving
      // pumpId unset, which would make verifyOtp()'s !customer.pumpId
      // guard incorrectly treat every customer as unregistered.
      const row = { id, qrMemberId: null, pumpId: 'pump-1', ...data };
      this.customers.set(id, row);
      return Promise.resolve(row);
    },
    findUnique: ({
      where,
      select,
    }: {
      where: { id?: string; phone?: string };
      select?: Record<string, boolean>;
    }) => {
      let row: Record<string, unknown> | undefined;
      if (where.id !== undefined) {
        row = this.customers.get(where.id);
      } else if (where.phone !== undefined) {
        row = [...this.customers.values()].find(
          (c) => c.phone === where.phone,
        );
      }
      if (!row) return Promise.resolve(null);
      if (select) {
        const projected: Record<string, unknown> = {};
        for (const key of Object.keys(select)) {
          if (select[key]) projected[key] = row[key];
        }
        return Promise.resolve(projected);
      }
      return Promise.resolve(row);
    },
    // Phase 0.2: Customer.phone is no longer unique — CustomerAuthService
    // uses findFirst instead of findUnique for phone lookups.
    findFirst: ({
      where,
      select,
      include,
    }: {
      where: { phone?: string };
      select?: Record<string, boolean>;
      include?: { account?: boolean };
    }) => {
      const row = [...this.customers.values()].find((c) => c.phone === where.phone);
      if (!row) return Promise.resolve(null);
      const hydrated = include?.account ? this.hydrateAccount(row) : row;
      if (select) {
        const projected: Record<string, unknown> = {};
        for (const key of Object.keys(select)) {
          if (select[key]) projected[key] = hydrated[key];
        }
        return Promise.resolve(projected);
      }
      return Promise.resolve(hydrated);
    },
  };

  customerAccount = {
    // find-or-create by phone, matching the real Prisma upsert's semantics
    // for CustomersService.create()'s account-link step.
    upsert: ({
      where,
      create,
    }: {
      where: { phone: string };
      update: Record<string, unknown>;
      create: Record<string, unknown>;
    }) => {
      const existing = [...this.customerAccounts.values()].find(
        (a) => a.phone === where.phone,
      );
      if (existing) return Promise.resolve(existing);
      const id = `account-${this.nextAccountSeq++}`;
      const row = { id, tokenVersion: 0, ...create };
      this.customerAccounts.set(id, row);
      return Promise.resolve(row);
    },
  };

  pump = {
    findUniqueOrThrow: ({ where }: { where: { id: string } }) => {
      return Promise.resolve({ id: where.id, pumpCode: 'PUMP001' });
    },
  };

  memberIdCounter = {
    update: ({ data }: { data: { lastSeq: { increment: number } } }) => {
      this.counterSeq += data.lastSeq.increment;
      return Promise.resolve({ pumpId: 'default_pump', lastSeq: this.counterSeq });
    },
  };

  customerOtp = {
    create: ({ data }: { data: Record<string, unknown> }) => {
      const id = `otp-${this.nextOtpSeq++}`;
      const row = {
        id,
        attemptCount: 0,
        consumedAt: null,
        createdAt: new Date(),
        ...data,
      };
      this.otps.set(id, row);
      return Promise.resolve(row);
    },
    count: ({
      where,
    }: {
      where: { phone: string; createdAt: { gt: Date } };
    }) => {
      const count = [...this.otps.values()].filter(
        (o) =>
          o.phone === where.phone &&
          (o.createdAt as Date) > where.createdAt.gt,
      ).length;
      return Promise.resolve(count);
    },
    findFirst: ({
      where,
    }: {
      where: { phone: string; consumedAt: null; expiresAt: { gt: Date } };
    }) => {
      const candidates = [...this.otps.values()]
        .filter(
          (o) =>
            o.phone === where.phone &&
            o.consumedAt === null &&
            (o.expiresAt as Date) > where.expiresAt.gt,
        )
        .sort(
          (a, b) =>
            (b.createdAt as Date).getTime() - (a.createdAt as Date).getTime(),
        );
      return Promise.resolve(candidates[0] ?? null);
    },
    findUnique: ({ where }: { where: { id: string } }) => {
      return Promise.resolve(this.otps.get(where.id) ?? null);
    },
    update: ({
      where,
      data,
    }: {
      where: { id: string };
      data: Record<string, unknown>;
    }) => {
      const row = this.otps.get(where.id);
      if (!row) return Promise.resolve(null);
      Object.assign(row, data);
      return Promise.resolve(row);
    },
  };

  $transaction = <T>(callback: (tx: this) => Promise<T> | T) => {
    return Promise.resolve(callback(this));
  };
}

describe('Web-portal-created customer can OTP-login with a differently-formatted phone (integration)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let staffJwtService: JwtService;

  beforeAll(async () => {
    process.env.JWT_SECRET =
      process.env.JWT_SECRET ?? 'test-secret-for-customer-onboarding-spec-staff';
    process.env.CUSTOMER_JWT_SECRET =
      process.env.CUSTOMER_JWT_SECRET ?? 'test-secret-for-customer-onboarding-spec-customer';
    // Dev-only convenience so requestOtp's response echoes the plaintext
    // code back (see CustomerAuthService.requestOtp) — this test has no real
    // SMS provider to intercept, matching ConsoleOtpProvider's own guard.
    process.env.NODE_ENV = 'development';

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [CustomersModule, CustomerAuthModule, AuthModule, PrismaModule],
      providers: [
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: APP_GUARD, useClass: RolesGuard },
        { provide: APP_INTERCEPTOR, useClass: TenantContextInterceptor },
      ],
    })
      .overrideProvider(PrismaService)
      .useValue(new FakePrisma())
      .compile();

    app = moduleRef.createNestApplication();
    // Mirrors main.ts's global ValidationPipe config — @Transform-based
    // phone normalization in the OTP DTOs only runs when `transform: true`.
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
  });

  afterAll(async () => {
    await app.close();
  });

  it('logs in via OTP using a differently-formatted phone than the one used at customer creation', async () => {
    const staffToken = await staffJwtService.signAsync({
      staffId: 'staff-1',
      pumpId: 'pump-1',
      role: Role.OWNER,
      sub: 'staff-1',
    });

    // 1. Dealer creates the customer via the web portal with a formatted
    //    number, as OWNER.
    const createRes = await fetch(`${baseUrl}/customers`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${staffToken}`,
      },
      body: JSON.stringify({
        name: 'Ramesh Kumar',
        phone: '+91 98765 43210',
        creditLimit: 5000,
      }),
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as { id: string; phone: string };
    // The regression this slice fixes: the stored phone must already be the
    // bare 10-digit canonical form, not "+91 98765 43210" verbatim.
    expect(created.phone).toBe('9876543210');

    // 2. Same real customer requests an OTP via the Credit Customer App,
    //    typing the SAME number in a DIFFERENT format (bare, unformatted).
    const requestRes = await fetch(`${baseUrl}/auth/customer/otp/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '9876543210' }),
    });
    expect(requestRes.status).toBe(200);
    const requested = (await requestRes.json()) as {
      requestId: string;
      otp: string;
    };
    expect(requested.otp).toBeDefined();

    // 3. Verify with the captured code — succeeds only if create() and
    //    verifyOtp() converged on the same canonical phone string.
    const verifyRes = await fetch(`${baseUrl}/auth/customer/otp/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requestId: requested.requestId,
        otp: requested.otp,
        phone: '9876543210',
      }),
    });
    expect(verifyRes.status).toBe(200);
    const verified = (await verifyRes.json()) as {
      accessToken: string;
      customer: { id: string; phone: string };
    };
    expect(verified.accessToken).toBeDefined();
    expect(verified.customer.id).toBe(created.id);
    expect(verified.customer.phone).toBe('9876543210');
  });
});
