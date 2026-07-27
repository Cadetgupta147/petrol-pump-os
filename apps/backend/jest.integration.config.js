// Separate Jest config for test/integration/*.spec.ts — real-database
// integration tests that hit the actual Supabase dev DB, as opposed to the
// default `npm test` run (package.json's embedded "jest" config, rootDir
// "src"), which mocks PrismaService everywhere and never touches a real
// database. Kept as its own config/command (`npm run test:integration`)
// rather than folded into the default run so routine local/CI test runs
// stay fast and don't depend on external DB reachability — see the header
// comment on test/integration/owner-lockout-race.integration.spec.ts for the
// full reasoning.
//
// rootDir is the repo root ('.'), not 'src', since these specs live outside
// src/ and import from it via relative paths (e.g. '../../src/...').
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: 'test/integration/.*\\.spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  testEnvironment: 'node',
};
