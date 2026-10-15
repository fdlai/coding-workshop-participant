/** Jest + React Testing Library setup for component and API service tests. */
module.exports = {
  testEnvironment: 'jsdom',
  roots: ['<rootDir>/src'],
  setupFiles: ['<rootDir>/src/test/polyfills.js'],
  setupFilesAfterEnv: ['<rootDir>/src/test/setup.js'],
  moduleNameMapper: {
    '\.(css|svg|png|jpg)$': 'identity-obj-proxy',
  },
  collectCoverageFrom: ['src/**/*.{js,jsx}', '!src/main.jsx', '!src/test/**'],
  coverageReporters: ['text-summary', 'text', 'html'],
  coverageThreshold: {
    global: { statements: 80, branches: 80, functions: 80, lines: 80 },
  },
};
