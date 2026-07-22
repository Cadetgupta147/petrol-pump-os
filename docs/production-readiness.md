# Production Readiness Audit — 2026-07-22

**What this is:** a full-repo audit (backend, web portal, DSM app, customer app, and cross-cutting infra) done to answer one question: *what stands between this codebase and safely taking real customer money and real customer data?*

**How to use this document:** each item below is a real, verified finding (file + line checked, not guessed) with a severity, an explanation of why it matters, and a ready-to-paste prompt you can hand to Claude Code to fix it. Prompts name the specialist agent to use per `CLAUDE.md` (`backend-agent` for `apps/backend`/`apps/web-portal`/`prisma`, `mobile-agent` for `apps/dsm-app`/`apps/customer-app`). **Anything touching money or points is human-reviewed before merge — that rule from `CLAUDE.md` applies to every fix here that says so, no exceptions for "it's just a bug fix."**

This document supersedes nothing in `docs/master-plan.md` Section 17 (Open Decisions/Risks) or Section 18 (Go-Live Checklist) — it verifies those against actual code as of this audit, and adds findings the plan didn't already track. Where a finding duplicates a plan item, it's marked **[tracked in plan]** and the prompt is scoped to actually closing it, not just re-flagging it.

Severity legend: **BLOCKER** = do not take real customer money/data until fixed. **HIGH** = fix before the affected feature is relied on. **MEDIUM** = real gap, not urgent. **LOW** = polish/cleanup.

---

## Quick-reference: Blockers (fix these first)

1. Staff identity on money/audit-trail writes is client-supplied, not derived from the logged-in session (backend)
2. No rate limiting/lockout on staff login (`/auth/login`, `/auth/pin-login`)
3. UPI webhook signature check is a placeholder algorithm, not a real provider's scheme **[tracked in plan §17/§18]**
4. Editing/deleting a bill doesn't reverse the loyalty points it earned **[tracked in plan §17.13/§18.1]**
5. No deployment configuration exists anywhere (no Dockerfile, no Vercel/Netlify config, no EAS config)
6. Production hosting not actually confirmed — Supabase free tier auto-pauses, no backups **[tracked in plan §18.1]**
7. DPDP Act consent-capture / data-deletion is unimplemented **[tracked in plan §17.11/§18.1]**
8. DSM app has no offline queue — fails outright with no signal, which the plan itself calls "a non-starter"
9. Four core web-portal modules (Billing register, Meter Readings, Staff, Settings) are unbuilt stub nav items, not partially-built screens

---

## A. Backend (`apps/backend`, `prisma/`)

### A1. Staff identity on money/audit-trail actions is spoofable — BLOCKER
**Files:** `apps/backend/src/bills/bills.controller.ts:35,50,59`, `bills.service.ts` (`enteredById`/`editedById`/`deletedById`), `cash-custody/cash-custody.controller.ts:23` (`handledById`), `attendance/attendance.controller.ts:26` (`staffId`), plus `recordedById` on `DipReading`/`DensityLog`.

Only 2 of 26 controllers read `req.user` for "who did this." Everywhere else — bill entry/edit/delete, cash custody handover, attendance clock-in, DIP/density readings — the acting staff member's ID comes straight from the request body. Any authenticated staff account (including a DSM) can currently submit another staff member's ID and the API accepts it without checking it matches the caller. This breaks the audit trail the plan explicitly calls out as non-negotiable (§3.2) and CLAUDE.md's "never trust the frontend" rule extends naturally to "never trust a client-supplied actor ID either." A malicious or buggy client could pin cash-custody debt or a bad bill on the wrong person.

```
Use the backend-agent. In apps/backend, every write endpoint that records "who performed this action" 
(Bill create/update/remove — enteredById/editedById/deletedById; CashCustodyLog handledById; 
AttendanceLog clock-in staffId; DipReading and DensityLog recordedById; BillAuditLog performedById; 
and any other similar field) must derive that ID from the authenticated request (req.user.staffId, 
already populated by JwtAuthGuard/JwtStrategy) server-side, not accept it from the request DTO. 
Remove these fields from the relevant DTOs where they are currently client-supplied, and update the 
services/controllers to pull the actor from the guard-populated request user instead. Do not change 
any business logic beyond this substitution. Since this touches Bill and CashCustodyLog (money-adjacent 
audit trail), flag it for human review before merge per CLAUDE.md and write/update tests confirming a 
request cannot attribute an action to a staffId other than the authenticated caller's.
```

### A2. No rate limiting or lockout on staff login — BLOCKER
**File:** `apps/backend/src/auth/auth.controller.ts`, `auth.service.ts:19-88`.

`customer-auth`'s OTP endpoints are correctly wrapped in `ThrottlerGuard` with per-phone attempt/lockout tracking (`CustomerOtp.attemptCount`). `AuthController` (staff login, including short numeric DSM PIN login) has none of that — no `@Throttle`, no `ThrottlerGuard`, no failed-attempt counter. A short numeric PIN with no throttle is brute-forceable at full request speed. `@nestjs/throttler` is already a project dependency, so this is inconsistency, not a missing capability.

```
Use the backend-agent. Apply the same rate-limiting/lockout pattern already used in 
apps/backend/src/customer-auth (ThrottlerGuard + attempt tracking) to apps/backend/src/auth's 
/auth/login and /auth/pin-login endpoints. DSM PIN login should have a stricter throttle than the 
password login given it's a short numeric credential — pick a sane default (e.g. 5 failed attempts 
per identifier per 15 minutes, configurable) and lock out or exponentially back off past that, mirroring 
whatever pattern customer-auth already established for consistency. Write tests confirming repeated 
failed logins get throttled and a legitimate login still succeeds after a wait/reset.
```

### A3. UPI webhook signature verification is a generic placeholder — BLOCKER **[tracked in plan §17/§18]**
**File:** `apps/backend/src/upi-webhook/verify-webhook-signature.util.ts:1-38`.

Confirmed by reading the code: it's a plain HMAC-SHA256-hex check over the raw body, explicitly a stand-in for PhonePe's real `X-VERIFY: SHA256(payload+saltKey)###saltIndex` scheme or Paytm's equivalent. The good news, also verified: idempotency (dedupe via `UpiWebhookEvent.providerEventId` unique constraint, transactional create-then-catch-P2002) is correctly implemented and production-ready — only the signature algorithm needs swapping once a provider is chosen.

**Also found live while verifying multi-tenancy Phase 3 (docs/multi-tenancy-plan.md) on 2026-07-22:** root `.env`'s `UPI_WEBHOOK_SIGNING_SECRET` value is itself corrupted — it starts with a stray `""` and has no closing quote, which `dotenv` silently parses as an empty string rather than erroring. `verifyWebhookSignature`'s `!secret` guard correctly fails closed on this (every webhook request currently gets rejected with 401, not silently accepted), so this hasn't caused a security hole — but it does mean the endpoint cannot process a real delivery right now. Not fixed here: I don't know the intended real secret value, and editing `.env` is outside what I should do unattended. **Action needed: open `.env`, find the `UPI_WEBHOOK_SIGNING_SECRET=` line, and replace it with a real properly-quoted (or unquoted) secret value.**

```
This depends on a business decision first: pick PhonePe for Business or Paytm Business as the merchant 
webhook provider (docs/master-plan.md §17.8 lists this as still undecided — decide it, don't guess). 
Once decided, use the backend-agent to replace apps/backend/src/upi-webhook/verify-webhook-signature.util.ts 
with that provider's actual signature verification scheme (read their merchant webhook docs for the exact 
header name and hash construction). Keep the existing idempotency/dedupe logic in upi-webhook.service.ts 
unchanged — it already works correctly. This touches payment reconciliation, so it needs human review 
before merge per CLAUDE.md. Add a test using a real (or provider-documented sample) signed payload to 
confirm verification actually passes/fails correctly, not just that the function runs.
```

### A4. Bill edit/delete doesn't reverse loyalty points — BLOCKER **[tracked in plan §17.13/§18.1]**
**File:** `apps/backend/src/bills/bills.service.ts:306-311` and `:473-477` (explicit `KNOWN GAP` comments).

Editing a bill's amount/litres/customer never recomputes the `LoyaltyTransaction` it generated; soft-deleting a bill never reverses the points it earned. Real customer point balances will silently drift from reality the first time any bill gets corrected or voided — and corrections are routine (§3.2: "DSMs make typos... a bill needs to be corrected days later").

```
Use the backend-agent to implement docs/master-plan.md §17.13 exactly as described: in 
apps/backend/src/bills/bills.service.ts, when update() changes amount/litres/customer on a bill that 
already has an associated LoyaltyTransaction, write a compensating LoyaltyTransaction (reverse the old 
points, then — if the bill still has a customer/loyalty basis — issue a new correct-amount transaction), 
all inside the same $transaction as the bill update. When remove() soft-deletes a bill, write a 
compensating reversal LoyaltyTransaction for the full amount originally earned. Do not allow a customer's 
displayed points balance to ever reflect a bill that no longer exists or has different values. This is 
money/points-touching logic — flag explicitly for human review before merge per CLAUDE.md, and write 
tests covering: edit changes points up, edit changes points down, edit removes the customer entirely, 
and delete reverses points fully, including the case where the customer has since redeemed points below 
what a naive reversal would allow (decide and document the intended behavior for that edge case explicitly).
```

### A5. `GET /bills` has no filters or pagination — HIGH
**File:** `apps/backend/src/bills/bills.controller.ts:39-42`, `bills.service.ts:285-291`.

Spec (§3.2) requires filtering by date range, customer, DSM, payment type, and vehicle number. The actual implementation returns every non-deleted bill ever created, unbounded — no query params accepted at all. This is a functional gap (the API can't do what the register screen needs) and a scaling risk once the pump accumulates months of bills.

```
Use the backend-agent to implement filtering and pagination on GET /bills per docs/master-plan.md §3.2: 
accept query params for date range (from/to), customerId, DSM/staffId, payment type, and vehicle number 
(partial match), plus standard limit/offset or cursor pagination. Update bills.service.ts's findMany call 
to build a where clause from whichever filters are present, and add sensible defaults (e.g. default to 
current day or last 30 days, and a max page size) so an unfiltered call can't return unbounded data. 
Update the corresponding DTO and add tests for each filter combination.
```

### A6. No global rate limiting or security headers — MEDIUM
**Files:** `apps/backend/src/main.ts`, `package.json` (no `helmet`).

No `helmet()` call anywhere, and `ThrottlerGuard` is only applied to `customer-auth`, not registered globally via `APP_GUARD`. For an API that will carry real money/customer data, baseline security headers and a defense-in-depth global throttle are standard and cheap.

```
Use the backend-agent to add the helmet package to apps/backend and wire it into main.ts's bootstrap 
(app.use(helmet())) with sane defaults for an API (not a server-rendered HTML app). Also register a global 
ThrottlerGuard via APP_GUARD in app.module.ts with a reasonable default rate limit (e.g. 100 req/min per IP), 
leaving room for the stricter per-route throttles already used on auth/OTP endpoints (from finding A2) to 
still apply on top. Confirm existing endpoints/tests still pass after adding the global guard.
```

### A7. No environment variable validation at startup — MEDIUM
**File:** `apps/backend/src/app.module.ts:53-56`.

`ConfigModule.forRoot` has no `validationSchema`. `JWT_SECRET` is defensively checked in `jwt.strategy.ts`, but `DATABASE_URL`, `CUSTOMER_JWT_SECRET`, `UPI_WEBHOOK_SIGNING_SECRET`, etc. aren't validated at boot — a misconfigured deploy fails late/confusingly instead of refusing to start with a clear message.

```
Use the backend-agent to add startup environment-variable validation to apps/backend using Joi (or Zod) 
via ConfigModule.forRoot's validationSchema option in app.module.ts. Validate every required env var 
referenced across apps/backend/src (grep process.env usage to build the full list — DATABASE_URL, 
JWT_SECRET, CUSTOMER_JWT_SECRET, UPI_WEBHOOK_SIGNING_SECRET, and any others in .env.example that the 
backend actually reads) as required non-empty strings, with the app refusing to boot and printing a 
clear error naming the missing variable(s) if validation fails.
```

### A8. No Dockerfile / no defined deploy artifact — MEDIUM (feeds Blocker #5/#6)
**Repo-wide:** no `Dockerfile` anywhere; `docker-compose.yml` only (and per CLAUDE.md, unused — Postgres is Supabase-hosted).

```
Use the backend-agent to create a production Dockerfile for apps/backend (multi-stage: install + build 
in one stage, copy dist + production node_modules into a slim runtime stage, run as non-root, expose the 
configured port, run `node dist/main.js`). Do not add a Postgres service to any compose file — the backend 
connects to Supabase via DATABASE_URL per CLAUDE.md, this Dockerfile is for the API process only. Also 
add a .dockerignore excluding node_modules, .env, and test files. This unblocks actually deploying to 
whatever VM/host is chosen (docs/master-plan.md §15.1) — pick and confirm the actual hosting target as 
a follow-up decision, this task is just making the backend containerizable.
```

### A9. No Swagger/OpenAPI spec — MEDIUM
**Repo-wide:** `@nestjs/swagger` not a dependency.

Master plan §16.1 explicitly relies on a generated OpenAPI spec so `mobile-agent` can build against the API contract without reading backend source. This was never built.

```
Use the backend-agent to add @nestjs/swagger to apps/backend, decorate the existing DTOs and controllers 
with @ApiProperty/@ApiTags/@ApiOperation as needed (can be incremental — start with the modules mobile-agent 
depends on most: auth, bills, customers, loyalty, meter-readings), and expose the generated spec at 
/api/docs (or similar) in non-production environments. Confirm the generated spec accurately reflects 
request/response shapes for at least the DSM-app-facing endpoints (auth, bills, meter-readings, staff) 
as a first pass.
```

### A10. Almost no database indexes beyond primary keys — MEDIUM
**File:** `prisma/schema.prisma` — only 2 `@@index`/`@@unique` hits across 25+ models.

Foreign keys used in frequent filters (`Bill.customerId`, `BillPaymentLine.billId`, `LoyaltyTransaction.customerId`, `CashCustodyLog.handledById`, `MeterReading.staffId`/`nozzleId`) have no explicit index. Low risk at current single-pump volume, but the credit-limit aggregation and dashboard/report queries will degrade as history grows.

```
Use the backend-agent to review prisma/schema.prisma and add @@index declarations on foreign-key columns 
that are filtered/joined on in hot paths: Bill.customerId, BillPaymentLine.billId, 
LoyaltyTransaction.customerId, CashCustodyLog.handledById, MeterReading.staffId, MeterReading.nozzleId, 
and any other FK column used in a .service.ts where/aggregate clause (grep for `where:` clauses filtering 
on *Id fields across apps/backend/src to build the full list). Create this as a single Prisma migration 
(prisma migrate dev), never hand-edit the schema per CLAUDE.md's hard rule. No data or logic changes.
```

### A11. No global exception filter / structured logging / Sentry — LOW **[tracked in CLAUDE.md "known gaps"]**
**Repo-wide:** no `ExceptionFilter`, no `winston`/`pino`, `SENTRY_DSN` still just a commented placeholder.

```
Use the backend-agent to: (1) add a global NestJS exception filter in apps/backend that logs unhandled 
errors with request context (method, path, staffId if authenticated) without leaking stack traces in 
HTTP responses in production; (2) wire up Sentry (@sentry/node) reading SENTRY_DSN from env, no-op if 
unset, per the existing .env.example placeholder. This is flagged in CLAUDE.md as required "before Phase 2" 
— confirm which phase the project is actually in before treating this as optional.
```

---

## B. Web Portal (`apps/web-portal`)

### B1. Four core Section 3 modules are unbuilt stub nav items — BLOCKER
**File:** `apps/web-portal/src/components/layout/NavBar.tsx:23-28`.

`Billing`, `Meter readings`, `Staff`, and `Settings` are hardcoded as inert `NOT_BUILT` labels. This means the bill register/manual edit-delete UI (§3.2), meter reading management screen (§3.3), staff master CRUD (§3.7 — the API exists, no consuming page does), and business settings/notification toggles/Tally export config (§3.9) don't exist on the web portal at all. These are core Section 3 features, not edge polish.

```
Use the backend-agent (owns apps/web-portal). Build out the four stub nav sections one vertical slice 
at a time, per CLAUDE.md's "work in vertical slices" rule — do these as separate commits/sessions, not 
one giant PR:
1. Billing register screen per docs/master-plan.md §3.2: bill list with the filters from finding A5 
   (date range, customer, DSM, payment type, vehicle number), bill detail view showing entry channel + 
   staff + timestamp, edit for Accountant+, delete for Owner-only (enforce role server-side, already 
   should be enforced in the API — verify).
2. Meter reading management screen per §3.3: view by shift/DSM/nozzle, manual entry fallback, surfacing 
   the variance flag.
3. Staff management screen per §3.7: staff master CRUD against the existing GET /staff endpoint (add 
   create/update endpoints if missing), attendance log view, shift assignment.
4. Settings screen per §3.9: business profile/GSTIN, notification toggles, Tally export configuration. 
   Skip backup/export data if no such endpoint exists yet — flag that as a separate gap rather than 
   building a fake button.
Implement each against the real backend API, not mocked data. Since Billing touches bill edit/delete 
(money-adjacent), flag that slice for human review before merge per CLAUDE.md.
```

### B2. No PWA implementation at all — HIGH
**Files:** `apps/web-portal/vite.config.ts` (7 lines, no `vite-plugin-pwa`), no `public/manifest.json`, no service worker.

Contradicts master plan §15.2 and the entire architectural premise of §1.2 ("dealer installs it on their phone home screen like an app... works offline for viewing cached data"). Currently a plain SPA with zero offline behavior.

```
Use the backend-agent (owns apps/web-portal). Add vite-plugin-pwa to apps/web-portal per 
docs/master-plan.md §15.2: configure a web app manifest (name, icons, theme color, standalone display 
mode), a service worker caching the app shell and static assets, and offline fallback behavior for 
already-fetched dashboard/report data (stale-while-revalidate is fine — this doesn't need to support 
offline writes, just offline viewing per the plan's wording). Add real app icons if placeholders don't 
already exist. Verify installability (Chrome's install prompt / Lighthouse PWA audit) after the change.
```

### B3. Gift catalog has no dealer-side CRUD — HIGH
**File:** `apps/web-portal/src/api/giftCatalog.ts` — only `getGiftRedemptionReport()` exists.

§3.5 requires the web portal to maintain the gift catalog (add/edit/remove gifts, set points cost, track stock). No create/update/delete call exists client-side, blocking Phase 4's gift-catalog feature from being usable by the dealer at all.

```
Use the backend-agent (owns apps/web-portal). Verify the backend has create/update/delete endpoints for 
GiftCatalogItem (check apps/backend/src/gift-catalog) — add them if missing, following the existing 
module patterns. Then build the dealer-side gift catalog management screen on the web portal per 
docs/master-plan.md §3.5 and §6.4: list existing gifts, add/edit a gift (name, image, points_required, 
stock_quantity, active_flag), and retire (not hard-delete, per the plan's explicit "retire without 
deleting redemption history" requirement) a gift. Enforce Owner/Accountant-only access consistent with 
other loyalty-config screens.
```

### B4. Zero frontend tests — HIGH
**Repo-wide:** no `*.test.tsx`/`*.spec.tsx`, no test runner in `package.json` devDependencies.

CLAUDE.md requires tests for rule-heavy logic; the web portal has none, despite rendering bill amounts, split-payment math, and cash custody figures.

```
Use the backend-agent (owns apps/web-portal). Add Vitest + React Testing Library to apps/web-portal. 
Write tests first for the money-rendering paths: BillFormModal (including split-payment line entry and 
balance validation display), any component showing cash custody totals, and the loyalty points 
banner/display components. Then add tests for the auth flow (login, 401 handling once finding B7 is 
fixed) and the customer edit form (covering the stale-seed issue in finding B8). Wire a `test` script 
into package.json and confirm it runs in CI once finding D2 is addressed.
```

### B5. Auth token in localStorage, no 401 handling, no error boundary — MEDIUM
**Files:** `apps/web-portal/src/api/client.ts:6-15`, `src/context/AuthContext.tsx`; no `ErrorBoundary` anywhere in `src/`.

Token is plain-`localStorage` (XSS-readable), and there's no interceptor for an expired JWT — a 401 just shows as a generic inline error instead of redirecting to login. Separately, no error boundary means any render exception white-screens the whole app.

```
Use the backend-agent (owns apps/web-portal). Two related fixes in apps/web-portal:
1. Add a response interceptor in src/api/client.ts that catches 401 responses globally, clears the 
   stored auth token, and redirects to /login instead of letting each page show a raw error.
2. Add a top-level React ErrorBoundary component wrapping the app's route tree, showing a recoverable 
   "something went wrong" screen with a reload action instead of a blank white screen on any unexpected 
   render error.
Leave the localStorage-vs-httpOnly-cookie token storage decision as a separate follow-up — note it as 
a known tradeoff in a code comment if you don't change it now, since fixing it properly requires backend 
cookie-setting changes too.
```

### B6. Role enforcement inconsistent across web-portal routes — MEDIUM
**File:** `apps/web-portal/src/components/layout/RequireAuth.tsx` (checks `isAuthenticated` only, never role).

`BillDetailPage.tsx` correctly gates edit/delete by role, but that pattern isn't applied route-wide — any logged-in staff account can navigate directly to `/loyalty`, `/credit-settings`, etc. regardless of role. The backend is the real enforcement boundary per CLAUDE.md, so this is a UX/defense-in-depth gap, not a security hole by itself — but it should still be fixed properly.

```
Use the backend-agent (owns apps/web-portal). Audit every route in apps/web-portal for role restrictions 
per docs/master-plan.md §2's access matrix, and extend RequireAuth.tsx (or add a RequireRole wrapper) to 
redirect/hide routes the current staff role shouldn't see — e.g. LoyaltySettingsPage, CreditSettingsPage, 
RateMasterPage should not be reachable by non-Owner/Accountant roles even by direct URL. Confirm this is 
UI-only defense-in-depth — verify (don't assume) that every one of these routes' underlying API calls 
already enforces the same role check server-side per CLAUDE.md's hard rule, and file a backend finding 
if any don't.
```

### B7. `loyaltyWarning` field never rendered — MEDIUM **[tracked in plan §17.14]**
**File:** `apps/web-portal/src/api/types.ts:83` declares the field; nothing reads it.

```
Use the backend-agent (owns apps/web-portal) to implement docs/master-plan.md §17.14: when POST /bills 
returns a loyaltyWarning (e.g. bill created despite no LoyaltyConfig existing), surface it as a visible 
banner/toast on the bill save confirmation in the web portal, not just a silently-dropped field. Apply 
the same treatment on the DSM app's equivalent bill-save flow if it has the same gap (check 
apps/dsm-app's bill save handling — coordinate with mobile-agent if that side needs the fix too).
```

### B8. Stale-seed customer edit form — MEDIUM **[tracked in plan §17.15, plan says fix-trigger is Person A/B split going active]**
**File:** `apps/web-portal/src/components/customers/CustomerFormModal.tsx:8-11`.

Already documented as an accepted tradeoff in the plan with an explicit fix trigger. Only act on this once two people are actually editing concurrently, per the plan's own guidance — listed here for completeness, not as something to fix blindly right now.

```
Only do this once docs/master-plan.md §16.1's Person A / Person B split is actually active (two people 
editing concurrently, not solo dev). At that point, use the backend-agent to make CustomerFormModal 
fetch a fresh GET /customers/:id on open instead of seeding from the in-memory list row, and add an 
updatedAt/version check on PATCH /customers/:id so a stale-form submit is rejected with a clear 
"this record changed, please refresh" error instead of silently overwriting concurrent edits.
```

---

## C. DSM App (`apps/dsm-app`)

### C1. No offline queue — BLOCKER
**File:** `apps/dsm-app/src/storage/sessionStorage.ts:4-7` (comment self-documents this is a token cache only).

No local SQLite/WatermelonDB anywhere. Meter readings and bills fail outright with no signal. The plan itself calls an app that can't work offline "a non-starter" for rural pump connectivity (§4) — this is exactly that state today.

```
Use the mobile-agent to implement offline-first bill/meter-reading entry in apps/dsm-app per 
docs/master-plan.md §15.3: add WatermelonDB (or an equivalent local SQLite queue) so New Bill and Meter 
Reading submissions are written locally first and queued for sync, with a background sync process that 
flushes the queue when connectivity returns. Handle sync conflicts/failures visibly (don't silently drop 
a failed sync) and show a clear "N entries pending sync" indicator, matching the offline-status UI already 
implied by the §14 mockup. This is a substantial feature — scope it as its own vertical slice per 
CLAUDE.md, starting with bill entry before extending to meter readings and cash handover.
```

### C2. No shift-end cash handover screen — HIGH
**File:** `apps/dsm-app/src/screens/LoggedInScreen.tsx:15-19` (comment marks it "later slice").

```
Use the mobile-agent to build the shift-end cash handover screen in apps/dsm-app per docs/master-plan.md 
§4 and §8, mirroring the web portal's Day-End entry: deposited to bank / kept in locker / taken home, 
with the same three-way-sum-must-equal-total-collected validation enforced (the backend should already 
enforce this per CLAUDE.md's hard rule for Section 8 — verify apps/backend/src/cash-custody does before 
building the UI against it, file a backend finding if it doesn't). This touches cash custody — flag for 
human review before merge per CLAUDE.md.
```

### C3. Bluetooth ESC/POS printing not implemented — HIGH
**File:** `apps/dsm-app/src/receipts/billReceipt.ts:41-43` (comment confirms it's PDF-share-sheet only via `expo-print`, no printer pairing).

Not a substitute for a physical receipt at the nozzle — customers expect a paper receipt handed over immediately (§4, §15.8).

```
This first needs a hardware decision: pick the actual Bluetooth thermal printer model (docs/master-plan.md 
§17.7 lists this as still undecided). Once chosen, use the mobile-agent to replace the PDF-share-sheet 
approach in apps/dsm-app/src/receipts/billReceipt.ts with real ESC/POS Bluetooth printing using a React 
Native Bluetooth printing SDK compatible with the chosen printer, per §15.8. Keep the existing receipt 
content/formatting logic, just change the output target from PDF-share to printer. Test against the 
actual physical printer before considering this done — this is a case where desk-testing can't fully 
validate the feature per §16.5.
```

### C4. Auth token stored in plaintext AsyncStorage — MEDIUM
**File:** `apps/dsm-app/src/storage/sessionStorage.ts:16-21`.

No encryption layer (no `expo-secure-store`/Keychain/Keystore). Relevant here specifically because DSM phones are realistically shared/handed-off staff devices, not personal phones.

```
Use the mobile-agent to replace apps/dsm-app/src/storage/sessionStorage.ts's AsyncStorage usage for the 
auth token with expo-secure-store (or equivalent Keychain/Keystore-backed storage), so the JWT isn't 
plaintext-readable from app storage on a rooted/jailbroken or shared device. Apply the same change to 
apps/customer-app/src/storage/customerSessionStorage.ts while in there (lower urgency there since it's 
typically a personal device, but same fix, same effort).
```

### C5. No app bundle identifiers configured — HIGH (build blocker)
**File:** `apps/dsm-app/app.json` — no `android.package`/`ios.bundleIdentifier`.

```
Use the mobile-agent to set real android.package and ios.bundleIdentifier values in apps/dsm-app/app.json 
(and apps/customer-app/app.json — same gap there, finding C-cross-1 below) using your actual reverse-domain 
identifiers (e.g. com.yourpumpname.dsmapp / com.yourpumpname.customerapp). This is required before any 
EAS or native build can produce a store-installable artifact — do this early since every other mobile 
fix is blocked from ever reaching a real device build without it.
```

### C6. No "view own shift summary" screen — MEDIUM
**File:** `apps/dsm-app/src/screens/LoggedInScreen.tsx:13-19`.

```
Use the mobile-agent to add a shift summary screen to apps/dsm-app per docs/master-plan.md §4: litres 
sold, cash collected, and bills entered for the current DSM's active shift only, sourced from existing 
bill/meter-reading endpoints filtered to the logged-in staffId and current shift. Read-only screen, no 
new backend logic expected unless the aggregation isn't already exposed by an existing endpoint.
```

### C7. Thin test coverage — MEDIUM
Only `creditCustomerConflict.test.ts` and `NewBillScreen.test.tsx` exist.

```
Use the mobile-agent to add tests for apps/dsm-app/src/screens/MeterReadingScreen.tsx, 
AddPaymentModal.tsx (the split-payment balancing UX from §5A — running remaining-amount ticker, 
cash-change prompt), billReceipt.ts (receipt content generation, including proper escaping of customer 
name/vehicle number in generated content), and error-path handling in authApi.ts/billsApi.ts/
meterReadingsApi.ts (network failure, 401, validation errors from the backend).
```

### C8. Product type is a hardcoded picker, not backed by a real master — LOW
**File:** `apps/dsm-app/src/screens/NewBillScreen.tsx:37-41` (comment acknowledges this is a stopgap).

```
Low priority — only act once apps/backend exposes a real Tank/product master endpoint (part of Section 7 
inventory work). Use the mobile-agent to replace the hardcoded 3-item product picker in NewBillScreen.tsx 
with a fetch against that endpoint once it exists. No action needed until the backend side is built.
```

### C9. No biometric login — LOW
**File:** `apps/dsm-app/src/screens/PinLoginScreen.tsx:17-24`.

PIN-only satisfies the plan's "PIN or biometric" wording — this is a nice-to-have, not a gap.

```
Optional. Use the mobile-agent to add biometric login (expo-local-authentication) as an alternative to 
PIN entry in apps/dsm-app/src/screens/PinLoginScreen.tsx, falling back to PIN if biometrics aren't 
available/enrolled on the device.
```

---

## D. Customer App (`apps/customer-app`)

### D1. No push notifications implemented — HIGH
**Repo-wide:** no `expo-notifications`/FCM dependency anywhere; only doc mentions, no actual wiring.

§5/§11 name push as the primary notification channel (bill confirmation, points earned) — currently zero implementation, not even a permission request stub.

```
Use the mobile-agent to implement push notifications in apps/customer-app per docs/master-plan.md §11 
and §15.7: integrate Firebase Cloud Messaging (expo-notifications + FCM setup), request notification 
permission on first login, register the device token with the backend (add a backend endpoint to store 
customer device tokens if one doesn't exist — coordinate with backend-agent), and handle at least the 
two notification types the plan calls out as primary: bill-added confirmation and points-earned. Backend 
side (actually sending the push on bill creation) is a separate slice — scope this task to the client-side 
registration/receiving plumbing first, then wire the backend trigger as a follow-up.
```

### D2. No bundle identifiers configured — HIGH (build blocker)
**File:** `apps/customer-app/app.json`.

Same issue as C5 — covered by that prompt (it explicitly includes both apps).

### D3. Default/template app icons and splash screen — LOW
**Files:** `apps/customer-app/assets/icon.png`, `apps/customer-app/assets/splash-icon.png` — unmodified Expo template defaults.

```
Use the mobile-agent to replace apps/customer-app/assets/icon.png and splash-icon.png (and the same 
files in apps/dsm-app if also still default) with real pump-branded artwork before any store listing 
or real user-facing release. This needs actual brand assets supplied by you — flag back if none exist yet.
```

### D4. Only one test file in the whole app — MEDIUM
**File:** `apps/customer-app/src/lib/customerPortalFormat.test.ts` is the only one.

```
Use the mobile-agent to add tests for apps/customer-app's core screens: HomeScreen (points/dues display 
logic), BillHistoryScreen, GiftCatalogScreen (affordable-vs-locked gift logic per §6.4), the OTP login 
flow (OtpEntryScreen/PhoneEntryScreen including resend/lockout behavior once backend throttling from 
finding A2's pattern is confirmed present on customer-auth), and the API client's error-path handling.
```

### D5–D6. Confirmed correctly deferred, not bugs — informational only
"Pay Now" is confirmed still a clean placeholder message (§17.17), and QR self-service card linking is confirmed absent with no half-built code (§17.18). No prompt needed here beyond what the plan already tracks — see items E1/E2 below for the actual spec/implementation prompts once those features are greenlit.

---

## E. Deferred plan items worth prompts now (not new findings, but ready to action)

### E1. "Pay Now" spec + implementation **[tracked in plan §17.17]**
```
This needs a product decision first, not code: decide UPI deep-link (no gateway needed) vs. hosted 
checkout (Razorpay/Cashfree-style, needs webhook reconciliation + refund handling) per 
docs/master-plan.md §17.17. Once decided, write a short spec addition to master-plan.md Section 5 
covering the exact flow and how a successful payment reconciles against Customer.outstandingBalance 
(new Payment row, written by webhook and/or client callback, with idempotency). Only then hand this to 
backend-agent (for the reconciliation endpoint) and mobile-agent (for the customer-app "Pay Now" button) 
as two coordinated implementation tasks. This is money-touching — mandatory human review before merge 
per CLAUDE.md.
```

### E2. QR self-service card linking **[tracked in plan §17.18]**
```
Use the backend-agent to add a POST /customer-portal/link-card (or similar) endpoint per 
docs/master-plan.md §17.18: customer submits the member ID printed on their physical card, server 
confirms it matches req.user.customerId's own qrMemberId (never trust a client-supplied customerId — 
this is purely a self-confirmation, not a free-floating association), reject if the ID belongs to a 
different customer or doesn't exist. Then use the mobile-agent to wire the "Link your physical QR loyalty 
card" banner on apps/customer-app's HomeScreen to this endpoint.
```

### E3. DPDP Act consent capture + data deletion **[tracked in plan §17.11/§18.1]** — BLOCKER before real customer data
```
Use the backend-agent to add: (1) a consent-capture step at customer signup (apps/backend/src/customers 
or customer-auth — a boolean + timestamp field on Customer recording consent to data processing, surfaced 
as a checkbox/notice on whichever flow first collects a real customer's phone number), and (2) a 
data-deletion endpoint (Owner/Accountant-triggered, or customer-self-service via customer-portal) that 
either hard-deletes or anonymizes a Customer's PII on request while preserving whatever financial/audit 
records legally need to survive (check with an actual advisor on India's DPDP Act retention requirements 
before deciding delete-vs-anonymize — don't guess on a compliance question). This blocks §18.1's go-live 
checklist and must be resolved before Phase 3 collects real customer data per CLAUDE.md's known-gaps section.
```

---

## F. Cross-cutting / Infra (repo root, CI, deployment, shared packages)

### F1. README.md is badly stale — HIGH
**File:** `README.md:44-46` — describes `apps/*` as empty placeholders; in reality there are ~25 built backend modules and real web-portal pages.

```
Rewrite README.md to reflect actual current repo state: list what's actually built in each app (don't 
re-describe features from scratch — link to docs/master-plan.md sections per CLAUDE.md's own convention), 
give real run instructions per app (backend: npm run start:dev in apps/backend; web-portal: its dev 
command; dsm-app/customer-app: Expo run commands), and explain the Supabase-only DB setup (no Docker) 
per CLAUDE.md. Add short per-app README.md files if apps/*/README.md are referenced but don't exist yet.
```

### F2. CI runs no tests and no linting — HIGH
**File:** `.github/workflows/ci.yml:38-41` (lint/test steps commented out).

CI currently only validates the Prisma schema and runs migrations — it passes even if the backend fails to build or its (currently strong, 346-test) suite is red.

```
Uncomment and fix the lint/test steps in .github/workflows/ci.yml so CI actually runs `npm run build` 
and `npm test` for apps/backend (which has real tests today) and apps/web-portal (once finding B4 adds 
a test suite there), and lint for whichever apps have an eslint config. Confirm the workflow goes red on 
a deliberately broken test locally before considering this done — a CI step that silently no-ops is worse 
than no step.
```

### F3. No deployment configuration exists anywhere — BLOCKER
**Repo-wide:** no Dockerfile (see A8), no `vercel.json`/`netlify.toml`, no `eas.json`.

```
Three separate, coordinated tasks once hosting targets are actually chosen (docs/master-plan.md §15.1/§15.2 
name DigitalOcean/Hetzner + Vercel/Netlify as intended, but confirm this is still the plan before building 
against it):
1. backend-agent: use the Dockerfile from finding A8, add whatever the chosen host needs (a deploy script, 
   a Procfile, or CI deploy step).
2. backend-agent: add a vercel.json or netlify.toml for apps/web-portal with the correct build command/output 
   directory for a Vite app in a monorepo subfolder.
3. mobile-agent: add eas.json to apps/dsm-app and apps/customer-app configuring build profiles 
   (development/preview/production) for EAS Build, once Google Play Developer / Apple Developer accounts 
   exist per CLAUDE.md's known-gaps section (confirm they do first — this is listed as needed "before 
   Phase 2 build starts").
```

### F4. Production hosting not actually confirmed — BLOCKER **[tracked in plan §18.1]**
Supabase's free tier auto-pauses after 7 days of inactivity and has no automated backups — not appropriate for a system holding real customer credit balances and loyalty points.

```
This is a decision + account-setup task, not a coding task: confirm (or set up) a paid Supabase tier 
with automated backups enabled, or migrate to a managed Postgres provider with backups, before any real 
customer data goes into this system. Document the chosen backup schedule and a tested restore procedure — 
an untested backup is not a backup. Update docs/master-plan.md §18.1 to check this item off only once 
verified, not just configured.
```

### F5. `packages/shared-types` and `packages/ui-components` are empty scaffolding, unused — MEDIUM
**File:** `packages/shared-types/README.md` literally says "Not yet scaffolded"; no app imports from either package.

```
Use the backend-agent to scaffold packages/shared-types with real TypeScript types for the core API 
contracts (Bill, Customer, LoyaltyConfig, BillPaymentLine, ShiftSalesSummary, etc. — mirror 
prisma/schema.prisma's shape for the fields exposed over the API) and update apps/web-portal to import 
from this package instead of maintaining its own local copy in src/api/types.ts. Then have mobile-agent 
do the same for apps/dsm-app and apps/customer-app's local type definitions. This is worth doing now, 
before mobile-agent work ramps up per CLAUDE.md's team-split note, since it's the mechanism that prevents 
a backend DTO change from silently breaking a frontend with no compile-time signal.
```

### F6. `docker-compose.yml` contradicts CLAUDE.md's Supabase-only rule — MEDIUM
**File:** `docker-compose.yml` still defines a local Postgres service.

```
Either delete docker-compose.yml entirely (Postgres is Supabase-hosted per CLAUDE.md, and nothing else 
in the repo currently needs Docker Compose), or if it's kept for some other reason, add a comment header 
at the top explicitly stating it is NOT used for the database and pointing to CLAUDE.md's Supabase setup 
instructions, so a new contributor or a fresh Claude Code session doesn't run `docker compose up` and 
stand up a second, divergent database.
```

### F7. No monitoring/observability wired up — HIGH **[tracked in CLAUDE.md known gaps]**
Covered by backend finding A11 — same fix, listed here for visibility at the infra level since it affects incident response for the whole system, not just backend code quality.

### F8. Stray files at repo root — LOW
`WhatsApp Image 2026-07-16 at 10.07.04 PM.jpeg` (94KB, tracked in git) and `diff_err.log` (untracked, benign Prisma warning).

```
Move WhatsApp Image 2026-07-16 at 10.07.04 PM.jpeg into docs/ if it's a real design reference worth 
keeping (rename it something descriptive), otherwise remove it from git. Delete diff_err.log locally — 
it's already gitignored via *.log so this is just local cleanup, not a commit.
```

---

## G. Items already correctly closed — no action needed

Verified during this audit, listed so you don't re-spend time checking them:

- **React 18/19 version conflict (§18.1):** resolved — `web-portal`, `dsm-app`, `customer-app` all pin `react@19.2.3` consistently in `package-lock.json`. Update §18.1 in the plan to check this off.
- **Split-payment balancing (§5A):** correctly enforced server-side with epsilon-safe float comparison, not just a disabled Save button.
- **UPI webhook idempotency:** correctly implemented and transactional (only the signature *algorithm* needs work — see A3).
- **Rate resolution on bills:** correctly server-authoritative from `RateHistory`, not client-trusted (§7.4 compliance).
- **CORS:** env-driven, fails closed (empty allowlist) if unconfigured — not wildcard.
- **Credit-customer QR-conflict bug (§17.20/§17.21):** verified fixed — `hasCreditCustomerConflict()` exists and is correctly wired into `NewBillScreen.tsx`.
- **Secrets hygiene:** `.env` confirmed never committed; `.env.example` files are comprehensive and well-documented.
- **Backend test coverage for rule-heavy logic:** genuinely strong — 39 suites / 346 tests, covering loyalty calc, split-payment balancing, cash-custody carry-forward, webhook idempotency, credit-aging, variance flagging, exactly as CLAUDE.md requires.
- **Money-sensitive backend writes:** correctly wrapped in `$transaction` (bill create/update/remove, UPI webhook processing).
- **Node engine versions:** consistent (`>=22`) across root config and CI.

---

## Suggested order of operations

1. **Blockers first, backend before frontend:** A1 → A2 → A4 (loyalty reversal) → A3 (once provider chosen) — these are the ones that could actually lose you money or misattribute financial actions.
2. **Unblock mobile builds immediately:** C5/D2 (bundle identifiers) — five-minute fix, unblocks everything else on mobile.
3. **Close the web-portal feature gap:** B1 — without this, the accountant/owner literally cannot use a third of the product from the web.
4. **DSM offline queue (C1):** the plan calls this a hard requirement, not optional — budget real time for it, it's the largest single item here.
5. **Infra/deploy (F3/F4):** needed before anything in this list matters for a real launch, but can run in parallel with the above once hosting decisions are made.
6. **Compliance (E3):** must land before Phase 3 collects real customer phone numbers, per CLAUDE.md.
7. Everything else (tests, monitoring, indexes, PWA, polish) — steady background work, not launch-blocking individually, but don't defer all of them past launch either.
