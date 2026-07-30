# Petrol Pump OS

Monorepo for the petrol pump management software: one NestJS backend + Postgres, three frontends (dealer/accountant web PWA, DSM field app, credit customer app).

Full feature spec lives in [`docs/master-plan.md`](docs/master-plan.md) — read that before implementing anything. Project conventions for Claude Code live in [`CLAUDE.md`](CLAUDE.md).

## Repo layout

```
apps/
  backend/        NestJS API — owns the database, all business logic
  web-portal/     React + Vite PWA — dealer (mobile) + accountant (desktop)
  dsm-app/        React Native — field staff, offline-first
  customer-app/   React Native — loyalty/credit customers
packages/
  shared-types/   TypeScript types shared across all four apps
  ui-components/  Shared React components (web-portal only, for now)
docs/
  master-plan.md  Full feature spec — reference by section number
prisma/
  schema.prisma   Single source of truth for the database schema
```

## Prerequisites

- Node.js 22 LTS (`nvm install 22 && nvm use 22`)
- A Supabase project (free tier) — get DATABASE_URL and DIRECT_URL from Settings → Database → Connect
- For mobile: Android Studio (+ JDK 17) and, for iOS builds, Xcode on a Mac
- Claude Code (`curl -fsSL https://claude.ai/install.sh | bash`) — see `CLAUDE.md` for how this repo is set up to work with it

## First-time setup

```bash
cp .env.example .env          # fill in real values before running anything
npm install                   # installs all workspaces
npx prisma migrate dev        # applies the schema to your local DB
```

Then start whichever app you're working on (there's no per-app `README.md` yet — `packages/shared-types`/`packages/ui-components` are the only still-empty placeholders in this repo; every app below is a real, working codebase):

```bash
npm run start:dev --workspace apps/backend    # NestJS API — http://localhost:3000
npm run dev --workspace apps/web-portal       # React + Vite PWA — http://localhost:5173
npm run start --workspace apps/dsm-app        # Expo — DSM field app
npm run start --workspace apps/customer-app   # Expo — credit customer app
```

The two mobile apps need a running backend to talk to (`API_BASE_URL`/`EXPO_PUBLIC_*` — see `.env.example`); the backend needs `DATABASE_URL`/`DIRECT_URL` pointed at your Supabase project regardless of which app you're running.

## Secrets

All credentials (DB URLs, `JWT_SECRET`/`CUSTOMER_JWT_SECRET`, `CREDENTIAL_ENCRYPTION_KEY`, OCR/storage/push/SMS/WhatsApp keys) are env vars only — see `.env.example` for the full list. `.env` is gitignored and has never been committed in this repo's history (verified 2026-07-29 across all 95 commits and the full working tree — no API key, password, token, or connection string was found hardcoded anywhere in source).

**If a real secret is ever accidentally committed** (to this repo or a fork), treat it as compromised the moment it's pushed, even if the commit is later reverted or force-pushed away — it remains recoverable from git history/reflogs/forks. Rotate it immediately at the provider (Supabase, Google Cloud, WhatsApp provider, etc.) rather than just removing it from the file.

## Status

Past the scaffold stage — this is a working app, live at more than one real pump (multi-tenant: see `prisma/provision-pump.cts` and `docs/multi-tenancy-plan.md`), not a Phase 0/1 skeleton. Against `docs/master-plan.md` Section 16.4's phased roadmap:

- **Phases 1–6 are built**, not just started: manual + DSM-app bill entry with split payments and per-pump bill numbering (Section 5A), meter readings with shift-schedule/rollover/variance handling (3.3), credit customers with informal quick-add, limit enforcement, and vehicle/company blacklisting (3.4/3.4A/3.4B), the full loyalty program (QR cards, earning basis, cash/gift redemption — Section 6), tank/purchase-entry/OCR/Rate Master/density-log inventory (Section 7), day-end cash custody and walk-in sales reconciliation with automated UPI capture (Section 8/8A), Tally export, and the report suite (Section 12).
- **Phase 7 (polish/scale) is partially in progress**: multi-pump support already exists; PWA offline refinement and advanced analytics don't yet.
- `packages/shared-types` and `packages/ui-components` are still the only unused placeholders in the repo — each app currently defines its own local copy of shared shapes (e.g. `Bill`) rather than importing a common one; a real "pull the duplication into `packages/shared-types`" pass hasn't happened yet.

**What's still open, and where it's tracked (don't re-derive this from scratch — read these first):**
- `CLAUDE.md`'s "Open items not yet decided" and "Known gaps to close" sections — the current, maintained list (payment gateway choice, PhonePe vs. Paytm, loyalty defaults, DPDP compliance, error monitoring, etc.).
- `docs/production-readiness.md` — a point-in-time security/go-live audit (2026-07-22). Treat it as a lead, not current truth: some items it lists as unbuilt (e.g. the web portal's Billing Register/Meter Readings/Staff/Settings modules) are done now — verify against the actual code before acting on any item in it.
- `docs/master-plan.md` Section 17 (Open Decisions/Risks) and Section 18 (Go-Live Readiness Checklist).
