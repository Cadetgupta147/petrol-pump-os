import { AsyncLocalStorage } from 'node:async_hooks';
import { Role } from '@prisma/client';

// Phase 2 (docs/multi-tenancy-plan.md) — per-request tenant identity,
// threaded through async call chains via Node's AsyncLocalStorage rather
// than an explicit parameter, so it reaches every service/helper call
// (including `tx` clients inside `$transaction(async (tx) => ...)`, and
// free functions like member-id.ts's allocateQrMemberId that take a bare
// Prisma client and have no other way to receive it) without touching
// every one of those call sites individually.
//
// Populated by TenantContextInterceptor (tenant-context.interceptor.ts),
// registered as a global APP_INTERCEPTOR in app.module.ts, which runs after
// the auth guards have populated req.user. Read by
// tenant-scoping.extension.ts (prisma/) to auto-scope every tenant-owned
// model's queries by pumpId.
export interface TenantContext {
  pumpId: string;
  staffId?: string;
  customerId?: string;
  role?: Role;
}

export const tenantContextStorage = new AsyncLocalStorage<TenantContext>();

// Returns undefined outside a request scoped by TenantContextInterceptor —
// e.g. seed.ts, one-off scripts, or a public route with no authenticated
// user. tenant-scoping.extension.ts treats "no context" as "don't scope
// this query" (see that file's comment for why that's the correct default,
// not a silent bypass of real request traffic).
export function getTenantContext(): TenantContext | undefined {
  return tenantContextStorage.getStore();
}

// For call sites that need pumpId directly (not just relying on
// tenant-scoping.extension.ts's automatic where/data injection) — e.g.
// allocateQrMemberId(), which needs to know which Pump's pumpCode to read
// regardless of the extension, since Pump itself is deliberately not
// tenant-scoped. Throws rather than silently proceeding with no tenant,
// since every real call site for this is inside an authenticated request
// (TenantContextInterceptor is global) — reaching this with no context
// active means something is wrong with the auth/interceptor pipeline, not
// a normal "unconfigured" state to handle gracefully.
export function requireTenantContext(): TenantContext {
  const ctx = tenantContextStorage.getStore();
  if (!ctx) {
    throw new Error(
      'No tenant context available — this code path must run inside an authenticated request scoped by TenantContextInterceptor.',
    );
  }
  return ctx;
}

// EMPIRICAL FINDING (verified against the real dev DB — see
// docs/multi-tenancy-plan.md's Phase 2 progress log): the callback passed
// to `tenantContextStorage.run()` must be an `async` function that
// internally `await`s whatever it calls. A bare arrow function that just
// RETURNS a promise (`tenantContextStorage.run(ctx, () => prisma.x.y())`)
// silently loses the AsyncLocalStorage context somewhere inside Prisma's
// query dispatch pipeline — `getTenantContext()` comes back `undefined`
// inside the tenant-scoping extension even though the context was
// definitely active at the call site. This is NOT how AsyncLocalStorage is
// usually described to behave, but it's what this Prisma version (6.19.3)
// actually does in practice. `$transaction(async (tx) => {...})` callbacks
// are unaffected (they already are internally-awaited async functions).
//
// Use this helper everywhere a tenant context needs to be established
// around a Prisma-touching call, instead of calling
// `tenantContextStorage.run()` directly — it enforces the working pattern
// so this bug can't quietly reappear at a new call site.
export function runInTenantContext<T>(
  context: TenantContext,
  fn: () => Promise<T>,
): Promise<T> {
  return tenantContextStorage.run(context, async () => {
    return await fn();
  });
}
