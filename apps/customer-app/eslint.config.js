import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

// React Native / Expo (Metro) doesn't run in a browser or in Node — it has its
// own JS global environment (Hermes + the RN polyfills). `globals` (the npm
// package) ships browser/node/etc. sets but nothing RN-specific, so this list
// is taken from `@react-native/eslint-config`'s `shared.js` globals map,
// pinned to this app's RN version (0.86.0), converted from the legacy
// `{ Name: canBeRedefined }` shape to flat-config's `'readonly' | 'writable'`.
// (Mirrors apps/dsm-app/eslint.config.js — same RN version, same config.)
const reactNativeGlobals = {
  __DEV__: 'writable',
  __dirname: 'readonly',
  __fbBatchedBridgeConfig: 'readonly',
  AbortController: 'readonly',
  Blob: 'writable',
  alert: 'readonly',
  cancelAnimationFrame: 'readonly',
  cancelIdleCallback: 'readonly',
  clearImmediate: 'writable',
  clearInterval: 'readonly',
  clearTimeout: 'readonly',
  console: 'readonly',
  document: 'readonly',
  ErrorUtils: 'readonly',
  escape: 'readonly',
  Event: 'readonly',
  EventTarget: 'readonly',
  exports: 'readonly',
  fetch: 'readonly',
  File: 'writable',
  FileReader: 'readonly',
  FormData: 'readonly',
  global: 'readonly',
  Headers: 'readonly',
  Intl: 'readonly',
  Map: 'writable',
  module: 'readonly',
  navigator: 'readonly',
  process: 'readonly',
  Promise: 'writable',
  requestAnimationFrame: 'writable',
  requestIdleCallback: 'writable',
  require: 'readonly',
  Set: 'writable',
  setImmediate: 'writable',
  setInterval: 'readonly',
  setTimeout: 'readonly',
  queueMicrotask: 'writable',
  URL: 'readonly',
  URLSearchParams: 'readonly',
  WebSocket: 'writable',
  window: 'readonly',
  XMLHttpRequest: 'readonly',
};

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      '.expo/**',
      'web-build/**',
      'ios/**',
      'android/**',
      'expo-env.d.ts',
    ],
  },
  {
    // src/** covers screens/api/storage; App.tsx and index.ts are the Expo
    // entry files that live at the app root, outside src/.
    extends: [js.configs.recommended, ...tseslint.configs.recommendedTypeChecked],
    files: ['src/**/*.{ts,tsx}', '*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2021,
      globals: reactNativeGlobals,
      parserOptions: {
        project: ['./tsconfig.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
    },
  },
  {
    files: ['src/**/*.{spec,test}.{ts,tsx}'],
    languageOptions: {
      globals: globals.jest,
    },
  },
);
