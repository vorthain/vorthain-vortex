/** @type {import('jest').Config} */
const config = {
  testEnvironment: 'node',
  setupFilesAfterEnv: ['./jest.setup.cjs'],

  // Coverage collection
  collectCoverageFrom: ['src/**/*.js', 'index.js', '!src/**/*.test.js', '!src/tests/**/*'],

  // Coverage thresholds for auto-publishing
  coverageThreshold: {
    global: {
      branches: 60,
      functions: 75,
      lines: 75,
      statements: 75,
    },
  },

  // Coverage reporters
  coverageReporters: ['text', 'lcov', 'html'],
};

module.exports = config;
