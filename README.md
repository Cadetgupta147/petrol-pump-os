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
- Docker (for local Postgres — see `docker-compose.yml`)
- For mobile: Android Studio (+ JDK 17) and, for iOS builds, Xcode on a Mac
- Claude Code (`curl -fsSL https://claude.ai/install.sh | bash`) — see `CLAUDE.md` for how this repo is set up to work with it

## First-time setup

```bash
cp .env.example .env          # fill in real values before running anything
docker compose up -d          # starts local Postgres
npm install                   # installs all workspaces
npx prisma migrate dev        # applies the schema to your local DB
```

Then start whichever app you're working on — see each `apps/*/README.md` once that app has been scaffolded.

## Status

This repo is currently a **scaffold**, not a working app. `apps/*` are empty placeholders — Phase 0/1 work (see `docs/master-plan.md` Section 16.4) is to scaffold the NestJS backend and the Prisma schema first, then the web portal.
