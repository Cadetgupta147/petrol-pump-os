# Team Handoff — Petrol Pump Management Software

**Written:** 2026-08-04, for the transition from a 2-person team to a 4-person team.
**Purpose:** give the two new people everything they need to get oriented — what this product is, who it's for, what problem it solves, what's been built, what's left, the tech stack, and how this team works with Claude Code. Read this once, fully, before touching code.

This document is a *summary with pointers*. The actual source of truth for feature behavior is [`docs/master-plan.md`](master-plan.md) (1,043 lines) — this handoff tells you what exists and where to look, it doesn't restate every rule. When you need the exact spec for a feature, go read the section number cited.

---

## 1. What this product is, in one paragraph

Petrol Pump OS is management software for an Indian fuel station (petrol pump): one backend + database, three front-ends — a web portal for the owner/accountant, a mobile app for the field staff who bill customers at the nozzle, and a mobile app for loyalty/credit customers. It replaces the paper-register-and-Excel workflow most independent Indian pumps still run on: billing, credit ledgers, meter readings, tank stock, cash reconciliation, staff attendance, a loyalty/points program, and accounting exports to Tally.

It is being **built and dogfooded on the founder's own real pump first** (see `docs/master-plan.md` §16, §16.5) — not built speculatively for a market that doesn't exist yet. That matters for how you prioritize: correctness and reliability for one real, currently-operating pump come before generalizing for a hypothetical hundred pumps.

## 2. The problem we're solving

Independent Indian petrol pumps (not the OMC-owned outlets — dealer-owned pumps running an IOCL/BPCL/HPCL franchise) mostly run on paper registers, WhatsApp, and Excel today. That causes specific, recurring failures this product targets directly:

- **Credit leakage.** Fleet/transport company customers run a running tab. Without a live ledger, "who owes how much, since when" is tracked in a notebook — this is the single most common way small pumps silently bleed money (§3.4).
- **Fuel pilferage / measurement drift going unnoticed.** Nobody is cross-checking "litres the meter says left the tank" against "litres actually billed" on an ongoing basis — this product makes that cross-check automatic and flags variance instead of requiring someone to go looking for it (§3.3, §7.2, §8A).
- **Cash going missing between the till and the bank.** Cash gets deposited, kept in a locker, or taken home by the owner/manager — and the "taken home" bucket is where money quietly disappears from tracking if there's no running custody balance (§8).
- **No loyalty/retention mechanism.** Competing on price alone is a race to the bottom for an independent dealer; a working points/rewards program is a real differentiator but is operationally hard to run on paper (§6).
- **Double-entry busywork for the accountant.** Every serious pump accountant already works in Tally for GST/VAT filing. Software that doesn't export to Tally creates double data entry and accountants resist adopting it (§10).
- **OMC compliance exposure.** IOCL/BPCL/HPCL audits check fuel quality logs (density/PPM) and stock records — a system with no quality log or purchase audit trail is a liability at audit time (§7.3, §9).

None of this is hypothetical "what a pump might want" — it's what this specific founder's own pump operations surfaced as real, current pain, which is why the feature list is opinionated rather than a generic ERP feature checklist.

## 3. Who this is for (target customer)

**Primary, right now:** the founder's own petrol pump — one dealer-owned, OMC-franchised fuel station in India. This is the only live deployment today.

**Intended market, if/when this becomes a product for others:** independent Indian petrol pump dealers/owners running a franchise under IOCL, BPCL, HPCL, or a similar OMC — typically a small business (family-run or a handful of trusted staff), not a large fuel-retail chain. The user roles this system is built around (§2) map directly onto how these businesses are actually staffed:

| Role | Who this really is at a typical pump |
|---|---|
| Owner/Dealer | The pump's franchise owner — often hands-on, checking the dashboard from their phone between other work |
| Accountant | A bookkeeper/accountant, often part-time or shared across several small local businesses, working in Tally |
| Manager | A trusted on-site staff member running day-to-day ops when the owner isn't there |
| DSM/Cashier | Field staff physically standing at the nozzle, billing customers — "DSM" = Dispensing/Sales/... staff, the person with their hand on the nozzle |
| Read-only | An investor, family member, or auditor who wants visibility without edit rights |

Multi-tenancy (multiple independent pumps on one deployment, each fully data-isolated) is **already built**, not aspirational — see §9 below and `docs/multi-tenancy-plan.md`. So "sell this to other dealers later" is an architecturally live path, even though today there's exactly one real tenant.

**Not the target customer:** OMC corporate-owned-and-operated outlets (different operating model entirely), large fuel retail chains with existing enterprise ERP, or anything outside India (the entire design — UPI, GST/VAT split, Tally, WhatsApp notification norms, OMC density-audit compliance — is India-specific and not meant to generalize elsewhere without real rework).

## 4. System architecture

**One NestJS backend + one Postgres database (hosted on Supabase — no local/Docker DB), three front-ends reading/writing the same API.**

| Front-end | Who uses it | Built as | Primary device |
|---|---|---|---|
| Web Portal | Owner (mobile) + Accountant/Manager (desktop) | One responsive React + Vite PWA | Phone (owner) / desktop browser (accountant) |
| DSM App | Field staff at the nozzle | React Native (Expo), offline-first | Phone |
| Customer App | Loyalty/credit customers | React Native (Expo) | Phone |

**Why one web portal instead of separate "dealer app" and "accountant portal":** the difference between what the owner sees and what the accountant sees is a *permissions and layout* problem, not a different product — it's one React codebase, PWA-installable, responsive from phone to desktop, with visibility/edit rights controlled entirely by role (§1.2, §2). This was a deliberate decision to avoid doubling frontend work across a small team — keep it that way; don't let "the owner wants X differently" turn into a fork of the codebase.

A meter reading entered on a DSM's phone shows up instantly on the owner's phone and the accountant's desktop — every front-end is a different view into the same backend truth, nothing is computed twice in two places (§1.3).

## 5. Tech stack (actual, as currently installed — not just the plan's recommendation)

| Layer | Choice | Notes |
|---|---|---|
| Backend framework | NestJS 11 | Modules/controllers/services structure — see `apps/backend/src/` (47 feature modules) |
| Database | PostgreSQL, hosted on **Supabase** | No local/Docker Postgres — see CLAUDE.md. Pooled connection (PgBouncer, port 6543) for the app, direct connection (port 5432) for migrations |
| ORM | Prisma 6 (`@prisma/client` ^6.19.3) | `prisma/schema.prisma` is the single schema source of truth — **50 models**. Never hand-edit the DB schema; always `prisma migrate dev` |
| Auth | `@nestjs/passport` + `passport-jwt`, bcrypt | Two separate JWT secrets: `JWT_SECRET` (staff — web portal + DSM app) and `CUSTOMER_JWT_SECRET` (customer app, phone+OTP) — deliberately different so tokens can never cross-validate |
| Security middleware | `helmet`, `@nestjs/throttler` | Rate limiting on login/OTP; see `docs/security-notes.md` for known gap (in-memory throttler storage — fine for one instance, must move to Redis before horizontal scaling) |
| Secrets at rest | AES-256-GCM via `CREDENTIAL_ENCRYPTION_KEY` | Encrypts dealer-supplied UPI webhook credentials stored in `UpiCaptureConfig` |
| Web portal | React 19 + Vite, `react-router-dom`, `recharts`, `lucide-react` | PWA via `vite-plugin-pwa` (installable, offline shell caching) |
| Mobile apps | React Native 0.86 via Expo 57 (DSM app + Customer app) | `expo-camera` (QR scan), `expo-print`/`expo-sharing` (Bluetooth receipt printing / PDF), `@react-native-async-storage/async-storage` (offline queue) |
| OCR | **Google Cloud Vision API, `DOCUMENT_TEXT_DETECTION`** | Resolved choice — not Document AI/Form Parser. Plain text detection + regex parsing is enough for printed supplier invoices; keeps costs on Vision's ~$1.50/1,000-page tier. See CLAUDE.md. |
| UPI capture | PhonePe/Paytm Business **merchant webhook** (`paytmchecksum` dep present) | Free, real-time notification when money lands on the existing merchant QR — not a payment gateway. Provider still not finalized (open item, §17.8-adjacent) |
| Tally export | Server-generated Tally XML voucher format | `TALLY_EXPORT_MODE=file` is the current default (vs. a direct API push) |
| QR codes | `qrcode` npm package, server-side generation | Encodes only a customer ID pointer — never balance/rate (§6.1) |
| Notifications | Firebase Cloud Messaging (push, planned), SMS gateway (planned), WhatsApp Business API (planned) | **Not yet wired in** — see gaps section below |
| CI | GitHub Actions | `prisma validate` + `prisma migrate deploy` run; actual test suite step is currently commented out (known gap, see `docs/security-notes.md`) |
| Hosting | Not yet finalized for production | Backend dev runs locally against Supabase; web portal has a `.vercel/` config present |

## 6. Repo layout

```
petrol-pump-os/
├── apps/
│   ├── backend/        NestJS API — owns all business logic + the DB (47 modules under src/)
│   ├── web-portal/     React + Vite PWA — owner (mobile) + accountant/manager (desktop)
│   ├── dsm-app/        React Native (Expo) — field staff, offline-first
│   └── customer-app/   React Native (Expo) — loyalty/credit customers
├── packages/
│   ├── shared-types/   Intended cross-app TypeScript types — STILL AN EMPTY PLACEHOLDER (see §11 below)
│   └── ui-components/  Intended shared React components — STILL AN EMPTY PLACEHOLDER
├── docs/
│   ├── master-plan.md            Full feature spec, source of truth — reference by section number
│   ├── multi-tenancy-plan.md     How multi-pump support was retrofitted (already done, see §9)
│   ├── production-readiness.md   Point-in-time (2026-07-22) security/go-live audit — treat as a lead, verify against code
│   ├── security-notes.md         Deliberately-accepted security tradeoffs + what would un-accept them
│   ├── ledger-accounting-review.md  Deep dive on the double-entry ledger implementation
│   ├── execution_playbook.md     Original slice-by-slice build playbook
│   └── *.svg                     UI/UX wireframes referenced from master-plan.md §14
├── prisma/
│   ├── schema.prisma    50 models — the DB schema source of truth
│   └── provision-pump.cts   Manual pump provisioning script (multi-tenancy onboarding)
├── CLAUDE.md            Ground rules for working with Claude Code in this repo — READ THIS
└── README.md            Quickstart + current build status
```

## 7. What's actually built (verified against code, not just the plan)

Per the README's own status line and cross-checked against `git log` (121 commits) and the module list under `apps/backend/src/`: **Phases 1–6 of the master plan's roadmap (§16.4) are built, not just started.** This is a working app, live at a real pump — past the scaffold stage.

Concretely, these are real, working features (not stubs) — cite the section number for exact behavior:

- **Billing & payments** — manual + DSM-app bill entry, itemized bills with line items, **split payments across cash/card/UPI/credit that must balance server-side** (§5A), per-pump sequential bill numbering, bill audit log (who entered/edited what, from which channel) (§3.2, §5A)
- **Meter readings** — batch-close-all-nozzles flow, shift-schedule labeling, meter rollover handling, server-derived (never client-typed) opening readings, DB-level single-open-shift guarantee, backdating for corrections, litres-sold variance flagging against billed litres (§3.3, §3.3.1–3.3.3)
- **Item Master & Nozzle Master** — dealer-configured product catalog and nozzle registry, replacing free-text product fields (§3.3.1, §3.3.2)
- **Credit customers** — full ledger, informal walk-in quick-add (`informal`/`verified` flag), dealer-configurable enforcement mode (`NOTIFY` vs `BLOCK`), default informal credit limit, opening balances, credit aging report (FIFO allocation), printable outstanding statement with letterhead (§3.4, §3.4A, §5B, §12)
- **Vehicle/company blacklist** — hard credit-block by vehicle number or company name, independent of credit-limit headroom, Owner-only create/resolve, DSM-app pre-check (§3.4B)
- **Loyalty program** — QR-pointer customer identity, rupee/litre earning basis with per-customer override, cash-discount and gift-catalog redemption levers, dealer-controlled or customer-choice redemption mode, points transaction log (§6)
- **Inventory** — tank stock, purchase entry (manual + OCR-assisted via Google Cloud Vision), stock variance report, Rate Master (date-wise fuel pricing), density/PPM quality log, lubricant items with SKU/cost/sale price, generic `ItemSale` for lubricant/Urea-DEF sales, generator diesel usage log, machine testing/calibration log (§7, §7.1–7.5, §9)
- **Day-end cash reconciliation & custody** — deposited/locker/taken-home split with server-enforced sum validation, next-day carry-forward tracking, cash custody report (§8)
- **Walk-in sales & UPI automation** — `ShiftSalesSummary` aggregate tracking for non-itemized walk-in sales, automated UPI capture via PhonePe/Paytm Business webhook (idempotent, signature-verified) (§8A)
- **Accounting internals** — a full **Tally-shaped double-entry ledger** behind the scenes: `LedgerAccount`/`Voucher`/`VoucherLine` posted automatically from bills, expenses, cash custody, and credit repayments (`LedgerPostingService`) — this vocabulary (ledger, voucher, Dr/Cr) never surfaces in DSM/customer-facing UI, only in backend/accountant-facing views (§12, CLAUDE.md, `docs/ledger-accounting-review.md`)
- **Tally export** — XML voucher export, trial balance, exportable per the accountant's workflow (§10)
- **Staff management** — staff master, roles, attendance (clock-in/out), escalating login lockout + manual unlock, wage/advance tracking (§3.7, §17.23 — since resolved)
- **DPDP Act scaffolding** — consent/compliance groundwork for customer data handling (§17.11 — since addressed, verify current state before assuming fully closed)
- **Reports** — nozzle-wise and vehicle-wise sales, credit aging, blacklist log, and more per §12's list
- **Security hardening** — helmet headers, global exception filter, JWT algorithm pinning, session/token revocation (`tokenVersion`), staff login rate limiting + lockout, PII exposure reduction in customer lists/logs, Supabase PostgREST RLS deny-by-default lockdown (closed a real anon-key data-exposure hole — see `docs/security-notes.md`), amount-vs-litres×rate tolerance validation on bills
- **Offline support (DSM app)** — offline bill queue with idempotent sync (§4)
- **DSM app receipt printing** — via `expo-print`/`expo-sharing`

### 7.1 Multi-tenancy — already retrofitted, not a future concern

The system now supports multiple independent pumps on one deployment, each fully data-isolated by a `Pump` row and `pumpId` scoping across every tenant table (flipped from nullable to required repo-wide). Actor identity (which staff member is doing what) is derived **server-side from the JWT, never trusted from client-supplied `staffId`** — a real security fix, not just plumbing. See `docs/multi-tenancy-plan.md` for the full retrofit story and `prisma/provision-pump.cts` for how a new pump gets onboarded today (manual script, not yet a self-serve flow).

## 7A. The three front-ends, screen by screen

The section above lists features by backend capability. This is the same information from the other direction — what actually exists in each app's UI right now, verified against the real files in each app's `src/` folder, not the plan's aspirational screen list.

### Web Portal (`apps/web-portal/src/pages/` — 29 pages)

One React + Vite PWA, role-gated (`RequireAuth.tsx` + role checks), same codebase for the owner on mobile and the accountant on desktop (§1.2).

| Area | Pages |
|---|---|
| Auth | `LoginPage` |
| Home | `DashboardPage` — the "should I worry about anything today" screen, §3.1 |
| Billing | `BillingRegisterPage` (filterable bill list), `BillDetailPage` (single bill + audit trail) |
| Meter readings | `MeterReadingsPage` |
| Credit & customers | `CustomersPage`, `CustomerLedgerPage`, `CreditSettingsPage` (enforcement mode, §3.4A), `CreditStatementPage` (printable letterhead statement, §5B), `VehicleBlacklistPage` (§3.4B) |
| Loyalty | `LoyaltySettingsPage` (earning basis, redemption config, gift catalog — §6) |
| Inventory | `TanksPage`, `PurchaseEntryPage` (manual + OCR, §9), `VarianceReportPage`, `RateMasterPage` (§7.4), `DensityRangeSettingsPage` (§7.3), `GeneratorDieselPage`, `MachineTestingPage`, `ItemSalesPage` (lubricant/Urea sales, §7.5) |
| Cash custody | `CashCustodyPage` (day-end entry, §8), `CashCustodyStatusPage` |
| Accounting (Tally-shaped internals, §12/CLAUDE.md) | `DayBookPage`, `LedgerAccountsPage`, `VoucherEntryPage`, `TrialBalancePage`, `TaxRateSettingsPage` — accountant/owner-facing only, this vocabulary never leaks into DSM/customer screens |
| Staff | `StaffPage` (master + attendance, §3.7) |
| Money out | `ExpensesPage` |
| Reports | `ReportsPage` — the §12 report suite |
| Settings | `SettingsPage` (business profile, roles, Tally export config, §3.9), `UpiCaptureSettingsPage` (PhonePe/Paytm webhook credentials, §8A.3) |

Supporting component folders under `src/components/`: `bills/`, `customers/`, `dashboard/`, `meterReadings/`, `reports/`, `settings/`, `staff/`, `vehicleBlacklist/`, `layout/`, `common/`.

### DSM App (`apps/dsm-app/src/screens/`)

React Native/Expo, offline-first, PIN login — the field-staff app at the nozzle (§4).

| Screen | What it does |
|---|---|
| `PinLoginScreen` | PIN-based staff login (biometric not yet built — plan mentions it as an option, §4) |
| `LoggedInScreen` | Post-login shell/home for the DSM |
| `NewBillScreen` (+ `AddPaymentModal`, `ScanCustomerModal`, `CreditCustomerPicker`) | The core transaction screen — QR scan, manual entry, split-payment "Add Payment" flow with the remaining-amount ticker (§5A), vehicle blacklist pre-check (§3.4B) |
| `MeterReadingScreen` | Batch-close-all-nozzles flow (§3.3, §3.3.1) |
| `ShiftSalesSummaryScreen` | Walk-in aggregate shift totals (§8A) |
| `AttendanceScreen` | Clock-in/out, self-service attendance status |

Non-screen logic worth knowing about: `creditCustomerConflict.ts` — the fix for the QR-scan-after-credit-picker reattribution bug (master-plan §17.20), a good example of the "ID vs. display-copy drift" pattern (§17.21) to watch for elsewhere. Notably, this app has **real test coverage on its rule-heavy screens** — `NewBillScreen.test.tsx`, `MeterReadingScreen.test.tsx`, `ShiftSalesSummaryScreen.test.tsx`, `AttendanceScreen.test.tsx`, `LoggedInScreen.test.tsx`, `creditCustomerConflict.test.ts` — exactly the kind of money/credit-logic tests CLAUDE.md asks for. Look here as the reference pattern when adding tests elsewhere.

### Customer App (`apps/customer-app/src/screens/`)

React Native/Expo, phone + OTP login — the loyalty/credit customer app (§5).

| Screen | What it does |
|---|---|
| `PhoneEntryScreen`, `OtpEntryScreen` | Phone number + OTP login (§5) — OTP delivery is currently console-logged only in dev, no SMS provider wired in yet |
| `CustomerPortalShell` | Post-login navigation shell |
| `HomeScreen` | Points balance, outstanding dues, "Pay Now" (currently a placeholder — §17.17, no payment flow spec yet) |
| `BillHistoryScreen` | Itemized bill history — shows product type + litres, not a nozzle number (§17.16, a known minor gap) |
| `GiftCatalogScreen` | Browse/redeem gifts, locked/unlocked by points balance (§6.4) |

Notably thin compared to the other two apps — this tracks with the plan: push/SMS/WhatsApp notifications (§11) and QR self-service card linking (§17.18) are specced but not built, and "Pay Now" is explicitly a placeholder pending a payment-gateway decision.

## 8. What's explicitly NOT built yet, or is a placeholder

Read `CLAUDE.md`'s "Open items not yet decided" and "Known gaps to close" sections directly — that's the maintained, current list, don't let this handoff go stale as a duplicate of it. As of this writing, the key open items are:

- **Payment gateway for the customer app's in-app "Pay Now"** — not chosen, and per master-plan §17.17, the flow itself was never fully specced (UPI deep-link vs. hosted checkout, reconciliation mechanism). The customer app currently ships a "coming soon" placeholder on this button. **Needs its own spec subsection before anyone builds against it.**
- **PhonePe vs. Paytm Business** as the specific UPI webhook provider — mechanism is decided (§8A.3), provider isn't
- **Loyalty earning basis default** (rupee vs. litre) and default rate — not fixed yet, dealer-configurable either way
- **Redemption type at launch** (cash-only / gift-only / both) — not fixed
- **WhatsApp Business API provider** — not chosen (Gupshup / Interakt / direct Meta API)
- **Receipt printer hardware model** — not settled
- **Push/SMS notifications** — env vars exist (Firebase, SMS gateway) but are not wired to a live provider; OTP currently only logs to the server console in dev (`console-otp-provider.ts`)
- **`packages/shared-types` and `packages/ui-components`** — still empty placeholders. Each app currently duplicates its own local type definitions (e.g. `Bill`) instead of importing a shared one. A real dedup pass hasn't happened.
- **Bill edit/delete does not reverse loyalty points** (§17.13) — a real, tracked bug: editing or soft-deleting a bill after points were credited leaves the original points on the customer's balance. Flagged as a go-live hard blocker (§18.1).
- **GST/VAT tax modeling** — the "GST-ready" report is a plain register, not real tax-rate-aware reporting; fuel is VAT-taxed in India (state-level), not GST, and this isn't properly modeled yet (§17.22)
- **QR self-service card linking** — customer app has no endpoint yet for a customer to link their account to their physical QR card (§17.18)
- **Density/PPM compliance thresholds are placeholders** — not sourced from real OMC published specs yet (§17.19)
- **Error monitoring (Sentry)** — not wired in; `.env.example` has a placeholder only
- **Test suite in CI** — commented out; tests exist locally (`npm run test:integration` etc.) but don't gate PRs yet
- **Production hosting** — not finalized; Supabase free tier pauses after 7 days idle and has no automated backups, explicitly called out as unfit for real customer data at scale (§18.1)
- **Dogfooding period** — per §18.3, running the system in parallel with the manual process for 2–4 weeks was **not started as of the checklist's creation (2026-07-21)**. Confirm current status before assuming this has happened.

Full, authoritative list: `docs/master-plan.md` §17 (Open Decisions/Risks) and §18 (Go-Live Readiness Checklist) — §18.1 specifically is "hard blockers, do not take real customer money/data until resolved."

## 9. Hard rules — do not violate these (from CLAUDE.md, condensed; read the real file)

- **Never hand-edit the DB schema.** Prisma migrations only (`prisma migrate dev`).
- **Never trust the frontend for permission checks.** Every role check is enforced server-side, on every endpoint, regardless of what the UI hides.
- **Never commit secrets.** `.env` is gitignored; new credentials get a placeholder in `.env.example` in the same commit. (Verified: no secret has ever been committed across this repo's full history, per README §Secrets.)
- **Work in vertical slices.** One feature = DB table → API endpoint → UI screen, built and committed together — not "all tables, then all endpoints, then all screens."
- **Commit after every working slice**, not at the end of a session.
- **Anything touching money or points is human-reviewed before merge.** Bill amounts, split-payment lines, loyalty point calculation, cash custody, redemption logic, the payment flow. No auto-merge on this code, ever, whether human- or agent-written.
- **Split payments must balance server-side** — `sum(IN) − sum(OUT) = bill.amount`, enforced in the API (§5A).
- **Webhook handlers must be idempotent and signature-verified** — the UPI webhook can arrive late, out of order, or duplicated; dedupe on `providerEventId`.
- **Write tests for rule-heavy logic**: loyalty points, cash reconciliation, stock variance, split-payment balancing, webhook idempotency.
- **Accounting internals are Tally-shaped; the UI is not.** Ledger/voucher/Dr-Cr vocabulary stays out of DSM/customer-facing screens — those stay plain business actions ("Add Bill," "Record Payment"). The backend translates.

## 10. How this team works with Claude Code

- Each specialist has their own Pro subscription and runs their own Claude Code session — **don't run two agents in parallel on one account**, it burns a single 5-hour usage window twice as fast.
- Two custom subagents already exist in `.claude/agents/`:
  - **`backend-agent`** — owns `apps/backend`, `apps/web-portal`, `prisma/`
  - **`mobile-agent`** — owns `apps/dsm-app`, `apps/customer-app`
- Reference `docs/master-plan.md` **by section number** in prompts ("implement Section 6.4 exactly as specced") rather than re-describing a feature from scratch — this is how the whole repo's history was built and it keeps everyone's mental model in sync with one document instead of drifting.
- If a prompt conflicts with the master plan, **flag the conflict, don't silently pick one.**

## 11. Suggested team split for 4 people (this is a proposal, not a decision — confirm with the founder)

The master plan's original split (§16.1) was **by layer**, for 2 people: Person A = backend + web portal, Person B = both mobile apps. Extending that same "split by layer, not by feature" principle to 4 people, cleanly along the existing subagent boundaries:

| Person | Owns | Maps to |
|---|---|---|
| A | Backend API + Prisma schema (`apps/backend`, `prisma/`) | Core of `backend-agent`'s scope |
| B | Web Portal frontend (`apps/web-portal`) | The other half of `backend-agent`'s scope — needs tight sync with Person A on the API contract |
| C | DSM App (`apps/dsm-app`) | Half of `mobile-agent`'s scope |
| D | Customer App (`apps/customer-app`) | The other half of `mobile-agent`'s scope |

Whoever owns the backend (A) is the most central, highest-leverage — and highest-risk, per the "money/points touching code is human-reviewed" rule — role; that person should be the most experienced or most available. An **OpenAPI/Swagger spec generated from the backend** (mentioned as a recommendation in §16.1 but not yet confirmed as actually generated/published — check `apps/backend` for this before assuming it exists) is how B/C/D should know the API contract without reading backend source directly.

Whatever split is chosen, **money/points-touching PRs still need human review before merge regardless of who wrote them** — that rule doesn't loosen just because the team got bigger.

## 11A. Day-1 checklist for new hires

Do these roughly in order. Nothing here is a substitute for asking the founder directly if something's unclear — this just prevents the first day from being spent guessing.

**Access & accounts**
- [ ] GitHub access to this repo
- [ ] Your own Claude Code Pro subscription (each person runs their own session — see §10, don't share one account across two people)
- [ ] Supabase project credentials from the founder (`DATABASE_URL`/`DIRECT_URL`) — **this is a shared real database with real pump data, not a sandbox you spin up yourself.** Ask what you're allowed to write to it before you start experimenting.
- [ ] Any live third-party API keys relevant to your area (Google Cloud Vision, Firebase, etc.) — most are still unset placeholders (§5, `.env.example`), so you may not need real ones yet

**Environment setup**
- [ ] Node 22 LTS installed (`nvm install 22 && nvm use 22`)
- [ ] Clone the repo, `cp .env.example .env`, fill in the values you were given
- [ ] `npm install` at the repo root (installs all workspaces)
- [ ] `npx prisma migrate dev` — only once you have real DB credentials; this touches the shared Supabase DB
- [ ] If you're on mobile (DSM app / customer app): Android Studio + JDK 17 (Xcode too, if you're on a Mac and will touch iOS)
- [ ] Confirm you can start your assigned app per §12 below before writing any code

**Reading, in this order**
1. `CLAUDE.md` — the ground rules, overrides everything else on conflict
2. This document, in full
3. `docs/master-plan.md` — at least skim the table of contents; read in depth the sections covering your assigned app/layer (§11)
4. `docs/security-notes.md` — know what's a deliberately-accepted gap vs. an actual bug
5. If backend/web-portal: `docs/multi-tenancy-plan.md` and `docs/ledger-accounting-review.md`

**Get oriented in the codebase**
- [ ] Agree with the founder which layer you own (§11's proposed split, or whatever's actually decided)
- [ ] Run your app locally, log in, click through the screens listed in §7A for your app — get a feel for the real UI before reading more spec
- [ ] Skim `docs/master-plan.md` §17 and §18 (open decisions + go-live checklist) so you know what's genuinely unresolved before you assume something is a bug you should fix

**A safe first task**
Don't start on money/points-touching logic on day one (§9 — that code needs human review and higher context regardless of who writes it). Good low-risk starter tasks: pick an item off §8's "not built yet" list that's UI-only or additive (e.g. surfacing the existing-but-undisplayed `loyaltyWarning`, master-plan §17.14), or add a test for a screen in your area that doesn't have one yet, following the pattern already set in `apps/dsm-app/src/screens/*.test.tsx` (§7A).

## 12. Getting started

```bash
cp .env.example .env          # fill in real values — ask the founder for Supabase creds and any live API keys
npm install                   # installs all workspaces
npx prisma migrate dev        # applies the schema to the shared Supabase DB (there is no local DB)
```

Then, per app:

```bash
npm run start:dev --workspace apps/backend    # NestJS API — http://localhost:3000
npm run dev --workspace apps/web-portal       # React + Vite PWA — http://localhost:5173
npm run start --workspace apps/dsm-app        # Expo — DSM field app
npm run start --workspace apps/customer-app   # Expo — credit customer app
```

Prereqs: Node 22 LTS, a Supabase project connection (get from the founder — this is a **shared real database**, not a sandbox each person spins up independently; be careful what you run against it), Android Studio/JDK 17 for mobile builds, Xcode (Mac only) for iOS.

**Do not try to start Docker Desktop or a local Postgres container** — this project intentionally has no local DB; the backend always talks to Supabase via `DATABASE_URL`.

## 12A. Glossary

Domain and industry terms used throughout this codebase and its docs, without definition on first use elsewhere. If you're not from the fuel-retail industry, this section will save you a lot of confused re-reading.

| Term | Meaning |
|---|---|
| **DSM** | Dispensing/Sales staff — the field/counter staff physically at the nozzle, billing customers. Also the name of the mobile app built for them (`apps/dsm-app`). |
| **OMC** | Oil Marketing Company — IOCL (Indian Oil), BPCL (Bharat Petroleum), HPCL (Hindustan Petroleum), or similar. Petrol pumps in India are typically independently owned but franchised under one of these; the OMC supplies the fuel and sets branding/compliance requirements. |
| **Nozzle** | The physical fuel-dispensing point at a pump, each with its own meter/totalizer. A pump has several — a small one might have 4, a highway pump 12+. |
| **Meter reading** | The opening/closing totalizer number on a nozzle for a shift. Litres sold = closing − opening. This is the "ground truth" for how much fuel physically left the tank, independent of what customers were billed. |
| **Rollover** | Older mechanical/electronic meters physically reset to zero after reaching a fixed max digit count (e.g. 99999.99). The system has to detect and correct for this instead of reading it as a negative/nonsensical reading. |
| **DIP reading** | A physical stick measurement of how much fuel is actually in a tank, taken manually. Compared against the system-calculated stock level (purchases − sales) to catch discrepancies. |
| **Variance report** | The comparison of purchased vs. billed/sold vs. physically-DIP-measured fuel. A mismatch flags possible pilferage, measurement drift, or data-entry errors — considered the single most valuable report in the system. |
| **Density / PPM log** | A fuel-quality reading (density or parts-per-million impurity) logged per tanker delivery or DIP check, kept for OMC compliance audits. |
| **Tanker** | The delivery truck that brings fuel to refill a pump's tanks. |
| **Shift schedule** | Dealer-configured daily time windows (e.g. "Shift 1: 06:00–14:00") used only to *label* which shift a batch of closing meter readings belongs to — it never blocks or validates a submission. |
| **Walk-in sale** | A sale to an anonymous customer with no itemized bill created — tracked in aggregate per shift (`ShiftSalesSummary`) rather than as an individual `Bill` row, since nobody needs a per-transaction record for an untracked cash customer. |
| **Credit customer** | A customer who buys fuel against a running tab instead of paying per visit — typically a fleet/transport company, billed and settled periodically. |
| **Informal vs. verified (customer)** | An `informal` customer was quick-added at the counter (name + vehicle only, no phone/limit) and is flagged yellow in the UI until an Owner/Accountant upgrades them to `verified` with full details. |
| **Credit limit enforcement (`NOTIFY` / `BLOCK`)** | Dealer-configurable: `NOTIFY` lets an over-limit bill go through with an alert; `BLOCK` rejects it outright at the point of sale. |
| **Blacklist (vehicle/company)** | A harder, unconditional block on extending *any* new credit to a specific vehicle or company after a default — independent of whether they're within their credit limit. |
| **QR loyalty card** | A printed card encoding only a customer's ID (a "pointer," never a balance or rate) — scanned by a DSM's phone camera to identify a loyalty/credit customer at billing time. |
| **Earning basis (rupee vs. litre)** | How loyalty points are calculated — as a function of the bill amount (₹) or the litres purchased. A dealer-level setting with an optional per-customer override. |
| **Redemption** | Spending accumulated loyalty points — either as a cash discount on a future bill, or against a dealer-maintained gift catalog (or both, depending on config). |
| **Cash custody** | Tracking where end-of-day cash physically goes: deposited to the bank, kept in the pump's locker/safe, or taken home by the owner/manager — with the "taken home" amount tracked as a running balance until it's brought back. |
| **Split payment** | A single bill paid across more than one method (e.g. half cash, half UPI), including "overpay by UPI, take cash change back" — must balance server-side (`sum(IN) − sum(OUT) = bill amount`). |
| **UPI** | Unified Payments Interface — India's real-time bank-to-bank payment rail; the default way Indian customers pay digitally at a counter (scan a merchant QR, pay from any bank app). Distinct from a card or a payment gateway. |
| **Ledger / Voucher / Dr / Cr** | The double-entry accounting internals modeled after Tally (`LedgerAccount`, `Voucher`, `VoucherLine`). This vocabulary is intentionally backend/accountant-only — DSM and customer-facing screens use plain terms like "Add Bill" instead. |
| **Tally** | The dominant Indian accounting/bookkeeping software — most pump accountants already use it for GST/VAT filing. This system exports data in a Tally-compatible format so accountants aren't forced into double entry. |
| **GST vs. VAT** | GST (Goods and Services Tax) is India's national consumption tax; fuel (petrol/diesel specifically) is instead taxed under state-level **VAT**, outside the GST regime — a distinction this system's tax reporting doesn't fully model yet (§17.22). |
| **DPDP Act** | India's Digital Personal Data Protection Act — governs consent and handling requirements for customer personal data (phone numbers, vehicle numbers, KYC-lite profiles) collected by the loyalty program. |
| **PWA** | Progressive Web App — a website that can be "installed" to a phone/desktop home screen and cache data for offline viewing, without being a separate native app. This is how the web portal serves as a de facto "dealer app" without a second codebase. |
| **RLS** | Row Level Security — a Postgres feature used here to deny direct table access over Supabase's auto-exposed REST API (PostgREST), independent of and in addition to the backend's own role-based authorization (`docs/security-notes.md`). |
| **Pump (as a tenant)** | One physical, independently-operated fuel station in the multi-tenant data model — every tenant-scoped table carries a `pumpId` so multiple pumps' data never mixes. |

## 13. Where to go deeper

Read in roughly this order, once you've absorbed this handoff:

1. `CLAUDE.md` — the actual ground rules, kept current, overrides everything else if there's a conflict
2. `docs/master-plan.md` — full spec, section-numbered, the real source of truth for feature behavior
3. `README.md` — quickstart + a maintained "what's actually built vs. planned" status line
4. `docs/multi-tenancy-plan.md` — if working on anything pump-scoping related
5. `docs/security-notes.md` — accepted security tradeoffs and their fix conditions
6. `docs/ledger-accounting-review.md` — if working on anything money/accounting-adjacent
7. `docs/production-readiness.md` — a **point-in-time** (2026-07-22) audit; verify anything in it against current code before acting, some listed gaps have since been closed

Do not treat any status summary (including this one) as more current than the code and `git log` themselves — this document will drift; the master plan's own §17/§18 checklists and CLAUDE.md are the maintained sources.
