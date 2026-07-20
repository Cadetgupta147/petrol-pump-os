# customer-app

React Native (Expo) app for credit/loyalty customers. Owner: Person B
(mobile-agent). See root `CLAUDE.md` and `docs/master-plan.md` Section 5, 15.3.

## Status

Scaffolded with Expo (TypeScript template), mirroring `apps/dsm-app`'s
structure/conventions. Implements **phone number + OTP login** (client side
only — see "Backend gap" below) plus, once logged in, a real dashboard:
**Home, Bill History, and Rewards (gift catalog + redemption)**, per
`docs/master-plan.md` Section 5, 6.4, and 14, wired against the live
`apps/backend/src/customer-portal/` module. Push notifications, SMS/WhatsApp
fallback, the Profile tab, and an actual UPI "Pay Now" payment flow are still
out of scope — none of those are backend-supported yet either.

## Screens

- `src/screens/PhoneEntryScreen.tsx` — collect + validate phone number, request OTP
- `src/screens/OtpEntryScreen.tsx` — enter the OTP, verify, resend (with a client-side cooldown display only — see note below)
- `src/screens/CustomerPortalShell.tsx` — the logged-in shell: owns the `/me`, `/bills`, and `/gift-catalog` fetches and switches between three tabs via local state (no navigation library, same pattern as `App.tsx`)
- `src/screens/HomeScreen.tsx` — greeting, points balance + cash/gift-equivalent subtext, outstanding-due card ("Pay Now" is a "coming soon" notice, not a real payment — see below), redeem-section entry cards, recent bills preview
- `src/screens/BillHistoryScreen.tsx` — full itemized bill history
- `src/screens/GiftCatalogScreen.tsx` — gift catalog (affordable/locked states) plus the cash-discount-switch panel, only shown when the pump allows it
- `src/api/customerPortalApi.ts` — authenticated (Bearer token) GET/POST client for the four `/customer-portal/*` routes
- `src/lib/customerPortalFormat.ts` — pure formatting/derivation helpers (Indian-digit-grouped numbers, bill timestamp labels, redemption request shaping, points clamping), unit tested in the sibling `.test.ts` file

### Deviations from the Section 14 mockups (flagged, not silently dropped)

- The home mockup's "Link your physical QR loyalty card" banner is **not**
  built — there's no backend endpoint for it, and it's outside the
  customer-portal module's four-route contract this slice was built against.
- The mockup shows "Nozzle 2" on each bill row; `Bill` has no nozzle field in
  the schema, so bill rows show date/time + product type + litres instead.
- "Pay Now" does not attempt any payment. The customer app's in-app payment
  gateway is an explicitly open decision (`CLAUDE.md`/Section 17), so the
  button shows an inline "coming soon" notice on tap rather than a silent
  no-op or a broken checkout flow.

## IMPORTANT — backend gap, flagged per task instructions

`docs/master-plan.md` Section 5 specifies only:

> Login via phone number + OTP — No password to remember, no heavy signup

It does **not** specify:
- The OTP delivery mechanism/provider (SMS gateway? Firebase Phone Auth? WhatsApp OTP?) — no OTP-specific provider is named anywhere in the plan or `CLAUDE.md`'s open-items list (Section 17 only lists an SMS gateway in the context of the *notification* fallback, Section 11, not login).
- OTP length, expiry window, or resend/rate-limit policy.
- The session/token shape for **customers** as opposed to Staff. The backend today (`apps/backend/src/auth`) has `POST /auth/login` (web portal Staff) and `POST /auth/pin-login` (DSM Staff PIN), both issuing a Staff-scoped JWT (`{ staffId, role, sub }`) via a single `JwtStrategy`. There is no customer-scoped auth anywhere yet.
- The `prisma/schema.prisma` `Customer` model has `phone` (nullable, unique) but **no OTP-related fields or table** (no `CustomerOtp`/code hash/expiry/attempt-count model).

**These backend endpoints do not exist.** `src/api/customerAuthApi.ts` implements a placeholder client contract (`POST /auth/customer/otp/request`, `POST /auth/customer/otp/verify`) built by analogy to the existing PIN-login pattern, so the mobile-side screens/flow aren't blocked on a backend decision — but every call against a real backend will 404 until backend-agent builds this. Do **not** treat the assumed contract as final; it needs a real decision + implementation, which includes (backend-agent territory, not touched here):
- A Prisma migration adding an OTP/verification model.
- A customer-scoped JWT guard/strategy, distinct from the Staff one (a customer token must never work against Staff-only endpoints, and vice versa).
- Actual OTP delivery integration.
- Server-side rate limiting on both request and verify — the resend cooldown timer in `OtpEntryScreen.tsx` is a UX nicety only, not a security control (per `CLAUDE.md`: never trust the frontend to enforce a control that matters).

## Other assumptions made (flagged, not spec)

- Phone number validated client-side as a 10-digit Indian mobile number (`^[6-9]\d{9}$`), matching the convention already used for `Staff.phone` elsewhere in this codebase. Section 5 doesn't specify a format.
- OTP entry is a 6-digit numeric code. Not specified in the plan.
- `packages/shared-types` is still unscaffolded (no `package.json`/`src`, just a README) — matching `apps/dsm-app`'s existing convention, this app defines its own local type mirrors (`CustomerSummary`, `RequestOtpResponse`, `VerifyOtpResponse` in `customerAuthApi.ts`) rather than importing from the shared package. Worth revisiting once backend-agent and mobile-agent agree on the real customer OTP contract — that would be a natural first thing to put in `shared-types`.

## Why Expo (not bare React Native)

Same reasoning as `apps/dsm-app` — see that app's README.

## Setup

```bash
# from the repo root (this is an npm workspace member)
npm install

cd apps/customer-app
cp .env.example .env
# edit .env: set EXPO_PUBLIC_API_BASE_URL for your platform (see comments in the file)
```

## Running

```bash
npm run start        # Metro bundler + Expo dev menu (pick android/ios/web from here)
npm run android       # requires Android Studio emulator or a device with Expo Go
npm run ios           # requires macOS + Xcode simulator
npm run web           # runs in a browser via react-native-web, no device/emulator needed
```

Login will not succeed end-to-end against a real backend yet — see "Backend
gap" above. The phone entry and OTP entry screens themselves render and
validate input without a backend; verifying will fail with a "can't reach the
server" / 404-derived error until the real endpoints exist.
