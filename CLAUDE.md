# CLAUDE.md — Petrol Pump Management Software

This file is read automatically by Claude Code at the start of every session in this repo. Keep it accurate as decisions change — it's the ground rules, not documentation of features (that's `docs/master-plan.md`).

## Before doing anything

- Read `docs/master-plan.md` for the feature spec. Reference it by section number in prompts (e.g. "implement Section 6.4 exactly as specced") rather than re-describing features from scratch.
- If a prompt conflicts with `docs/master-plan.md`, flag the conflict instead of silently picking one.

## Project shape

One NestJS backend + Postgres, three frontends (React web PWA, two React Native apps), one Prisma schema as source of truth. Monorepo, npm workspaces. See `docs/master-plan.md` Section 15 for full stack and Section 16.2 for repo layout.

- **Postgres is hosted on Supabase — there is no local/Docker database.** Never try to start Docker Desktop or a Postgres container; the backend connects to Supabase via `DATABASE_URL` in `.env`. To run the stack locally, just start the backend (`npm run start:dev` in `apps/backend`) — if the DB is unreachable, check the network/Supabase project status, not local services.

```
apps/{backend,web-portal,dsm-app,customer-app}
packages/{shared-types,ui-components}
docs/master-plan.md
prisma/schema.prisma
```

## Two specialist agents

This repo defines two custom subagents in `.claude/agents/`:

- **backend-agent** — owns `apps/backend`, `apps/web-portal`, `prisma/`. Maps to "Person A" in Section 16.1.
- **mobile-agent** — owns `apps/dsm-app`, `apps/customer-app`. Maps to "Person B" in Section 16.1.

Each person should run their own Claude Code session (own Pro subscription) and invoke the matching agent for their layer, rather than one account running both personas — running two agents in parallel on a single Pro plan burns the 5-hour usage window twice as fast. Neither agent is authorized to merge money-or-points-touching code without human review — see the rule below.

## Hard rules

- **Never hand-edit the database schema.** Always use Prisma migrations (`prisma migrate dev`). Schema changes go through `prisma/schema.prisma` only.
- **Never trust the frontend to enforce permissions.** Every role check (Section 2 of the plan) must be enforced server-side, on every endpoint, regardless of what the UI hides.
- **Never commit secrets.** API keys, DB URLs, and provider credentials live in `.env`, which is gitignored. If you add a new credential, add a placeholder to `.env.example` in the same commit.
- **Work in vertical slices.** One feature = DB table → API endpoint → UI screen, done together and committed together. Don't build all tables, then all endpoints, then all screens.
- **Commit after every working slice**, not at the end of a session.
- **Anything touching money or points is human-reviewed before merge** — bill amounts, split payment lines, loyalty point calculation, cash custody, redemption logic, and the payment flow once it exists. No auto-merge on this code, whether written by a human prompt or an agent.
- **Split payments must balance server-side.** A `Bill`'s `BillPaymentLine` rows must satisfy `sum(IN) − sum(OUT) = bill.amount` (Section 5A) — enforce this in the API, don't just disable a Save button in the UI.
- **Webhook handlers must be idempotent and signature-verified.** The PhonePe/Paytm UPI webhook (Section 8A.3) can arrive late, out of order, or duplicated — dedupe on `providerEventId` and verify the signature before trusting any payload.
- **Write tests for rule-heavy logic** after building it: loyalty point calculation, cash reconciliation validation, stock variance flagging, split-payment balancing, webhook idempotency.

## Open items not yet decided (don't hardcode a guess — surface it if it blocks you)

Tracked in `docs/master-plan.md` Section 17:

- Payment gateway for the customer app's **in-app** "Pay Now" (remote credit repayment) — still not chosen. **Note: this is separate from counter UPI capture, which is now resolved** — see below.
- PhonePe vs. Paytm Business as the merchant webhook provider for automated UPI capture (Section 8A.3) — mechanism is decided, specific provider isn't yet.
- Loyalty earning basis default (rupee vs. litre) and default rate
- Redemption type at launch (cash-only / gift-only / both), and whether customers get to choose per-redemption or the dealer fixes a default (Section 6.4)
- OCR provider (Google Cloud Vision vs. AWS Textract)
- Tally export approach (file export vs. API push) — defaulted to `"file"` in `.env.example` per the Phase 2 recommendation
- WhatsApp Business API provider
- Receipt printer hardware model

**Resolved since the plan update:** counter-side UPI collection for walk-in customers doesn't need a payment gateway (Razorpay/Cashfree) — it's captured via a free PhonePe/Paytm Business merchant webhook instead (Section 8A.3). Card payments at the counter stay manual through Phase 5; real-time card automation is deliberately deferred, not planned for this build.

## Known gaps to close before the relevant phase

- **Data privacy handling** for customer phone numbers / KYC-lite profiles — needs a line on compliance with India's DPDP Act before Phase 3 (loyalty program) collects real customer data.
- **Error monitoring** (e.g. Sentry) — not in the current stack; add before Phase 2. `.env.example` has a placeholder for `SENTRY_DSN`.
- **Secrets management approach** — `.env` + gitignore for now (2-person team); revisit if the team grows.
- **App store accounts** — Google Play Developer + Apple Developer accounts should exist before Phase 2 build starts, not at submission time.

## Team split

Currently solo: one person covering both backend-agent and mobile-agent roles until a 
second person onboards (see docs/master-plan.md Section 16.1 for the intended split).
Work sequentially, not in parallel — don't run backend-agent and mobile-agent sessions 
at the same time, since it's the same Pro subscription and usage window either way.
Mobile app work (Phase 2+) shouldn't start until the backend has a stable API contract 
to build against — see Section 16.4 phase order.