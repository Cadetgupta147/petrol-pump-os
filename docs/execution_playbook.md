# Execution Playbook — Petrol Pump OS

**📍 CURRENT STATUS (updated after the post-Phase-2 hardening pass):** Phase 1 ✅ complete. Phase 2 ✅ complete. Phase 2.5 (UI wiring gaps + lint hardening) — all web-portal work done and committed; **backend ESLint report received, fixes not yet applied.** **Start here → decide fix strategy for the backend lint report below, then Phase 3, slice 3.1.**

**Purpose:** a self-serve queue of prompts you can run against Claude Code, one after another, without needing to come back to chat — as long as each one passes its validation checklist before you move to the next. Pairs with `docs/master-plan.md` (the feature spec) — this file is the *execution* companion, telling you what to actually type and what to check.

**How to use this file:**
1. Do slices **in order**. Don't skip ahead — later slices assume earlier ones exist and work.
2. Copy the **Prompt** block exactly (or adapt lightly) into Claude Code.
3. When it reports done, run the **Standard Review Ritual** below, then the slice's specific **Validation Checklist**.
4. Only commit once validation passes. If it fails, tell Claude Code exactly what broke — don't just re-run the same prompt.
5. Check the box, move to the next slice.
6. See the **"When to come back to this chat"** section at the end — a short, real list of conditions, not "whenever unsure."

---

## Standard Review Ritual (repeat for every single slice, no exceptions)

Run this after every "done" report, before every commit — this is the same discipline we used for the backend scaffold and Customer API:

0. **If any part of this slice was generated outside your real Claude Code session** (a zip from a different account/tool, code someone else wrote, anything not produced by *this* project's Claude Code working against *your* real backend) — treat it as an unverified draft, not a finished slice, no matter how complete it looks. Copy it into the repo first, then run a reconciliation prompt before anything else:
   ```
   Use the [agent that owns this folder]. [folder] was copied in from an
   externally-generated draft — it has NOT been verified against our actual
   backend/schema. Read the real prisma/schema.prisma and the actual API
   endpoints/models this depends on. Check the draft against what actually
   exists — field names, endpoint paths, response shapes, assumptions. Fix any
   mismatches. Report back specifically what you checked and what you had to
   fix, if anything. Stop before committing.
   ```
   Only after that reconciliation report comes back do steps 1–4 below apply.
1. **Don't trust the summary — run it yourself.** Whatever curl commands, test commands, or manual steps the slice's checklist below lists, actually execute them yourself in a terminal.
2. **Check scope:**
   ```bash
   git status
   git diff --stat
   ```
   Confirm it only touched files inside the folder(s) this slice says it should. If it touched `prisma/schema.prisma` and you didn't expect a schema change, read the diff on that file specifically before accepting it.
3. **Confirm no secrets leaked into a commit:**
   ```bash
   git diff --stat -- .env
   ```
   Should show nothing. If `.env` shows up in `git status` at all (not just `.env.example`), stop and fix `.gitignore` before doing anything else.
4. **Only after 1–3 pass:** tell Claude Code to commit and push, using the commit message given in that slice (or close to it).


---

## Phase 1 — Web Portal MVP (backend-agent)

**✅ STATUS: COMPLETE (1.1–1.6 all done and committed)**

Goal of this phase: replace your current manual/Excel process end-to-end from the API + a basic web portal, before any mobile app exists. Reference: master-plan.md §16.4 Phase 1.

### 1.1 Customer API ✅ *(already prompted — mark done once validated)*

**Prompt:**
```
Use the backend-agent. Implement the Customer model's API from docs/master-plan.md
Section 3.4 — create, view, edit a customer (name, phone, vehicle number, credit
limit). The Customer model already exists in prisma/schema.prisma. Build the NestJS
endpoints only, no UI yet. Give me curl commands to verify each endpoint works
against the real Supabase DB. Stop before committing — I'll confirm first.
```

**Validation checklist:**
- [ ] `POST /customers` creates a customer, returns it with an `id` and a generated `qrMemberId`
- [ ] `POST /customers` with a duplicate phone number returns a clear error, not a 500 crash (phone is `@unique` in the schema)
- [ ] `GET /customers/:id` returns the customer you just created
- [ ] `GET /customers` returns a list including it
- [ ] `PATCH /customers/:id` updates the credit limit and the change persists on a follow-up `GET`
- [ ] Open Supabase Studio (or `npx prisma studio`) and visually confirm the row exists in the `Customer` table — don't just trust the API response

**Commit message:** `Add Customer API (create/view/edit) — Section 3.4`

---

### 1.2 Manual Bill Entry API (with split payments)

**Prerequisite:** 1.1 done and committed.

**Prompt:**
```
Use the backend-agent. Implement manual bill entry from docs/master-plan.md Section
3.2, using the Bill and BillPaymentLine models that already exist in
prisma/schema.prisma. Requirements:
- A bill needs at least one of [vehicle number, customer name] filled (Section 4's
  validation rule) — enforce this server-side, not just assume the frontend will.
- Support multiple BillPaymentLine rows per bill per Section 5A. Validate server-side
  that sum(amount where direction=IN) - sum(amount where direction=OUT) equals the
  bill's total amount — reject the request otherwise, don't silently accept.
- Bill can optionally link to an existing customerId.
Give me curl commands covering: a simple single-payment-method bill, a split payment
(half cash half UPI), and the "overpay by UPI, cash change returned" case from
Section 5A.2. Stop before committing.
```

**Validation checklist:**
- [ ] Simple bill (single payment line) saves successfully
- [ ] Split bill (cash + UPI summing exactly to the total) saves successfully
- [ ] Change-back scenario (UPI IN 1000, cash OUT 40, bill total 960) saves successfully
- [ ] **Try to break it on purpose:** submit payment lines that DON'T sum to the bill total — confirm you get a clear rejection, not a saved bill with wrong numbers
- [ ] **Try to break it on purpose:** submit a bill with no vehicle number AND no customer name — confirm it's rejected
- [ ] A bill linked to a `customerId` shows up when you `GET /customers/:id` (however that relation is exposed)

**Commit message:** `Add manual bill entry API with split-payment support — Section 3.2, 5A`

---

### 1.2b Bill Edit/Delete, Audit Trail, and Credit-Limit Check *(follow-up — closes gaps in 3.2/3.4 that 1.2's initial scope didn't cover)*

**Prerequisite:** 1.2 done and committed.

**Prompt:**
```
Use the backend-agent. Two additions to the bills module before this is complete:
1. Edit and delete endpoints for a Bill, with full parity to create (Section 3.2) —
   include an audit trail: track who entered it, who last edited it, and when,
   without losing the original entry's history.
2. When a payment line has paymentType=CREDIT, check the customer's outstanding
   balance + this bill's credit amount against their credit limit (Section 3.4).
   Decide and tell me whether you're blocking or just flagging over-limit bills —
   flag it as a decision, don't silently pick one.
Give me curl commands for: editing a bill, deleting one, and a credit bill that
exceeds the customer's limit. Stop before committing.
```

**Validation checklist:**
- [ ] Editing a bill updates it and the audit trail shows who/when — confirm the *original* entry data isn't lost (query it, don't just trust the edit response)
- [ ] Deleting a bill actually removes it (or soft-deletes, per whatever the agent decided — confirm which, and that it's consistent with how reports in Section 12 should treat deleted bills later)
- [ ] A CREDIT bill that pushes a customer over their limit is correctly blocked/flagged (confirm which behavior was implemented, and that it matches what you actually want)
- [ ] A CREDIT bill within the limit still succeeds normally

**Commit message:** `Add bill edit/delete with audit trail and credit-limit check — Section 3.2, 3.4`

---

### 1.2c Informal Credit + Configurable Limit Enforcement *(supersedes 1.2b's "block over-limit" and "customerId required" decisions — see Section 3.4A)*

**Prerequisite:** 1.2b done and committed.

**Prompt:**
```
Use the backend-agent. This changes two decisions from the last slice, per
docs/master-plan.md Section 3.4A, and closes a gap from slice 1.1:

1. CREDIT payment lines no longer require a pre-existing, fully-registered
   customer. Support quick-adding a customer (name + vehicle number only) at
   the moment of billing, flagged `informal` (vs `verified`) on the Customer
   model. This flag should be exposed on every endpoint that returns customer
   data, so the frontend can show it visually later — don't just use it
   internally.

2. Replace the hard block on over-limit credit bills with a CreditConfig model:
   `enforcementMode` (NOTIFY default, BLOCK available) and
   `defaultInformalCreditLimit` (auto-applied to quick-added customers). Under
   NOTIFY (the default), an over-limit bill still succeeds, but creates a
   Notification/Alert record for the Owner with a flag for whether a payment
   reminder was requested — don't actually send the SMS/WhatsApp reminder yet,
   that's Section 11 and comes later; just create the record and an endpoint
   for the dealer to mark "send reminder: yes/no" on it.

3. Gap from slice 1.1: build the actual customer ledger view from Section
   3.4 — "every bill, every payment, running balance" — as either an addition
   to GET /customers/:id or a dedicated GET /customers/:id/ledger endpoint.
   This must work identically for verified and informal customers, and must
   correctly include bills created via quick-add in this same slice — that's
   the specific thing to verify, since it's easy to build the ledger against
   only pre-existing customers and miss the just-created ones.

Give me curl commands for: quick-adding an informal customer inline with a
credit bill, an over-limit bill under NOTIFY mode succeeding and creating an
alert, switching to BLOCK mode and confirming the old rejection behavior still
works, and — critically — pulling that same informal customer's ledger
afterward to confirm the credit bill actually shows up in it with the correct
running balance. Stop before committing.
```

**Validation checklist:**
- [ ] A CREDIT bill for a brand-new customer (no prior registration) succeeds and creates an `informal`-flagged Customer
- [ ] That customer's `informal` flag is visible in `GET /customers` and `GET /customers/:id` responses
- [ ] **The quick-added customer's ledger (bills + payments + running balance) correctly shows the credit bill you just created** — this is the specific gap being closed, don't skip it
- [ ] Running balance math is actually right — add a payment against that customer afterward and confirm the balance decreases by exactly that amount
- [ ] Under `NOTIFY` mode, a bill exceeding the customer's limit still saves successfully (not rejected) and an alert/notification record is created
- [ ] Switching `CreditConfig.enforcementMode` to `BLOCK` and re-testing the same over-limit scenario now correctly rejects it — confirm the setting genuinely changes behavior, not just cosmetic
- [ ] The default informal credit limit auto-applies to a quick-added customer without you setting one manually

**Commit message:** `Add informal credit customers and configurable limit enforcement — Section 3.4A`

---

### 1.3 Meter Reading API

**Prerequisite:** 1.2 done and committed.

**Prompt:**
```
Use the backend-agent. Implement meter reading entry from docs/master-plan.md
Section 3.3, using the MeterReading model in prisma/schema.prisma. Requirements:
- Opening reading entry starts a shift for a nozzle/staff.
- Closing reading entry ends it, auto-calculates litres sold (closing - opening).
- Add a basic variance check endpoint: compares litres sold (from meter) against
  litres billed (sum of Bill.litres for bills entered during that shift/nozzle
  window) and flags a mismatch beyond a small tolerance.
Give me curl commands for: opening a shift, closing it, and triggering the variance
check with a deliberate mismatch to confirm the flag fires. Stop before committing.
```

**Validation checklist:**
- [ ] Opening reading creates a shift record
- [ ] Closing reading correctly calculates `litres sold = closing - opening`
- [ ] Closing with a closing reading LOWER than opening is rejected (meter can't go backwards) — try this on purpose
- [ ] Variance check correctly flags when billed litres and meter litres don't match
- [ ] Variance check does NOT flag when they match within tolerance — confirm no false positives with a clean test case

**Commit message:** `Add meter reading API with shift tracking and variance flag — Section 3.3`

---

### 1.4 Dashboard + Core Reports API

**Prerequisite:** 1.3 done and committed.

**Prompt:**
```
Use the backend-agent. Implement the dashboard summary and core reports endpoints
from docs/master-plan.md Section 3.1 and 12. Start with just these, not the full
report list yet:
- Today's sales summary: total litres, total amount, split by payment type
  (aggregate BillPaymentLine by type)
- Tank stock snapshot (can return placeholder/zero values if Tank rows don't exist
  yet — don't block on inventory work not built)
- Recent bills list (last 20, most recent first)
Give me curl commands for each. Stop before committing.
```

**Validation checklist:**
- [ ] Today's sales total matches what you'd get by manually summing the test bills you created in 1.2
- [ ] Payment-type split adds up to the same total (cash + card + upi + credit = total)
- [ ] Recent bills list shows your test bills in the right order
- [ ] Create one more test bill via curl, confirm it shows up in both the summary total and the recent bills list without restarting the server

**Commit message:** `Add dashboard summary and core report endpoints — Section 3.1, 12`

---

### 1.5 Role-Based Auth (Owner + Accountant)

**Prerequisite:** 1.4 done and committed. This is the last Phase 1 slice — do it last on purpose, since it's easier to build and test the data endpoints first, then lock them down.

**Prompt:**
```
Use the backend-agent. Implement role-based login from docs/master-plan.md Section 2,
using the Staff model and Role enum in prisma/schema.prisma. Start with just Owner
and Accountant roles. Requirements:
- Simple login (email/phone + password is fine for now, PIN login is DSM-app-specific
  and comes later) issuing a JWT.
- Every endpoint built in 1.1-1.4 must now require a valid token.
- Accountant role can do everything built so far (customers, bills, meter readings,
  reports) EXCEPT anything related to business settings or loyalty config (nothing
  exists there yet, so just leave a comment marking where that restriction will apply
  later) AND EXCEPT modifying CreditConfig (§3.4A/1.2c) — Accountant can view it,
  only Owner can change enforcementMode or defaultInformalCreditLimit.
- Owner role can do everything Accountant can, no restrictions.
Give me curl commands for: logging in as each role, confirming a request WITHOUT
a token gets rejected, and confirming Accountant is blocked from PATCH
/credit-config while Owner isn't. Stop before committing.
```

**Validation checklist:**
- [ ] Login as Owner returns a valid token
- [ ] Login as Accountant returns a valid token
- [ ] **Try to break it on purpose:** call `GET /customers` with no token at all — confirm you get a 401, not data
- [ ] **Try to break it on purpose:** call it with an expired or garbage token — confirm rejection, not a crash
- [ ] Both roles can successfully create a bill (nothing restricted yet at this stage, that's expected)
- [ ] Wrong password on login is rejected with a clear error, not a stack trace

**Commit message:** `Add JWT auth with Owner/Accountant roles — Section 2`

---

### 1.6 CORS Configuration + Web Portal Scaffold *(added retroactively — this was missing from the original playbook)*

**Why this slice exists:** Slices 1.1–1.5 only built backend APIs. Phase 1's actual goal — "replace your manual process end-to-end on the web portal alone" (§16.4) — needs a real frontend, which was never scripted as its own slice. Do this **before** moving on to anything past Phase 2, even if you've already started DSM app work — the web portal is the actual Phase 1 deliverable, and CORS only matters once it exists.

**Step 1 — CORS (backend-agent):**
```
Use the backend-agent. Add CORS configuration to apps/backend, allowing requests
from the Web Portal's dev origin (http://localhost:5173 for Vite's default, plus
whatever port apps/web-portal actually runs on) and from your deployed Web Portal
domain once one exists (leave this as an env-configurable allowlist, not
hardcoded). Stop before committing.
```
**Test:** confirm a request from a browser running on a different origin than the backend succeeds (this is the actual proof — a Postman/curl test won't catch a missing CORS config, since CORS is enforced by browsers, not servers, on the request itself).

**Commit:** `Add CORS configuration for Web Portal — Section 15.9`

**Step 2 — Web Portal scaffold (check which agent owns apps/web-portal — CLAUDE.md may need a third agent defined here, or backend-agent's scope may already cover it):**
```
Scaffold apps/web-portal per docs/master-plan.md Section 1.2, 1.3, and 15.2 — React
+ Vite, PWA-installable. Build just the login screen + Customer list/create screen
(Section 3.4) first, wired to the existing backend APIs. Confirm it can actually
log in and fetch/create a customer against the real backend, with CORS working
correctly. Stop before committing.
```
**Test:**
- [ ] Login screen successfully authenticates against the real backend (not a mock)
- [ ] Customer list loads real data from the backend
- [ ] Creating a customer through the UI actually persists — confirm via a direct API call or Supabase Studio, not just "the UI showed it"
- [ ] Open browser dev tools' Network tab and confirm no CORS errors appear

**Commit:** `Scaffold Web Portal with login and customer screens — Section 1.2, 3.4`

*(What actually happened here, for the record: the scaffold was brought in as an externally-generated draft — from Claude Code on a different account, built more fully than this prompt asked for — then reconciled against the real backend, restyled to match a reference dashboard design, and committed as one combined commit. That's fine; the reconciliation-before-commit step is what mattered, not matching this prompt exactly.)*

**🎯 Phase 1 complete when 1.1–1.6 all pass.** This is your first real milestone from §16.6 — the point where you can stop using Excel/paper for daily entry, using the actual web portal, not just the API directly.

---

## Phase 2 — DSM App + Tally Export

**✅ STATUS: COMPLETE (2.1–2.4 all done and committed)**

Goal: get the field-staff mobile app working end-to-end, and remove your accountant's double-entry problem. Reference: §16.4 Phase 2.

### 2.1 Tally XML Export (backend-agent — do this first, it's pure backend)

**Prerequisite:** Phase 1 complete.

**Prompt:**
```
Use the backend-agent. Implement Tally XML export from docs/master-plan.md Section
10. Generate a Tally-compatible XML file covering: Bills as Sales Vouchers,
Payments as Receipt Vouchers, Customers as Ledgers. Add an endpoint that generates
and returns this XML for a given date range. Log each export in the TallyExportLog
model. Give me a curl command to trigger an export and show me the resulting XML
structure. Stop before committing.
```

**Validation checklist:**
- [ ] Export endpoint returns valid XML (not malformed — check it opens without error in a text editor at minimum; ideally test-import it into a Tally trial if you have access)
- [ ] Every test bill from Phase 1 appears as a voucher in the output
- [ ] A `TallyExportLog` row is created recording the export
- [ ] Running the export twice for the same date range doesn't duplicate anything problematic — confirm what actually happens (should either be idempotent or clearly append a new export log entry, not silently corrupt data)

**Commit message:** `Add Tally XML export — Section 10`

---

### 2.2 DSM App Scaffold + PIN Login (mobile-agent)

**Prerequisite:** 2.1 done. This is your first mobile-agent slice — expect it to take longer and need more back-and-forth than backend slices, since it's a new app from scratch.

**Prompt:**
```
Use the mobile-agent. Read CLAUDE.md and docs/master-plan.md Section 4 and 15.3.
Set up apps/dsm-app as a React Native app. Build just PIN login for now: a staff
member enters their PIN, it's checked against the Staff model via the backend API
(you'll need a PIN-login endpoint on the backend too — flag if backend-agent should
build that first rather than guessing at the contract). Don't build offline sync
yet, don't build billing yet — just get login working and confirm the app can reach
the backend API. Stop before committing.
```

**Validation checklist:**
- [ ] App builds and runs on an emulator or your own phone (Android is enough to start, don't block on iOS/Xcode yet)
- [ ] Entering a valid staff PIN logs in successfully
- [ ] Entering a wrong PIN is rejected with a clear message, not a crash
- [ ] After login, the app can successfully make ONE authenticated call to the backend (e.g. fetch the logged-in staff's own name) — this proves the token flow works end-to-end, not just that login "looks" successful

**Commit message:** `Scaffold DSM app with PIN login — Section 4`

---

### 2.3 DSM App: Meter Reading + Bill Entry (with split payments)

**Prerequisite:** 2.2 done and committed.

**Prompt:**
```
Use the mobile-agent. Build the meter reading and bill entry screens for
apps/dsm-app per docs/master-plan.md Section 4 and 5A. No QR scan yet (Section 6
comes later) — vehicle number / customer name text entry only, with the validation
rule that at least one must be filled. Implement the full split-payment "Add
Payment" flow from Section 5A.3: running remaining-to-collect ticker, Save disabled
until it hits zero, and the cash-change prompt when a non-cash line overshoots the
bill total. Wire it to the backend APIs already built. Stop before committing.
```

**Validation checklist:**
- [ ] Opening + closing meter reading entry works and matches what the backend API returns when queried directly
- [ ] A simple single-payment bill saves and appears via the backend's recent-bills endpoint
- [ ] A split payment (cash + UPI) saves correctly — verify the sum on the backend side, not just that the app "looked" like it saved
- [ ] The cash-change scenario (overpay via UPI) correctly prompts and saves the OUT line
- [ ] Try submitting with neither vehicle number nor customer name filled — confirm Save is disabled or rejected, not silently allowed
- [ ] Try to Save before "remaining to collect" hits zero — confirm it's blocked

**Commit message:** `Add DSM app meter reading and split-payment bill entry — Section 4, 5A`

---

### 2.4 Save Receipt as PDF *(replaces Bluetooth printing — deferred, see note below)*

**Prerequisite:** 2.3 done.

**Note:** Bluetooth thermal printing (Section 15.8) is deferred — not needed to keep moving through Phase 2. Revisit it later if/when you actually get printer hardware; nothing else in the plan depends on it.

**Prompt:**
```
Use the mobile-agent. Add a "Save Receipt as PDF" feature to apps/dsm-app per
docs/master-plan.md Section 4 — skip Bluetooth printer integration for now (Section
15.8 is deferred). After a bill is successfully saved, generate a PDF receipt
showing amount, litres, payment breakdown (including split-payment lines if any),
and a loyalty points line left blank/"N/A" for now since loyalty isn't built yet.
Let the DSM save it to the phone's local storage, and give a share option (so it can
be sent via WhatsApp/email or transferred to a computer) rather than a printer
pairing flow. Stop before committing.
```

**Validation checklist:**
- [ ] PDF generates successfully after a real bill save
- [ ] Amount, litres, and payment breakdown on the PDF match what was actually saved to the backend — verify against the bill's data via curl, don't just eyeball the PDF
- [ ] Split-payment bills show all payment lines correctly on the receipt, not just the first one
- [ ] Share option actually opens the phone's native share sheet (WhatsApp/email/etc.) with the PDF attached
- [ ] Handles a bill with no customer name/only a vehicle number gracefully (shouldn't show a blank "Customer: " line awkwardly)

**Commit message:** `Add PDF receipt generation to DSM app (Bluetooth printing deferred) — Section 4`

**🎯 Phase 2 complete when this passes** — your accountant can now stop double-entering into Tally, and field staff have a working phone-based billing flow (still without loyalty, which is Phase 3).

---

## Phase 2.5 — UI Wiring Gap Closure & Lint Hardening

**Why this phase exists:** a full audit (backend controllers vs. web-portal/dsm-app API clients vs. pages) found several endpoints with real backend logic and zero UI to trigger them, one live bug (DSM role 403s), and zero lint coverage across both `apps/web-portal` and `apps/backend`. None of this was in the original playbook — it's logged here so future-you sees *why* these commits exist, not just that they do.

### 2.5.1 DSM Role Fix ✅ *(done and committed)*

**What was wrong:** `BillsController`, `CustomersController`, and `MeterReadingsController` were `@Roles(Role.OWNER, Role.ACCOUNTANT)` only — but the DSM app authenticates via `POST /auth/pin-login`, which can return `role: "DSM"`. Real DSM staff got 403'd on the four endpoints the DSM app exists to call.

**Fix:** method-level `@Roles(Role.OWNER, Role.ACCOUNTANT, Role.DSM)` overrides added on exactly `POST /bills`, `GET /customers`, `POST /meter-readings`, `PATCH /meter-readings/:id/close` — class-level restriction (Owner/Accountant only) preserved everywhere else on those controllers.

**Commit:** `Fix DSM role 403 on core DSM app endpoints — Section 2`

---

### 2.5.2 Customer Create/Edit UI ✅ *(done and committed)*

**What was missing:** `POST /customers` and `PATCH /customers/:id` existed on the backend with zero UI to call them — the only way to add a customer was curl or Prisma Studio.

**Built:** `CustomerFormModal` (shared add/edit), "+ Add customer" and per-row "Edit" on `CustomersPage`. Dangling `getCustomer(id)` client function removed (both real call sites already had the full object in hand). **Known accepted risk, logged in master-plan.md §17:** edit form uses stale in-memory row data, no fetch-on-open — acceptable at current (effectively solo) team size, revisit once a second person has Owner/Accountant access.

**Commit:** `Add customer create/edit UI, resolve dangling getCustomer — Section 3.4`

---

### 2.5.3 Bill Edit/Delete UI + Owner-Only Delete (spec deviation) ✅ *(done and committed)*

**What was missing:** `PATCH /bills/:id` and `DELETE /bills/:id` existed with zero UI.

**Deliberate spec deviation:** master-plan.md originally gave Accountant full edit/delete parity on bills (§3.2/§2). **Delete was narrowed to Owner-only** — edit and delete carry different risk profiles: edit is frequent and low-risk (the original bottleneck-removal reasoning still applies), delete is rare and is the one action that could hide misconduct (e.g. deleting a cash bill after pocketing the cash removes it from every report). **`docs/master-plan.md` Sections 2 and 3.2 were updated to document this split** — edit stays Owner+Accountant, delete is Owner-only, both server-side (`@Roles(Role.OWNER)` on `remove()`) and UI-gated.

**Built:** `BillFormModal` (edit, Owner+Accountant), `DeleteBillConfirmModal` (real confirmation dialog, not `window.confirm`, Owner-only) on `BillDetailPage`.

**Commit:** `Add bill edit/delete UI, restrict delete to Owner-only (spec deviation, master-plan updated) — Section 3.2`

---

### 2.5.4 Credit Alert Detail + Request-Reminder UI ✅ *(done and committed)*

**What was missing:** `GET /credit-alerts/:id` had no client function at all; `PATCH /credit-alerts/:id` (the "request reminder" flag) had no UI trigger despite being built specifically for one.

**Built:** per-alert rows in the Dashboard Alerts panel (replacing the old single aggregated "N customers over limit" row), each with its own "Request reminder" button (pending → done states, initializes correctly from the server on load, failure surfaces a banner rather than failing silently).

**Known limitation, logged in master-plan.md §17:** the reminder-requested flag is one-way with no reset — confirm whether a fresh over-limit event reuses the same alert row (needs a reset) or creates a new one (no issue) before this becomes confusing at higher alert volume.

**Commit:** `Add credit alert detail view and request-reminder action — Section 3.4`

---

### 2.5.5 ESLint — Web Portal ✅ *(done and committed)*

**What was wrong:** `eslint` was referenced in `package.json`'s lint script but never installed — `npm run lint` had been silently no-op-ing across all prior web-portal work.

**Fix:** flat-config ESLint set up (typescript-eslint with type-checking, react-hooks, react-refresh). Found 23 problems, all fixed: 12 unsafe-`any` errors (consolidated into one shared `parseErrorMessage()` helper), 6 `no-misused-promises` errors (async handlers wrapped correctly), 2 floating-promise errors (one confirmed safe as `void load()`, the other — meter variance check — got a real fix: per-reading failure tracking + an "unverified" banner, since silently downgrading a failed OMC-relevant variance check to "looks clean" was the wrong failure mode), 1 Fast Refresh warning (`useAuth` hook split into its own file, all importers updated).

**Commit:** `Set up ESLint for web-portal and fix all resulting issues (unsafe any, misused promises, floating promises, fast-refresh)`

---

### 2.5.6 ESLint — Backend 🔵 *(YOU ARE HERE — report received, fixes not yet applied)*

**Same issue, more consequential:** `apps/backend` has had zero lint coverage across all backend work so far — including split-payment validation, role guards, and credit-limit logic. The setup step already ran; the fix step hasn't.

**Next prompt to run** — first, get the categories of issues (if you haven't already re-run this since the report came back, this is what triggered the current state):
```
Use the backend-agent. apps/backend has the same issue as web-portal did —
eslint is referenced in package.json's lint script but never actually
installed, so npm run lint has been silently no-op-ing across all backend
work so far, including the money-touching bills/customers/meter-readings
code. Set it up properly, matching web-portal's flat-config style where it
makes sense for a NestJS codebase. Run it and report categories of issues
found — don't auto-fix yet, just show me what's there first.
```

**When the report comes back:** treat it the same way the web-portal floating-promises were treated, not as a rubber-stamp batch fix. Specifically ask for an explanation (not just a fix) on any category touching:
- Bill/payment validation logic (Section 5A's balancing check)
- Role guard code (`@Roles()` decorators, `RolesGuard`)
- Credit limit checks (Section 3.4)

For everything else (unsafe-any, unused imports, formatting-adjacent rules), a straightforward fix-and-report is fine. Use this follow-up shape once the categories are in:
```
Before fixing [category X], show me what it's actually flagging and why —
specifically for anything touching bill/payment validation, role guards, or
credit-limit logic. Fix the rest directly. Stop before committing.
```

**Validate:**
- [ ] `npm run lint` shows 0 errors
- [ ] Full test suite still passes (54+ tests from prior work)
- [ ] `npm run build` still clean
- [ ] Spot-check that any fix touching money/role logic actually got the "explain first" treatment, not a blanket auto-fix

**Commit:** `Set up ESLint for backend and fix all resulting issues`

**🎯 Phase 2.5 complete when 2.5.6 passes.** Only then move to Phase 3.

---

## Phase 3 — Loyalty Program (QR)


Reference: §16.4 Phase 3, §6 for full feature detail.

### 3.1 Loyalty Config + QR Generation (backend-agent)
```
Use the backend-agent. Implement Section 6.1-6.2: QR generation for customers
(encode only the customer/member ID, nothing else — see Section 6.1), and the
LoyaltyConfig model already in prisma/schema.prisma (earning basis rupee/litre,
default rate, per-customer override via Customer.loyaltyRateOverride). Add an
endpoint that calculates points for a given bill using the correct
precedence: per-customer override rate first, else the dealer default. Give me
curl commands proving both the rupee-based and litre-based calculation paths
work correctly, and that a customer with an override rate uses it instead of
the default. Stop before committing.
```
**Test:** create two test customers (one with an override rate, one without), submit identical bills for both, confirm the points differ correctly. Switch `earningBasis` between rupee/litre in config and confirm the same bill produces different point values as expected.

**Commit:** `Add QR generation and loyalty points calculation — Section 6.1-6.2`

### 3.2 QR Scan → Auto-fill on DSM App (mobile-agent)
```
Use the mobile-agent. Add QR scan to the DSM app's bill entry screen per Section
6.3 and 6.7 — scanning a customer's QR auto-fills name, vehicle number, and
triggers the points calculation from the backend, shown before Save (per the
mockup in Section 14). Stop before committing.
```
**Test:** print or display one real QR code for a test customer, scan it with the actual app on a real device, confirm auto-fill is correct and the points shown match what the backend calculates directly via curl for the same bill.

**Commit:** `Add QR scan and auto-fill to DSM bill entry — Section 6.3`

**🎯 Phase 3 complete when this passes.**

---

## Phase 4 — Credit Customer App + Gift Catalog

Reference: §16.4 Phase 4, §5 and §6.4-6.7.

### 4.1 Gift Catalog CRUD (backend-agent, dealer side)
```
Use the backend-agent. Implement gift catalog management from Section 6.4, using
GiftCatalogItem in prisma/schema.prisma. Owner-only endpoints to add/edit/remove
gifts, set points cost, track stock. Also implement the redemption endpoint:
validate the customer has enough points, deduct them, create a
RedemptionTransaction, decrement gift stock if tracked. Respect
LoyaltyConfig.redemptionTypeAllowed and customerCanChooseRedemption from Section
6.4. Stop before committing.
```
**Test:** create a gift, redeem it for a test customer with enough points (should succeed and deduct correctly), then try redeeming for a customer with insufficient points (should be rejected, not allowed with a negative balance) — try this on purpose.

**Commit:** `Add gift catalog CRUD and redemption logic — Section 6.4`

### 4.2 Credit Customer App Scaffold + OTP Login (mobile-agent)
```
Use the mobile-agent. Read docs/master-plan.md Section 5. Set up apps/customer-app
with phone number + OTP login. No other screens yet. Stop before committing.
```
**Test:** login with a real phone number, confirm OTP delivery and successful auth end-to-end (not mocked).

**Commit:** `Scaffold customer app with OTP login — Section 5`

### 4.3 Bill History, Points Balance, Gift Browsing (mobile-agent)
```
Use the mobile-agent. Build the home screen, bill history, points balance, and
gift catalog browsing/redemption screens for apps/customer-app per Section 5 and
6.4, matching the mockups in Section 14. Wire to the backend APIs already built.
Stop before committing.
```
**Test:** log in as your test customer, confirm the points balance shown matches the backend exactly, redeem a gift through the app UI and confirm the backend's RedemptionTransaction table reflects it correctly.

**Commit:** `Add customer app bill history, points, and gift redemption UI — Section 5, 6.4`

**🎯 Phase 4 complete when this passes** — this is roughly when the system "feels complete" from a customer's perspective (§16.6).

---

## Phase 5 — Inventory, OCR, Rate Master, Density Logs

Reference: §16.4 Phase 5, §7 and §9.

### 5.1 Purchase Entry + Tank Stock (backend-agent, manual entry first)
```
Use the backend-agent. Implement Section 7.1-7.2: manual purchase entry (no OCR
yet), tank stock tracking that auto-deducts on nozzle sales and auto-increases
on purchase entries, and the variance report (purchased - sold - physical DIP =
variance). Stop before committing.
```
**Test:** enter a purchase, confirm tank stock increases by the right amount. Submit enough test bills to deduct a known quantity, confirm tank stock decreases correctly. Enter a deliberately mismatched DIP reading, confirm the variance report flags it.

**Commit:** `Add purchase entry, tank stock, and variance report — Section 7.1-7.2`

### 5.2 OCR for Supplier Invoices (backend-agent)
```
Use the backend-agent. Add OCR extraction for supplier invoices per Section 9,
using [Google Cloud Vision OR AWS Textract — pick one and note it in
CLAUDE.md's open items as resolved]. Extracted data must pre-fill the purchase
entry form for human confirmation, never auto-save directly. Stop before
committing.
```
**Test:** photograph a real supplier invoice (or a realistic sample), confirm extracted fields are reasonably accurate, and specifically confirm nothing saves to the database until you explicitly confirm the pre-filled form.

**Commit:** `Add OCR-assisted purchase entry — Section 9`

### 5.3 Rate Master + Density Logs (backend-agent)
```
Use the backend-agent. Implement Rate Master (Section 7.4) — date-wise fuel
pricing, captured on each bill at time of sale, not looked up retroactively —
and density/PPM logging (Section 7.3) tied to purchase entries and DIP readings.
Stop before committing.
```
**Test:** change the rate mid-test, confirm bills created before the change still show the old rate when queried later (this is the whole point of Rate Master — verify it explicitly, don't assume). Log a density reading, confirm it's retrievable per tank/date.

**Commit:** `Add Rate Master and density logging — Section 7.3-7.4`

### 5.4 Web Portal UI: Inventory & Purchase Screens *(interleaved — don't defer this)*
```
Use the backend-agent (owns apps/web-portal). Build the Web Portal screens for
5.1-5.3: tank stock view, purchase entry form (with the OCR pre-fill/confirm flow
from Section 9 — never auto-save OCR output), variance report view, and Rate
Master editor. Wired to the real APIs, no mock data. Stop before committing.
```
**Test:** enter a purchase through the UI (with a real invoice photo if you want to test OCR pre-fill), confirm tank stock updates on-screen without a manual refresh. Confirm the variance report actually renders your test mismatch from 5.1.

**Commit:** `Add Web Portal inventory and purchase UI — Section 7, 9`

**🎯 Phase 5 complete when 5.1–5.4 all pass.**

---

## Phase 6 — Cash Custody, Walk-in Sales Automation, Full Reports

Reference: §16.4 Phase 6, §8 and §8A.

### 6.1 Day-End Cash Reconciliation (backend-agent)
```
Use the backend-agent. Implement Section 8 — CashCustodyLog with the three-way
split (deposited/locker/taken home) that must sum to total cash collected, and
next-day carry-forward tracking for shortfalls. Stop before committing.
```
**Test:** submit a day-end entry where the three amounts DON'T sum to total cash collected — confirm rejection. Submit a valid one with a shortfall, confirm it carries forward correctly to the next day's expected amount.

**Commit:** `Add day-end cash reconciliation and custody tracking — Section 8`

### 6.2 ShiftSalesSummary + UPI Webhook (backend-agent)
```
Use the backend-agent. Implement Section 8A — ShiftSalesSummary for aggregate
walk-in sales, and the PhonePe or Paytm Business webhook handler for automated
UPI capture (Section 8A.3). Webhook handler must be idempotent (dedupe on
providerEventId) and verify the signature before trusting any payload — do not
skip this. Stop before committing.
```
**Test:** send a test webhook payload twice (simulating a duplicate delivery) and confirm it's only counted once. Send one with an invalid/missing signature and confirm it's rejected, not processed.

**Commit:** `Add ShiftSalesSummary and automated UPI webhook capture — Section 8A`

### 6.3 Full Report Suite (backend-agent)
```
Use the backend-agent. Implement the remaining reports from Section 12 that
aren't built yet (credit aging, loyalty program cost, gift redemption report,
GST-ready sales/purchase report, staff attendance summary). Stop before
committing.
```
**Test:** spot-check at least 3 of the reports against manual calculation from your test data — don't just confirm they return something, confirm the numbers are actually right.

**Commit:** `Add remaining reports from Section 12`

### 6.4 Web Portal UI: Cash Custody & Reports Screens *(interleaved — don't defer this)*
```
Use the backend-agent (owns apps/web-portal). Build the Web Portal screens for
6.1-6.3: day-end cash reconciliation form (with the three-way-split validation
visible on-screen, not just enforced silently on submit), cash custody status
view, and the full reports dashboard from Section 12. Wired to real APIs, no
mock data. Stop before committing.
```
**Test:** submit a day-end entry through the UI where the three-way split doesn't sum correctly — confirm the form itself blocks submission with a clear message, not just a backend 400 the user has to interpret. Cross-check at least 2 report screens against the manual calculations you already verified in 6.3.

**Commit:** `Add Web Portal cash custody and reports UI — Section 8, 12`

**🎯 Phase 6 complete when 6.1–6.4 all pass — this is full-featured v1** (§16.6).

---

## Phase 7 — Polish & Scale

This phase is genuinely open-ended (PWA offline refinement, multi-pump support, promotional loyalty campaigns) — don't try to pre-script it here. Come back to chat when you're ready to scope this one, since it depends on what you've actually learned from running Phases 1-6 for real.

---

## Troubleshooting Quick-Reference

Things we already solved once — check here before treating any of these as a new mystery:

| Symptom | Likely cause | Fix |
|---|---|---|
| `P1000: Authentication failed` from Prisma | Wrong/placeholder password in `.env`, or unencoded special characters | Copy the connection string fresh from Supabase's **Connect** dialog rather than hand-typing it |
| Backend health check shows `database: "down"` but Prisma CLI connects fine | NestJS reading a different `.env` than Prisma CLI (working-directory mismatch) | Confirm `ConfigModule` in `apps/backend` points at the root `.env`, not a local one |
| Docker Desktop stuck on "Starting the Docker Engine..." | WSL2 not updated, or virtualization disabled in BIOS | `wsl --update`, then a full reboot; check Task Manager → Performance → CPU shows Virtualization: Enabled |
| Random file-lock errors, slow `npm install`, weird sync conflicts | Project folder is inside a OneDrive-synced Desktop | Unlink Desktop from OneDrive backup (OneDrive Settings → Manage backup → turn off Desktop), then work from the real local path |
| `npm install` complains about `apps/*` missing `package.json` | Expected before that app is scaffolded | Ignore until Claude Code has actually scaffolded that app |
| Claude Code proposes editing a file outside the current agent's stated scope | Working as designed — both agent definitions are told to stop and flag this | Don't override it; figure out which agent should actually own that file first |

---

## When to actually come back to this chat

Everything above is meant to run without me. Come back specifically when:

- **A slice's test fails twice in a row** after you've told Claude Code exactly what broke both times — that's a sign of a design ambiguity, not a typo, and worth a second pair of eyes.
- **You're about to change anything in Section 2 (roles), Section 5A (payments), Section 6 (loyalty), or Section 8/8A (cash/reconciliation)** in a way that isn't already scripted in this playbook — these are the money-and-points-touching areas `CLAUDE.md` flags for human review, and "human review" for genuinely new logic should include a second opinion, not just you.
- **Something Claude Code reports contradicts `docs/master-plan.md`** — e.g. it says a section doesn't make sense, or it built something differently than specced because the spec seemed wrong. Don't let it quietly diverge from the doc; that's exactly what breaks "single source of truth."
- **A genuinely new requirement comes up** that isn't covered anywhere in the master plan (a feature idea, a regulatory requirement you just learned about, a competitor thing you want to match) — that needs to go into `docs/master-plan.md` first, then get its own playbook slice, not get improvised directly into code.
- **Before you go live with real transactions at the actual pump** — worth a final review pass together before real money and real customer data start flowing through it.
- **When your friend is actually ready to onboard** — a quick check that the `CLAUDE.md` team-split note (currently marked "solo" per our last change) gets reverted correctly and nothing you built solo accidentally drifted into what was meant to be their territory.

Otherwise — keep working the queue.
