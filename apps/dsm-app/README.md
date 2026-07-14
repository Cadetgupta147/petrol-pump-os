# dsm-app

React Native (Expo) app for field DSM (Daily Sales Man) staff. Owner: Person B
(mobile-agent). See root `CLAUDE.md` and `docs/master-plan.md` Section 4, 15.3.

## Status

Scaffolded with Expo (TypeScript template). Currently implements **one screen
only**: PIN login (`POST /auth/pin-login`), per Section 4's "PIN or biometric
login" feature (biometric not yet implemented). No offline sync
(WatermelonDB), no shift/meter-reading screens, no New Bill screen yet — those
are separate, later slices.

## Why Expo (not bare React Native)

Chosen for iteration speed for a 2-person team: no local Android
Studio/Xcode native project to maintain for this stage of development,
`expo start` + Expo Go (or a dev build later) gets you on a real device in
minutes, and `expo start --web` gives a fast local sanity-check loop without
any device/emulator at all. Section 15.3 only specifies "React Native," not
bare vs. Expo — Expo *is* React Native (it wraps the same RN runtime), and it
supports ejecting to bare workflow later if a native module ever needs it that
Expo's SDK doesn't cover (e.g. a specific Bluetooth ESC/POS receipt-printer
library, when that slice is built).

## Setup

```bash
# from the repo root (this is an npm workspace member)
npm install

cd apps/dsm-app
cp .env.example .env
# edit .env: set EXPO_PUBLIC_API_BASE_URL for your platform (see comments in the file)
```

## Running

You need the backend running first:

```bash
# from the repo root
npm run start:dev -w backend
# confirms with: "Backend listening on port 3000"
```

Then, in `apps/dsm-app`:

```bash
npm run start        # Metro bundler + Expo dev menu (pick android/ios/web from here)
npm run android       # requires Android Studio emulator or a device with Expo Go
npm run ios           # requires macOS + Xcode simulator
npm run web           # runs in a browser via react-native-web, no device/emulator needed
```

## Test login

There is no seed data for a DSM staff member by default (the repo's
`prisma/seed.ts` only seeds an Owner and an Accountant). To create one for
local testing:

```js
// one-off, e.g. via `node -e "..."` or a scratch script — do not commit
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');
const prisma = new PrismaClient();
prisma.staff
  .upsert({
    where: { phone: '9990000004' },
    update: { pinHash: await bcrypt.hash('1234', 10), active: true, role: 'DSM' },
    create: { name: 'Test DSM', phone: '9990000004', role: 'DSM', pinHash: await bcrypt.hash('1234', 10) },
  })
  .then(() => prisma.$disconnect());
```

Then log in on the PIN Login screen with phone `9990000004` / PIN `1234`.
