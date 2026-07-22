# Multi-Tenancy Retrofit — Petrol Pump OS

**Status: finalized design, phased implementation in progress.** This is a large, foundational
change — it is being built and committed as a sequence of phases across sessions, not in one
pass. Reference this document directly in a new session ("read docs/multi-tenancy-plan.md") to
pick up full context on this initiative.

---

## Context

The system was built single-tenant (`docs/master-plan.md` §16: "your own pump as the first
real deployment"). All data lives in one shared set of Postgres tables with no concept of
which pump owner it belongs to — confirmed via full-schema grep, zero `Pump`/`tenant`/
`pumpId` exists anywhere pre-retrofit.

The system is now being built as a paid product for **multiple petrol pump owners**, each
needing their staff, customers, bills, and every other record fully isolated from every other
pump's. This plan makes that real.

**Business context that shapes the technical design:**
- Payment is collected **manually** (UPI/bank transfer/invoice, outside the app) — no
  payment-gateway/subscription-billing integration is in scope here or planned soon.
- New pump onboarding is **manual provisioning** (operator creates the account after payment
  is received) — no public self-service signup flow is in scope here.
- A person (staff or customer) may need to belong to **more than one pump** eventually (e.g. a
  shared accountant, a customer who fuels at two pumps) — the data model must support this
  from day one, even though the UI for switching between multiple pump memberships is
  explicitly **not** being built yet (v1 UX: invisible in the 99% single-membership case).

---

## Design

### 1. New tenant root
`Pump { id, name, pumpCode (unique, e.g. "PUMP001" — replaces the current `PUMP_CODE` env
var), active, createdAt, updatedAt }`.

### 2. Identity vs. membership split (staff and customers both)
Rather than putting `pumpId` directly on `Staff`/`Customer` (locking one person to one pump
forever), split each into an account (login identity) and a membership (the per-pump
relationship):

- `StaffAccount { id, phone (unique — login identifier), passwordHash?, pinHash?, name,
  active }`
- `StaffMembership { id, staffAccountId, pumpId, role, active }` — one row per person per pump.
  Every existing "who did this" FK in the schema (`Bill.enteredById`,
  `CashCustodyLog.handledById`, `AttendanceLog.staffId`, `DipReading.recordedById`,
  `DensityLog.recordedById`, etc.) is repointed to reference `StaffMembership.id`, **not** the
  bare account. Column names stay as they are (`enteredById`, `staffId`, ...) — only what they
  point at changes — so the blast radius on existing DTOs/services/tests is "this id now
  resolves to a membership row," not a field-rename across ~150 call sites.
- `CustomerAccount { id, phone (unique — OTP login identifier), name }`
- `CustomerMembership { id, customerAccountId, pumpId, qrMemberId (per-pump),
  loyaltyRateOverride, creditLimit, verificationStatus, vehicleNumber, active, createdAt }` —
  everything currently on `Customer` that's inherently per-pump moves here. `Bill.customerId`,
  `LoyaltyTransaction.customerId`, `Payment.customerId`, etc. all repoint to
  `CustomerMembership.id`.

`StaffAccount.phone` and `CustomerAccount.phone` stay **globally unique** — this is the login
identifier, and it's what makes multi-pump membership possible without a "which pump" field
at login: the server resolves account → membership(s) after authenticating, not before.

### 3. Every other tenant table gets a direct `pumpId` FK
`Tank`, `ShiftSalesSummary`, `UpiWebhookEvent`, `PurchaseEntry`, `LubricantItem`,
`RateHistory`, `GiftCatalogItem`, `TallyExportLog`, `BillPaymentLine`, `BillAuditLog`,
`CreditLimitAlert`, `MeterReading`, `DipReading`, `DensityLog`, `LoyaltyTransaction`,
`RedemptionTransaction`, `CashCustodyLog`, `Payment`, `CustomerOtp` (nullable-customer case
handled by resolving pumpId from request context at OTP-send time, not from `customerId`) —
direct `pumpId`, not relying on joins, for query safety and performance.
`RateHistory`'s `@@unique([productType, effectiveFrom])` becomes
`@@unique([pumpId, productType, effectiveFrom])`.

### 4. Singleton configs become per-pump
`CreditConfig`, `BusinessProfile`, `LoyaltyConfig`, `MemberIdCounter` each drop their hardcoded
fixed-id upsert pattern in favor of `@@unique([pumpId])`, with `pumpId` as the effective
per-pump singleton key. `member-id.ts`'s `PUMP_CODE` env var is replaced by reading the current
tenant's `Pump.pumpCode`.

### 5. Tenant-scoping enforcement — AsyncLocalStorage + Prisma Client Extension
This is the mechanism that makes isolation automatic instead of "hope every one of ~142 query
call sites remembers to filter by pumpId":

1. An `AsyncLocalStorage`-based request context (new module,
   `apps/backend/src/common/tenant-context.ts` or similar), holding
   `{ pumpId, staffMembershipId?, customerMembershipId?, role? }`.
2. An interceptor registered as a global `APP_INTERCEPTOR` (same registration pattern as the
   existing `APP_GUARD` entries in `app.module.ts`) runs immediately after `JwtAuthGuard`
   populates `req.user`, and populates the AsyncLocalStorage context from it for the duration
   of the request.
3. A **Prisma Client Extension** (`$extends(...)`) applied to `PrismaService` — reads the
   context and, for an allow-listed set of tenant-scoped models:
   - Merges `pumpId` into every `where` for reads (`findMany`/`findFirst`/`count`/`aggregate`/
     `groupBy`) and writes (`update`/`updateMany`/`delete`/`deleteMany`).
   - Rewrites `findUnique`/`findUniqueOrThrow` to `findFirst`/`findFirstOrThrow` internally
     (Prisma's `where` for unique lookups can't take a non-unique extra filter directly — this
     is the standard documented pattern for tenant isolation via Client Extensions).
   - Injects `pumpId` into `create`'s `data`.
   - Because this is a **Client Extension** (not the deprecated `$use` middleware), it is
     inherited by every client produced by `$transaction(async (tx) => {...})` — confirmed
     necessary since 8 of 10 `$transaction` call sites use the interactive-callback form, and
     `tx` gets passed as a bare argument across service boundaries (`bills.service.ts` →
     `member-id.ts`'s `allocateQrMemberId(tx)`; `upi-webhook.service.ts` →
     `shift-sales.service.ts`'s `incrementUpiForShift(tx, ...)`). No changes needed at those
     call sites — the extension covers them transparently.
4. `POST /upi-webhook/:pumpId` — the one route with no JWT (external payment provider). The
   controller resolves `pumpId` from the URL path param and sets the AsyncLocalStorage context
   explicitly before calling into the service, instead of relying on the interceptor.

### 6. Audit-trail fix, bundled (ties into `docs/production-readiness.md` finding A1)
Today, staff-side services trust a client-supplied `staffId` in the request body instead of
deriving it from the JWT (e.g. `ClockInDto.staffId`) — the same root cause this retrofit is
already fixing. Once `req.user`/the tenant context reliably carries `staffMembershipId`,
DTOs/services should stop accepting an actor id from the client and derive it server-side
instead. Bundled into this work since it's the same infrastructure, but committed as its own
reviewable step (money/audit-trail-adjacent — human review before merge per `CLAUDE.md`).

### 7. Pump provisioning — manual, internal tool only
No public signup endpoint. A small script (`prisma/provision-pump.ts`, run via `ts-node` the
same way `prisma/seed.ts` already is) that takes a pump name/code and an initial Owner's
name/phone/password, and creates `Pump` + `StaffAccount` + `StaffMembership(role=OWNER)`
atomically. Used by the operator after a new client has paid. `prisma/seed.ts` itself gets
updated to create demo data under a seeded default `Pump` in this same shape.

---

## Phased implementation plan

Each phase is committed independently, built and verified against the real Supabase dev DB
(run `prisma migrate dev`, build, run tests, smoke-test live, clean up any test data created).

**Phase 0 is itself sub-phased**, since it's the single largest and riskiest piece — adding a
required FK to nearly every table in a live database while services are still actively using
it needs a nullable-then-required two-step, not one big-bang migration:

- **Phase 0.1 — additive, zero-risk**: add `Pump` model + **nullable** `pumpId` to every
  tenant model that doesn't require the Staff/Customer split (`Tank`, `ShiftSalesSummary`,
  `UpiWebhookEvent`, `PurchaseEntry`, `LubricantItem`, `RateHistory`, `GiftCatalogItem`,
  `TallyExportLog`, `BillPaymentLine`, `BillAuditLog`, `CreditLimitAlert`, `MeterReading`,
  `DipReading`, `DensityLog`, `LoyaltyTransaction`, `RedemptionTransaction`, `CashCustodyLog`,
  `Payment`, `CustomerOtp`, `Bill`, plus the singleton configs). Backfill every existing row to
  one seeded "default" `Pump`. Nothing in application code reads or filters on `pumpId` yet —
  build and test suite stay green, unchanged, throughout.
- **Phase 0.2 — Staff/Customer split**: introduce `StaffAccount`/`StaffMembership` and
  `CustomerAccount`/`CustomerMembership`, migrate existing `Staff`/`Customer` rows into that
  shape, repoint every FK that referenced `Staff`/`Customer` to the new membership models. This
  is the genuinely invasive step — touches most services' Prisma calls
  (`prisma.staff.*` → `prisma.staffMembership.*`/`staffAccount.*`, equivalently for customer),
  their DTOs, and their tests. Done as its own reviewed, tested, committed step.
- **Phase 0.3 — flip to required**: once the Prisma Client Extension (Phase 2) is actually
  injecting `pumpId` on every create, migrate `pumpId` from nullable to required across all
  Phase 0.1 models. Deliberately sequenced *after* Phase 2, not before — until the extension
  exists, nothing guarantees every create path supplies `pumpId`, so flipping to `NOT NULL`
  earlier would risk breaking live writes.

**Phase 1 — Auth: account/membership resolution + JWT**
Update `AuthService`/`CustomerAuthService` to look up the account by phone, resolve the
membership (v1: the account's one membership), and stamp `{ pumpId, staffMembershipId, role,
sub }` / `{ pumpId, customerMembershipId, phone, scope, tokenVersion, sub }` into their
respective JWTs. Update both `JwtPayload`/`AuthenticatedUser` and
`CustomerJwtPayload`/`AuthenticatedCustomer` interfaces and both strategies' `validate()`.

**Phase 2 — Tenant-scoping infrastructure**
Build the AsyncLocalStorage context module, the populating interceptor, and the Prisma Client
Extension (the allow-listed tenant-model injection + `findUnique`→`findFirst` rewrite
described above). Highest-risk phase — needs a dedicated test suite proving a request scoped
to Pump A can never read/write a row belonging to Pump B, including inside transactions.

**Phase 3 — UPI webhook pump resolution**
`POST /upi-webhook/:pumpId`, explicit context-setting from the path param.

**Phase 4 — Audit-trail actor fix (bundled, separately committed)**
Stop trusting client-supplied actor ids across the DTOs/services identified in
`docs/production-readiness.md` finding A1; derive from the now-trustworthy tenant context
instead. Flagged for human review before merge per `CLAUDE.md`.

**Phase 5 — Pump provisioning script**
`prisma/provision-pump.ts`; update `prisma/seed.ts` to the new account/membership shape.

**Phase 6 — Frontend verification pass**
Web portal / DSM app / customer app need no structural changes (they already just carry an
opaque JWT), but need a verification pass to confirm nothing client-side broke from ids now
resolving to memberships rather than bare accounts, and optionally surface the pump's name
somewhere in the web portal UI (e.g. `TopBar`) for operator clarity — low-priority polish, not
required for isolation itself.

---

## Verification approach (every phase)

- `npx prisma migrate dev` against the real Supabase dev DB, `npm run build`, full backend
  test suite (`npx jest`) after each schema/service change.
- Phase 2 specifically needs new tests proving cross-tenant isolation: create two `Pump`s in a
  test setup, confirm a request context scoped to one can never see/mutate the other's rows
  via any of `findMany`/`findFirst`/`findUnique`/`update`/`delete`/`aggregate`, and confirm
  this holds inside an interactive `$transaction` too.
- Live smoke-test against the running dev backend, cleaning up any test data created afterward.
- After each Phase 0 sub-step, confirm existing demo data (seeded Owner/Accountant/DSM, and
  anything created during earlier smoke tests) still resolves correctly under the new shape.

---

## Not in scope for this retrofit (explicitly deferred, not forgotten)

- Payment-gateway/subscription billing integration.
- Public self-service pump signup.
- A "switch between pump memberships" UI for the rare multi-pump person — schema supports it,
  UI doesn't need to exist yet.

---

## Progress log

- [x] Phase 0.1 — Pump model + nullable pumpId on straightforward tenant models, backfilled
  (2026-07-21). Added `Pump`; added nullable `pumpId` to `Bill`, `BillAuditLog`,
  `BillPaymentLine`, `CreditConfig`, `BusinessProfile`, `CreditLimitAlert`, `MeterReading`,
  `Tank`, `DipReading`, `DensityLog`, `ShiftSalesSummary`, `UpiWebhookEvent`, `PurchaseEntry`,
  `LubricantItem`, `RateHistory`, `LoyaltyConfig`, `LoyaltyTransaction`, `GiftCatalogItem`,
  `RedemptionTransaction`, `CashCustodyLog`, `Payment`, `TallyExportLog`, `CustomerOtp`,
  `MemberIdCounter`; `RateHistory`'s unique constraint now includes `pumpId`;
  `CreditConfig`/`BusinessProfile`/`LoyaltyConfig`/`MemberIdCounter` got `@@unique([pumpId])`
  ahead of time (safe while nullable/single-row). Bootstrapped one `default_pump`
  (`pumpCode: PUMP001`) and backfilled every existing row to it — migration
  `20260721210000_multi_tenancy_phase_0_1_add_pump_and_nullable_pumpid`. `migrate dev` doesn't
  run non-interactively in this environment (the new unique constraints trigger a confirmation
  prompt) — used `prisma migrate diff` to generate the SQL, hand-placed it into a migration
  folder with the backfill DML appended, applied via `prisma db execute`, then
  `prisma migrate resolve --applied` to keep migration history in sync. Verified: full backend
  build + test suite green (41/41 suites, 371/371 tests — one flaky unrelated failure on first
  run, passed on re-run), live smoke test against the real Supabase dev DB confirmed existing
  rows show `pumpId: "default_pump"` and new creates still succeed unaffected (`pumpId: null`,
  expected until Phase 2). Zero application code changed — no service reads/filters on `pumpId`
  yet.
- [x] Phase 0.2 — Staff/Customer → Account/Membership split (2026-07-21/22).
  Added `StaffAccount`/`CustomerAccount` (login identity) — `Staff`/`Customer`
  kept their original names and now represent per-pump MEMBERSHIP rows (see
  schema comments for why: avoids a `prisma.staff.* → staffMembership.*`
  rename across ~150 existing call sites). `name` is denormalized onto both
  membership rows (kept in sync on write) so the many read call sites never
  needed to change; `phone` similarly denormalized onto `Customer` (not
  unique anymore — uniqueness lives on `CustomerAccount.phone`).
  `tokenVersion` moved from `Customer` to `CustomerAccount` (it's a session
  property, not a per-pump one). `member-id.ts`'s `allocateQrMemberId()` is
  now pump-aware (`pumpCode` read from the `Pump` row, not a `PUMP_CODE` env
  var — removed from `.env.example`). Real code touched: `auth.service.ts`,
  `customer-auth.service.ts`, both JWT strategies + payload interfaces (both
  gained `pumpId`), `staff-management.service.ts`, `customers.service.ts`
  (account find-or-create on create/update), `bills.service.ts`'s quick-add
  path, `prisma/seed.ts`. Everything else (bills, cash-custody, meter-
  readings, attendance, dip-readings, density-logs, etc.) needed **zero**
  changes — they only ever referenced `Staff`/`Customer` by id via existing
  relations, never touched credential fields.
  Migration `20260721220000_multi_tenancy_phase_0_2_staff_customer_account_split`
  — hand-sequenced (not a single `prisma migrate diff` pass, which would
  have dropped the old phone/pinHash/passwordHash/tokenVersion columns
  before their values could be copied out): create new tables → add new
  columns nullable → backfill (reusing each existing Staff/Customer row's
  own id as its new Account row's id, a safe 1:1 mapping) → drop old
  columns → add constraints. Verified: full test suite green (41
  suites/378 tests, ~15 spec files updated for the new
  account-lookup/transaction shapes), live smoke test against the real
  Supabase dev DB — login, PIN-login, staff-management create, customer
  create, OTP request/verify, and an authenticated `/customer-portal/me`
  call all confirmed working end-to-end with `pumpId` correctly flowing
  through every JWT — test data cleaned up afterward. Response shapes for
  every existing endpoint are unchanged, so no frontend (web portal, DSM
  app, customer app) changes were needed.
- [ ] Phase 0.3 — flip pumpId to required
- [x] Phase 1 — Auth JWT/membership resolution. Folded into Phase 0.2's work
  (auth.service.ts and customer-auth.service.ts already resolve accounts →
  memberships and stamp pumpId into both JWTs as part of that commit) — no
  separate work needed.
- [x] Phase 2 — AsyncLocalStorage + Prisma Client Extension tenant scoping
  (2026-07-22). Built `apps/backend/src/common/tenant-context.ts`
  (AsyncLocalStorage store + `getTenantContext()`/`requireTenantContext()`/
  `runInTenantContext()`), `tenant-context.interceptor.ts` (global
  `APP_INTERCEPTOR`, populates context from `req.user` after the auth
  guards run), and `apps/backend/src/prisma/tenant-scoping.extension.ts` (a
  Prisma Client Extension — **not** `$use` middleware, which turned out to
  be fully removed as of Prisma 5, confirmed against this project's 6.19.3
  client). `PrismaService`'s constructor now returns the `$extends()`-ed
  client (with `onModuleInit`/`onModuleDestroy` manually re-attached)
  instead of `this`, so all ~26 existing services keep injecting/using
  `PrismaService` completely unchanged.

  **Two non-obvious findings from live empirical testing against the real
  dev DB** (not just assumed from docs):
  1. The callback passed to `tenantContextStorage.run()` **must** be an
     `async` function that internally `await`s — a bare arrow function that
     just *returns* a promise silently loses AsyncLocalStorage context
     somewhere inside Prisma's query dispatch. `runInTenantContext()`
     enforces the working pattern; the interceptor converts `next.handle()`
     (an Observable) via `lastValueFrom` so it can be awaited inside that
     required async callback.
  2. The extension only intercepts **top-level** model operations — a
     nested relation write (`bill.create({ data: { paymentLines: { create:
     [...] } } })`) does not route each nested row through
     `$allOperations`. Found live: `BillPaymentLine.pumpId` stayed `null`
     on bills created through the real API. Fixed by stamping `pumpId`
     explicitly on the two nested-write call sites in `bills.service.ts`
     (the only nested-relation-create pattern in the whole backend);
     documented as a "known limitation" in the extension's own header
     comment for any future nested-write call site on a tenant-scoped
     model.

  Also fixed, discovered only once Phase 2 was live: the four singleton-
  config services (`CreditConfigService`, `BusinessProfileService`,
  `LoyaltyService`, `member-id.ts`) still pinned a hardcoded global id
  (`'singleton'`) — the moment a second pump existed, its upsert collided
  with the first pump's row on that same primary key (P2002, caught live).
  `id` is now a normal auto-generated cuid on all four; `@@unique([pumpId])`
  (already added in Phase 0.1) is the real per-pump key, with the
  extension's auto-injection making `where: {}`/`create: {}` (cast via a
  small `EMPTY_UNIQUE_WHERE` constant, since TypeScript can't see the
  runtime injection) resolve correctly. Also removed the hardcoded
  `'default_pump'` literals left over from Phase 0.2 in
  `customers.service.ts`, `staff-management.service.ts`, and
  `bills.service.ts`'s quick-add path — those now read the real pump from
  `requireTenantContext()`/rely on the extension's auto-injection, closing
  the loop Phase 0.2 explicitly deferred to "once Phase 2 exists."

  Verified: full backend test suite green (42 suites/397 tests — ~6 spec
  files updated to establish a tenant context via `runInTenantContext()`
  before calling into now-context-dependent service methods, plus 2 new
  spec files for the extension itself and its pure `scopeArgs()`
  transformation function). Live smoke test against the real Supabase dev
  DB with **two actual Pump rows** end-to-end through real HTTP requests
  (not just direct Prisma calls): login, bill creation, rate master, staff
  management, and both singleton configs all independently verified
  isolated in both directions (Pump A's owner never sees Pump B's data and
  vice versa), including inside a `$transaction` interactive callback and
  through the real `TenantContextInterceptor`/`lastValueFrom` path (not
  just direct `PrismaService` calls). All test data cleaned up afterward.
- [x] Phase 3 — UPI webhook pump resolution (2026-07-22). Route changed to
  `POST /upi-webhook/:pumpId` — this remains the one `@Public()` route with
  no JWT (PhonePe/Paytm can't send our staff token), so
  `TenantContextInterceptor` never runs for it; each pump's merchant
  dashboard would be configured with its own webhook URL carrying its own
  pumpId. `UpiWebhookService.handleWebhook()` now: (1) verifies the HMAC
  signature first, unchanged; (2) does a plain, deliberately UNscoped
  `prisma.pump.findUnique({ where: { id: pumpId } })` existence+active
  check — the one legitimate unscoped lookup, since it's what establishes
  the tenant for everything downstream (`NotFoundException` if missing/
  inactive, checked live); (3) wraps the existing idempotency-transaction
  in `runInTenantContext({ pumpId }, ...)` so
  `tenant-scoping.extension.ts` auto-scopes/auto-stamps `UpiWebhookEvent`,
  `MeterReading`, `ShiftSalesSummary` inside `tx` exactly as it would for a
  normal JWT-authenticated request — no per-model manual pumpId stamping
  needed here (unlike bills.service.ts's nested-write case in Phase 2),
  since every write here is a direct top-level `tx.<model>.create/update`.

  Added 2 new spec cases (unknown pumpId → 404, inactive pump → 404, both
  asserting `$transaction` is never reached) and updated all existing
  `handleWebhook()` call sites for the new `pumpId` first argument. Full
  suite: 42 suites / 399 tests green.

  **Live verification note**: found `.env`'s `UPI_WEBHOOK_SIGNING_SECRET`
  is corrupted (starts with a stray `""` and no closing quote, which
  `dotenv` parses as an empty string) — a pre-existing issue, not caused by
  this phase, but it means the webhook currently fails closed
  (`verifyWebhookSignature`'s `!secret` guard) on literally every request
  regardless of Phase 3. Confirmed live: unsigned/garbage-signature
  requests correctly 401 and the `:pumpId` route param binds correctly
  (no Express-level 404) for both a real and a made-up pumpId, proving the
  routing wiring is sound; the signature-valid path, pump-404 path, and
  idempotency path are all covered by the (now 42/42 green) unit suite
  instead, since fixing the real secret requires the actual provider
  credential, which only the user has — **flagged to the user, not
  guessed/fixed**. A working `.env` value is needed before this endpoint
  can process a real webhook delivery.
- [x] Phase 4 — Audit-trail actor fix (finding A1) (2026-07-22). Every
  write endpoint that records "who performed this action" now derives that
  id from the authenticated caller (`req.user.staffId`) instead of trusting
  a client-supplied DTO field. Two different rules, depending on what the
  field actually means:
  - **Pure actor fields** (no override, ever): `Bill.enteredById/
    editedById/deletedById`, `DipReading.recordedById`,
    `DensityLog.recordedById` (including the linked one created inline by
    `PurchasesService.create()`), `BillAuditLog.performedById`. These
    record who performed THIS API call — removed entirely from their DTOs;
    controllers pull `req.user.staffId` via a new `@CurrentUser()` param
    decorator (`auth/decorators/current-user.decorator.ts`) and pass it to
    the service as an explicit argument.
  - **Assignable fields** (a supervisor may legitimately record on behalf
    of someone else — real flows the product spec relies on, e.g. an
    Accountant filing the day-end cash split for the Owner who actually
    took the cash home, or a Manager marking a DSM present):
    `CashCustodyLog.handledById`, `AttendanceLog.staffId` (clock-in),
    `MeterReading.staffId` (openShift). Each DTO field is now OPTIONAL;
    `resolveAssignableActorId()` (`common/resolve-assignable-actor.ts`)
    resolves it — omitted → the caller; explicitly set to someone else →
    allowed for any non-DSM caller, `ForbiddenException` (403) for a DSM
    caller. This was a judgment call, not explicit in either finding A1's
    prompt or master-plan.md — flagged here per CLAUDE.md's "flag
    conflicts instead of silently picking one" rather than blindly forcing
    every one of these fields to the caller, which would have broken the
    legitimate supervisor-records-for-someone-else flow.

  Frontend fallout, fixed in the same commit (`forbidNonWhitelisted: true`
  on the global ValidationPipe means a client still sending a now-removed
  field gets a hard 400, not a silent ignore): `apps/web-portal` — dropped
  `editedById`/`deletedById` from the bill edit/delete request types and
  call sites, made `OpenShiftRequest.staffId`/`CreateCashCustodyLogRequest.
  handledById` optional, added a UX-only DSM self-lock on the two
  "assignable" dropdowns (CashCustodyPage, OpenShiftModal) so a DSM user
  doesn't hit an avoidable 403 by picking someone else in a select that no
  longer permits it for their role. `apps/dsm-app` — dropped `enteredById`
  from the create-bill request type and call site.

  Verified: full backend suite green (42 suites/407 tests — 6 spec files
  updated for the new signatures, plus new coverage for
  `resolveAssignableActorId()`'s three branches: default-to-self,
  non-DSM-override-allowed, DSM-override-forbidden). `apps/web-portal`
  (`tsc --noEmit` + `vite build`) and `apps/dsm-app` (`tsc --noEmit` +
  `jest`, 2 suites/10 tests) both clean. Live end-to-end verification
  against the real Supabase dev DB with a real Owner login and a real
  temporary DSM staff member (PIN login) covering all 12 cases — bill
  create/update/delete actor attribution, cash-custody
  default/DSM-forbidden/owner-override, attendance
  default/DSM-forbidden, meter-reading openShift
  default/DSM-forbidden, and dip-reading/density-log pure-actor
  attribution — every case matched the intended behavior exactly. All test
  data (temp DSM account+membership, temp bill, temp Rate Master row)
  cleaned up afterward.

  **Also found and documented, not fixed** (belongs to the human/business
  side, not code): root `.env`'s `UPI_WEBHOOK_SIGNING_SECRET` is corrupted
  (Phase 3's finding) — still outstanding, unrelated to this phase.
- [x] Phase 5 — Pump provisioning script (2026-07-22). Added
  `prisma/provision-pump.cts`, run via `npm run provision-pump -- --pump-name
  "..." --pump-code "..." --owner-name "..." --owner-phone "..."
  --owner-password "..."` (all-flags, non-interactive — no TTY in this
  environment). Creates, atomically in one `$transaction`: `Pump`, a
  `MemberIdCounter` row for it (mandatory — `allocateQrMemberId()` throws
  for a pump with none; Phase 0.2's migration backfill created one for the
  seeded default pump, but nothing else did for a brand-new one until now),
  and a `StaffAccount` + `Staff(role=OWNER)` membership pair. Pre-flight
  checks reject a duplicate `pumpCode` or a phone that already has a
  `StaffAccount` (phone is the global login identifier — must stay unique
  across every pump) before the transaction opens, so a failed run never
  leaves partial data. `CreditConfig`/`BusinessProfile`/`LoyaltyConfig` are
  deliberately NOT created here — confirmed each is a lazy
  upsert-on-first-access (e.g. `CreditConfigService.getOrCreate()`), so
  they self-heal the first time the new pump's Owner touches any of those
  features.

  **`.cts` extension is deliberate, not a typo**: this repo has no root
  `tsconfig.json`, so a plain `ts-node prisma/provision-pump.ts` gets
  misdetected as ESM (`Unknown file extension ".ts"`) — discovered live
  when the obvious `--compiler-options {"module":"CommonJS"}` CLI flag
  (the same one `prisma/seed.ts` uses, invoked via `npx prisma db seed`)
  turned out to break under `npm run`'s argument quoting on Windows
  (reproduced in both Git Bash and PowerShell — not a Bash-tool quirk).
  `.cts` gives Node/ts-node unconditional CommonJS treatment regardless of
  nearest `package.json`/`tsconfig.json`, sidestepping the whole problem
  without touching `seed.ts`'s own already-working (if equally fragile)
  invocation path.

  Verified live against the real Supabase dev DB: full run producing a
  real `Pump` + `MemberIdCounter` + `StaffAccount` + `Staff(OWNER)`,
  confirmed by direct query; the new Owner's real login (`POST
  /auth/login`) succeeded with the correct `pumpId`/`role` in the JWT and
  a wrong-password attempt correctly 401'd; both duplicate-`pumpCode` and
  duplicate-phone pre-flight checks correctly rejected with no partial
  writes. All test data cleaned up afterward. Backend suite unaffected
  (this phase doesn't touch any service code): 42 suites/407 tests still
  green.
- [ ] Phase 6 — Frontend verification pass
