/** Integration tests need PostgreSQL (`npm run db:up`). Each run creates and drops its own pas_test_<ts> database. */

// ESM-only dependencies of sanitize-html. Node 22+ can require() them natively; Jest's CommonJS runtime cannot,
// so they are transpiled for tests only.
const ESM_PACKAGES = ['htmlparser2', 'domhandler', 'domutils', 'dom-serializer', 'entities', 'domelementtype'];

module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/test'],
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json' }],
    '^.+\\.js$': ['ts-jest', { tsconfig: { allowJs: true, module: 'commonjs', target: 'ES2022', esModuleInterop: true }, diagnostics: false }],
  },
  transformIgnorePatterns: [`/node_modules/(?!(${ESM_PACKAGES.join('|')})/)`],
  globalSetup: '<rootDir>/test/global-setup.ts',
  globalTeardown: '<rootDir>/test/global-teardown.ts',
  setupFiles: ['<rootDir>/test/env.ts'],
  testTimeout: 30000,
};
