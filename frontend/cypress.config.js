import { defineConfig } from 'cypress';

/**
 * End-to-end tests run the real UI against the real FastAPI backend and a
 * dedicated PostgreSQL database (acme_e2e). Start everything with
 * `./bin/test-e2e.sh` from the repo root, or point an already-running stack
 * at it with CYPRESS_BASE_URL / CYPRESS_API_URL / CYPRESS_DEMO_PASSWORD.
 */
export default defineConfig({
  e2e: {
    baseUrl: 'http://localhost:5173',
    specPattern: 'cypress/e2e/**/*.cy.js',
    supportFile: 'cypress/support/e2e.js',
    // Desktop width so the top navigation is visible (it collapses below 1024px).
    viewportWidth: 1366,
    viewportHeight: 900,
    defaultCommandTimeout: 10000,
    // Logins are deliberately slow (PBKDF2), so allow API calls some headroom.
    requestTimeout: 15000,
    responseTimeout: 30000,
    video: false,
    screenshotOnRunFailure: true,
    retries: 0,
    // Non-secret values (Cypress.expose). The demo password is secret and is read with
    // cy.env(['DEMO_PASSWORD']) from CYPRESS_DEMO_PASSWORD instead.
    expose: {
      // Overridable with CYPRESS_API_URL; must match the backend the UI talks to.
      apiUrl: process.env.CYPRESS_API_URL || 'http://127.0.0.1:8000',
      // Seeded demo accounts (backend/acme-api/scripts/seed_data.py).
      adminUser: 'demo.avery.brooks',
      managerUser: 'demo.morgan.hayes',
      employeeUser: 'demo.liam.anderson',
    },
  },
});
