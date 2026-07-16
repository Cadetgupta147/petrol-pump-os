# web-portal

React + Vite dealer/accountant web portal. See root `CLAUDE.md` and `docs/master-plan.md` Section 1.2, 15.2.

## Setup

```
cd apps/web-portal
npm install
cp .env.example .env   # edit VITE_API_BASE_URL if the backend isn't on localhost:3000
npm run dev
```

Requires `apps/backend` running (see its README) and seeded (`npm run prisma:seed` from the repo root) so there's a Staff row to log in with:

- Owner: phone `9990000001` / password `Owner@12345`
- Accountant: phone `9990000002` / password `Accountant@12345`

## What's real vs not yet wired

Every screen calls a real backend endpoint — nothing here is a mock. But several dashboard widgets you might expect (loyalty liability, tanker deliveries, lubricant/urea sale, generator diesel, daily expenses, staff on duty, machine testing) don't have a backend service yet, even though some of their Prisma models already exist (`LoyaltyConfig`, `PurchaseEntry`, `LubricantItem`, `AttendanceLog`). Those show up in the "Not wired to a backend endpoint yet" panel on the dashboard rather than being faked with placeholder numbers.

Known real limitations, not bugs:

- `/dashboard/sales-summary` has no date-range parameter, so the date tabs (Today/Yesterday/This week/This month) only let you pick Today — the others are visibly disabled with a tooltip explaining why.
- The petrol/diesel sales split is computed client-side from `GET /bills` (no server-side product filter exists yet), which pulls every non-deleted bill ever entered. Fine for now, won't scale with years of history — see the footnote on the dashboard itself.
- Meter-vs-billed variance (`GET /meter-readings/:id/variance`) approximates "litres billed during this shift" by matching `enteredById` + timestamp window, since `Bill` has no `nozzleId`/`shiftId` foreign key yet (see `meter-readings.service.ts`).
- "Credit limit alerts" means bills that exceeded a customer's limit under `NOTIFY` mode — not an aging/overdue check, since the schema has no due-date concept.
- `npm run lint` has no ESLint config file yet — the script is wired but unconfigured.

## Pages

| Route | Backend endpoint(s) |
|---|---|
| `/login` | `POST /auth/login` |
| `/dashboard` | `/dashboard/sales-summary`, `/dashboard/tank-stock`, `/dashboard/recent-bills`, `/credit-alerts`, `/meter-readings`, `/meter-readings/:id/variance`, `/bills`, `/tally-export/xml` |
| `/customers` | `GET /customers` |
| `/customers/:id` | `GET /customers/:id/ledger` |
| `/bills/:id` | `GET /bills/:id` |

`Billing`, `Meter readings`, `Loyalty`, `Inventory`, `Staff`, `Reports`, `Cash custody`, `Settings` are listed in the nav (matching `docs/master-plan.md`'s intended shape) as inert labels — no page exists for them yet.
