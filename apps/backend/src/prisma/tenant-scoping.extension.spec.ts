import { scopeArgs, TENANT_SCOPED_MODELS } from './tenant-scoping.extension';
import type { TenantContext } from '../common/tenant-context';

// Phase 2 (docs/multi-tenancy-plan.md) — the actual security boundary of
// the whole multi-tenancy retrofit: every tenant-scoped model's query args
// must get pumpId merged in exactly once, in the right place, for every
// operation shape. Tests scopeArgs() directly (a pure function) rather than
// the Prisma Client Extension wrapper itself — Prisma.defineExtension's
// return value is an opaque object not meant to be introspected/invoked
// directly in a test; the extension wrapper (tenantScopingExtension) is
// thin glue around this function, verified separately via a live smoke
// test against the real dev DB (see the Phase 2 progress log) since that's
// the only way to confirm real Prisma behavior (extended-where-unique-input
// support, $transaction propagation) rather than an assumption about it.
describe('scopeArgs (Phase 2 tenant scoping)', () => {
  const ctx: TenantContext = { pumpId: 'pump-1' };

  it.each(['findUnique', 'findUniqueOrThrow', 'findFirst', 'findFirstOrThrow', 'findMany'])(
    'merges pumpId into where for %s',
    (operation) => {
      expect(scopeArgs(operation, { where: { id: 'bill-1' } }, ctx)).toEqual({
        where: { id: 'bill-1', pumpId: 'pump-1' },
      });
    },
  );

  it.each(['update', 'delete'])(
    "merges pumpId into where for singular %s (relies on Prisma's extended-where-unique-input support)",
    (operation) => {
      expect(scopeArgs(operation, { where: { id: 'cust-1' } }, ctx)).toEqual({
        where: { id: 'cust-1', pumpId: 'pump-1' },
      });
    },
  );

  it.each(['updateMany', 'deleteMany', 'count', 'aggregate', 'groupBy'])(
    'merges pumpId into where for %s',
    (operation) => {
      expect(scopeArgs(operation, { where: { productType: 'Petrol' } }, ctx)).toEqual({
        where: { productType: 'Petrol', pumpId: 'pump-1' },
      });
    },
  );

  it('defaults where to {} when the caller passed no where at all (e.g. a bare .count())', () => {
    expect(scopeArgs('count', undefined, ctx)).toEqual({ where: { pumpId: 'pump-1' } });
  });

  it('stamps pumpId onto data for create, without overriding an explicitly-supplied pumpId', () => {
    expect(scopeArgs('create', { data: { productType: 'Petrol' } }, ctx)).toEqual({
      data: { productType: 'Petrol', pumpId: 'pump-1' },
    });
    expect(
      scopeArgs('create', { data: { productType: 'Petrol', pumpId: 'pump-explicit' } }, ctx),
    ).toEqual({ data: { productType: 'Petrol', pumpId: 'pump-explicit' } });
  });

  it('stamps pumpId onto every row for createMany, without overriding rows that already have one', () => {
    expect(
      scopeArgs(
        'createMany',
        { data: [{ name: 'Oil' }, { name: 'Grease', pumpId: 'pump-explicit' }] },
        ctx,
      ),
    ).toEqual({
      data: [
        { name: 'Oil', pumpId: 'pump-1' },
        { name: 'Grease', pumpId: 'pump-explicit' },
      ],
    });
  });

  it('merges pumpId into both where and create for upsert', () => {
    expect(
      scopeArgs('upsert', { where: {}, create: { enforcementMode: 'NOTIFY' }, update: {} }, ctx),
    ).toEqual({
      where: { pumpId: 'pump-1' },
      create: { enforcementMode: 'NOTIFY', pumpId: 'pump-1' },
      update: {},
    });
  });

  it('leaves an unrecognized operation entirely untouched (fail-safe default, not fail-open)', () => {
    const args = { foo: 'bar' };
    expect(scopeArgs('someFutureOperation', args, ctx)).toBe(args);
  });
});

describe('TENANT_SCOPED_MODELS', () => {
  it('does NOT include the tenant root or identity tables', () => {
    // Pump is the tenant root; StaffAccount/CustomerAccount are login
    // identities searched by phone BEFORE a pump is known (login/OTP
    // request) — scoping any of these three would break auth outright.
    expect(TENANT_SCOPED_MODELS.has('Pump')).toBe(false);
    expect(TENANT_SCOPED_MODELS.has('StaffAccount')).toBe(false);
    expect(TENANT_SCOPED_MODELS.has('CustomerAccount')).toBe(false);
  });

  it('includes every model that carries a pumpId column (prisma/schema.prisma)', () => {
    // Mirrors the pumpId rollout from Phase 0.1/0.2 — if a future model
    // gains a pumpId column, it belongs in this set too, or its queries
    // silently stop being tenant-scoped.
    const expected = [
      'Staff',
      'Customer',
      'Bill',
      'BillAuditLog',
      'BillPaymentLine',
      'CreditConfig',
      'BusinessProfile',
      'CreditLimitAlert',
      'Item',
      'Nozzle',
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
    ];
    expect([...TENANT_SCOPED_MODELS].sort()).toEqual([...expected].sort());
  });
});
