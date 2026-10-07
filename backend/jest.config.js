// Backend tests (client portal Stage 1, 2026-10-07). Run with `npm test`.
// Everything runs against the throwaway PostgreSQL from scripts/test-db.sh
// (started/stopped by the global setup/teardown) - never production; see
// test/setup/env.ts for the safety checks.
module.exports = {
  rootDir: '.',
  testMatch: ['<rootDir>/test/**/*.spec.ts', '<rootDir>/test/**/*.e2e-spec.ts'],
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json' }] },
  moduleFileExtensions: ['ts', 'js', 'json'],
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/test/setup/env.ts'],
  globalSetup: '<rootDir>/test/setup/global-setup.ts',
  globalTeardown: '<rootDir>/test/setup/global-teardown.ts',
  testTimeout: 60000,
  maxWorkers: 1,
};
