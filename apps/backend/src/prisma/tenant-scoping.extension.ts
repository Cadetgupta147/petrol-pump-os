import { Prisma } from '@prisma/client';
import { getTenantContext, TenantContext } from '../common/tenant-context';

// Phase 2 (docs/multi-tenancy-plan.md) — every model that actually belongs
// to one pump. Deliberately EXCLUDES Pump itself and the two identity
// tables (StaffAccount, CustomerAccount): those are the tenant root and
// login identities respectively, not tenant-OWNED data — a login lookup
// (`StaffAccount.findUnique({ where: { phone } })`) must legitimately search
// across every pump before a tenant is even known, so scoping those three
// would break login outright.
export const TENANT_SCOPED_MODELS = new Set<string>([
  'Staff',
  'Customer',
  'Bill',
  'BillAuditLog',
  'BillPaymentLine',
  'CreditConfig',
  'BusinessProfile',
  'CreditLimitAlert',
  'MeterReading',
  'Tank',
  'DipReading',
  'DensityLog',
  'ShiftSalesSummary',
  'UpiWebhookEvent',
  'PurchaseEntry',
  'LubricantItem',
  'RateHistory',
  'LoyaltyConfig',
  'LoyaltyTransaction',
  'GiftCatalogItem',
  'RedemptionTransaction',
  'CashCustodyLog',
  'Payment',
  'TallyExportLog',
  'CustomerOtp',
  'MemberIdCounter',
]);

// Every one of these operations takes a `where` — including the singular
// findUnique/findUniqueOrThrow/update/delete, which Prisma restricts to
// unique-field lookups EXCEPT it also supports "extended where unique
// input": additional non-unique fields alongside the required unique one,
// combined with AND (stable since Prisma 4.5+, well within this project's
// 6.19.3). That's exactly what merging pumpId in here relies on — no
// operation needs redirecting to a different method (which the extension
// API's `query()` continuation can't do anyway: it always re-invokes the
// SAME operation it intercepted, just with whatever args you pass it).
// Verified empirically against the real dev DB, not just assumed — see
// docs/multi-tenancy-plan.md's Phase 2 progress log.
const WHERE_OPERATIONS = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'update',
  'updateMany',
  'delete',
  'deleteMany',
  'count',
  'aggregate',
  'groupBy',
]);

type PrismaArgs = {
  where?: Record<string, unknown>;
  data?: Record<string, unknown> | Record<string, unknown>[];
  create?: Record<string, unknown>;
};

// Pure transformation — given an operation/args/context, returns the
// pumpId-scoped args. Deliberately factored out of the Prisma Client
// Extension wrapper below so it's directly unit-testable without going
// through Prisma's extension machinery (Prisma.defineExtension's return
// value is an opaque object, not something a test can meaningfully reach
// into and invoke directly).
export function scopeArgs(operation: string, args: unknown, ctx: TenantContext): unknown {
  const a = (args ?? {}) as PrismaArgs;

  if (WHERE_OPERATIONS.has(operation)) {
    return { ...a, where: { ...a.where, pumpId: ctx.pumpId } };
  }

  if (operation === 'upsert') {
    return {
      ...a,
      where: { ...a.where, pumpId: ctx.pumpId },
      create: {
        ...a.create,
        pumpId: (a.create?.pumpId as string | undefined) ?? ctx.pumpId,
      },
    };
  }

  if (operation === 'create') {
    const data = (a.data ?? {}) as Record<string, unknown>;
    return { ...a, data: { ...data, pumpId: data.pumpId ?? ctx.pumpId } };
  }

  if (operation === 'createMany') {
    const withPumpId = (row: Record<string, unknown>) => ({ pumpId: ctx.pumpId, ...row });
    const data = a.data;
    return {
      ...a,
      data: Array.isArray(data) ? data.map(withPumpId) : data ? withPumpId(data) : data,
    };
  }

  return args;
}

// Prisma Client Extension (the $extends API) — NOT the classic $use
// middleware, which was fully removed as of Prisma 5 (confirmed against
// this project's generated 6.19.3 client: `Prisma.Middleware` and
// `client.$use` don't exist). Applied in prisma.service.ts's constructor,
// which returns the EXTENDED client (with two lifecycle methods manually
// re-attached) instead of `this` — see that file's comment for the full
// reasoning — so every one of this codebase's ~26 services keeps injecting/
// using `PrismaService` exactly as before, with zero changes to their own
// code. Because this is a Client Extension (not $use), it is inherited by
// every client produced by `$transaction(async (tx) => {...})`, which is
// what most of this codebase's money-touching writes use — no changes
// needed at any transaction call site either.
//
// KNOWN LIMITATION, found live against the real dev DB (see the Phase 2
// progress log in docs/multi-tenancy-plan.md): this only intercepts
// TOP-LEVEL model operations. A NESTED relation write — e.g.
// `tx.bill.create({ data: { ..., paymentLines: { create: [...] } } })` —
// does NOT route each nested BillPaymentLine row through
// $allOperations as its own "create"; Prisma resolves nested writes
// internally as part of the single outer query. Any future create/update
// on a tenant-scoped model that uses a nested relation write (grep for
// `<relationField>: { create:` on a TENANT_SCOPED_MODELS member) MUST
// stamp `pumpId` explicitly on each nested row instead of relying on this
// extension — see bills.service.ts's create()/update() for the pattern
// (`pumpId: requireTenantContext().pumpId` on each mapped payment line).
export function tenantScopingExtension() {
  return Prisma.defineExtension({
    name: 'tenant-scoping',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!model || !TENANT_SCOPED_MODELS.has(model)) {
            return query(args);
          }

          const ctx = getTenantContext();
          if (!ctx) {
            // No tenant context — e.g. seed.ts, a one-off script, or (in
            // normal request handling) a route with no authenticated user.
            // Passing through unscoped here is a deliberate escape hatch
            // for those callers, not a silent bypass of real traffic:
            // every authenticated HTTP request has a context set by
            // TenantContextInterceptor before any service/controller code
            // runs.
            return query(args);
          }

          return query(scopeArgs(operation, args, ctx) as Parameters<typeof query>[0]);
        },
      },
    },
  });
}
