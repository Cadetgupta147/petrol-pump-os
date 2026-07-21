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

- [ ] Phase 0.1 — Pump model + nullable pumpId on straightforward tenant models, backfilled
- [ ] Phase 0.2 — Staff/Customer → Account/Membership split
- [ ] Phase 0.3 — flip pumpId to required
- [ ] Phase 1 — Auth JWT/membership resolution
- [ ] Phase 2 — AsyncLocalStorage + Prisma Client Extension tenant scoping
- [ ] Phase 3 — UPI webhook pump resolution
- [ ] Phase 4 — Audit-trail actor fix (finding A1)
- [ ] Phase 5 — Pump provisioning script
- [ ] Phase 6 — Frontend verification pass
