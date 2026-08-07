#!/usr/bin/env node
// Dev dispatcher: `npm run dev <app>` starts that app's dev server.
//   npm run dev backend    -> NestJS API (watch)      apps/backend
//   npm run dev web         -> React/Vite web portal   apps/web-portal
//   npm run dev dsm         -> Expo DSM app            apps/dsm-app
//   npm run dev customer    -> Expo customer app       apps/customer-app
// Aliases in parentheses below also work. Cross-platform (Windows/macOS/Linux).
import { spawn } from 'node:child_process';

// name/alias -> { workspace, script }. `script` is the package.json script to run
// inside that workspace (backend uses start:dev; web uses dev; expo apps use start).
const APPS = {
  backend: { workspace: 'backend', script: 'start:dev' },
  web: { workspace: 'web-portal', script: 'dev' },
  'web-portal': { workspace: 'web-portal', script: 'dev' },
  dsm: { workspace: 'dsm-app', script: 'start' },
  'dsm-app': { workspace: 'dsm-app', script: 'start' },
  customer: { workspace: 'customer-app', script: 'start' },
  'customer-app': { workspace: 'customer-app', script: 'start' },
};

const target = process.argv[2];

if (!target) {
  console.error('Usage: npm run dev <app>');
  console.error('  apps: backend | web | dsm | customer');
  process.exit(1);
}

const app = APPS[target];
if (!app) {
  console.error(`Unknown app "${target}".`);
  console.error('  apps: backend | web | dsm | customer');
  process.exit(1);
}

// Any extra args after the app name are forwarded to the underlying script,
// e.g. `npm run dev dsm --android` -> expo start --android.
const passthrough = process.argv.slice(3);
const args = ['run', app.script, '--workspace', app.workspace];
if (passthrough.length) args.push('--', ...passthrough);

// shell:true so Windows resolves npm.cmd; stdio inherited so logs stream live.
const child = spawn('npm', args, { stdio: 'inherit', shell: true });
child.on('exit', (code) => process.exit(code ?? 0));
