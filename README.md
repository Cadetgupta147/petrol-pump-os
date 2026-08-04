# Petrol Pump OS

Monorepo for petrol pump management software: one NestJS backend + Postgres, three frontends (dealer/accountant web PWA, DSM field app, credit customer app).

**New here? Read these two files first:**
1. [`docs/master-plan.md`](docs/master-plan.md) — the full feature spec. Reference sections by number (e.g. "Section 6.4") instead of re-describing features.
2. [`CLAUDE.md`](CLAUDE.md) — project rules and conventions, especially if you're using Claude Code.

## Repo layout

```
apps/
  backend/        NestJS API — owns the database, all business logic
  web-portal/     React + Vite PWA — dealer (mobile) + accountant (desktop)
  dsm-app/        React Native — field staff, offline-first
  customer-app/   React Native — loyalty/credit customers
packages/
  shared-types/   TypeScript types shared across all four apps (currently unused — see Status)
  ui-components/  Shared React components, web-portal only for now (currently unused — see Status)
docs/
  master-plan.md  Full feature spec — reference by section number
prisma/
  schema.prisma   Single source of truth for the database schema
```

## Prerequisites

- Node.js 22 LTS (`nvm install 22 && nvm use 22`)
- A Supabase project (free tier works) — get `DATABASE_URL` and `DIRECT_URL` from Settings → Database → Connect
- For mobile work: Android Studio + JDK 17 (iOS builds also need Xcode, Mac only)
- Claude Code, if you're using it — `curl -fsSL https://claude.ai/install.sh | bash` (see `CLAUDE.md` for how this repo is set up for it)

> **No Docker, no local Postgres.** The database lives on Supabase. If it's unreachable, check the Supabase project status — don't try to start a local DB.

## First-time setup

```bash
cp .env.example .env          # fill in real values before running anything
npm install                   # installs all workspaces
npx prisma migrate dev        # applies the schema to your Supabase DB
```

## Running an app

Every app below is a real, working codebase (only `packages/shared-types` and `packages/ui-components` are still empty placeholders):

```bash
npm run start:dev --workspace apps/backend    # NestJS API — http://localhost:3000
npm run dev --workspace apps/web-portal       # React + Vite PWA — http://localhost:5173
npm run start --workspace apps/dsm-app        # Expo — DSM field app
npm run start --workspace apps/customer-app   # Expo — credit customer app
```

The backend needs `DATABASE_URL`/`DIRECT_URL` (Supabase) no matter which app you're running. The two mobile apps also need `API_BASE_URL`/`EXPO_PUBLIC_*` pointed at a running backend — see `.env.example`.

## Secrets

- All credentials (DB URLs, JWT secrets, encryption keys, OCR/storage/push/SMS/WhatsApp keys) are env vars only — see `.env.example` for the full list.
- `.env` is gitignored and has never been committed (verified 2026-07-29 across all history).
- Added a new credential? Add a placeholder for it to `.env.example` in the same commit — see the hard rule in `CLAUDE.md`.
- **If a real secret ever leaks into a commit:** rotate it immediately at the provider (Supabase, Google Cloud, WhatsApp, etc.). Removing it from the file or force-pushing is not enough — it's still recoverable from git history/reflogs/forks.

## Status

This is a working, live multi-tenant app running at more than one real pump — not a scaffold. See `prisma/provision-pump.cts` and `docs/multi-tenancy-plan.md` for the multi-tenancy setup.

Against `docs/master-plan.md` Section 16.4's phased roadmap:

| Phase | Status |
|---|---|
| 1–6 | **Built.** Bill entry with split payments (5A), meter readings with variance handling (3.3), credit customers with limits/blacklisting (3.4), full loyalty program (6), tank/purchase/OCR inventory (7), cash custody + UPI reconciliation (8/8A), Tally export, reports (12) |
| 7 (polish/scale) | **Partially done.** Multi-pump support exists; PWA offline refinement and advanced analytics don't yet |

One known gap: `packages/shared-types` and `packages/ui-components` are still unused. Each app defines its own local copies of shared shapes (e.g. `Bill`) — pulling the duplication into `shared-types` hasn't happened yet.

## What's still open

Don't re-derive these from scratch — read them first:

- `CLAUDE.md` → "Open items not yet decided" and "Known gaps to close" (payment gateway choice, PhonePe vs. Paytm, loyalty defaults, DPDP compliance, error monitoring, etc.)
- `docs/production-readiness.md` — a point-in-time security/go-live audit (2026-07-22). Treat as a lead, not current truth — some items it lists as unbuilt are done now. Verify against the code before acting on anything in it.
- `docs/master-plan.md` Section 17 (Open Decisions/Risks) and Section 18 (Go-Live Readiness Checklist)
