/**
 * Custom commands shared by every spec.
 *
 *  - cy.login(username, password)      signs in through the real login form.
 *  - cy.loginByApi(username, password, path)
 *                                      fast login: POST /auth/login, store the JWT in
 *                                      localStorage['acme_token'], then open `path`.
 *  - cy.apiLogin(username, password)   yields a JWT (cached per user for the spec).
 *  - cy.api(token, method, path, body) authenticated API call, yields the response body.
 *  - cy.createTeam(options)            creates a fresh manager + employees (unique names,
 *                                      reporting lines, work terms) and optionally a
 *                                      project for that manager. Used as test setup so
 *                                      every spec is independent and re-runnable.
 */
import { addDays, todayIso, uniqueId } from './utils';

export const TEST_PASSWORD = 'E2e-Test-Pass1';

const apiUrl = (path) => `${Cypress.expose('apiUrl')}/api/v1${path}`;
const tokenCache = new Map();

// A unique query string forces a full page load even when only the #route differs,
// so the app re-reads the token from localStorage (hash-only visits do not reload).
const freshUrl = (path) => `/?load=${Date.now()}#${path}`;

/** Seeded demo username for a role (admin | manager | employee). */
export const demoUser = (role) => Cypress.expose(`${role}User`);

/** Yields the seeded demo password (secret: CYPRESS_DEMO_PASSWORD, read via cy.env). */
Cypress.Commands.add('demoPassword', () =>
  cy.env(['DEMO_PASSWORD'], { log: false }).then(({ DEMO_PASSWORD: password }) => {
    if (!password) {
      throw new Error('Set CYPRESS_DEMO_PASSWORD to the seeded demo password (bin/test-e2e.sh does this).');
    }
    return password;
  }));

/** Runs fn(password), resolving the demo password when none was given. */
const withPassword = (password, fn) =>
  (password ? cy.wrap(password, { log: false }) : cy.demoPassword()).then(fn);

Cypress.Commands.add('apiLogin', (username, password) =>
  withPassword(password, (pw) => {
    const key = `${username}\u0000${pw}`;
    if (tokenCache.has(key)) return tokenCache.get(key);
    return cy
      .request({ method: 'POST', url: apiUrl('/auth/login'), body: { username, password: pw }, log: false })
      .then(({ body }) => {
        tokenCache.set(key, body.access_token);
        return body.access_token;
      });
  }));

Cypress.Commands.add('api', (token, method, path, body) =>
  cy
    .request({ method, url: apiUrl(path), body, headers: { Authorization: `Bearer ${token}` } })
    .its('body'));

/** Same as cy.api but never fails on HTTP errors; yields the whole response. */
Cypress.Commands.add('apiRaw', (token, method, path, body) =>
  cy.request({
    method,
    url: apiUrl(path),
    body,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    failOnStatusCode: false,
  }));

Cypress.Commands.add('login', (username, password) => {
  withPassword(password, (pw) => {
    cy.clearLocalStorage();
    cy.visit(freshUrl('/'));
    cy.findField('Username').clear().type(username);
    cy.findField('Password').clear().type(pw, { log: false });
    cy.contains('button', 'Sign in').click();
  });
});

Cypress.Commands.add('loginByApi', (username, password, path = '/') => {
  cy.apiLogin(username, password).then((token) => {
    cy.visit(freshUrl(path), {
      onBeforeLoad(win) {
        win.localStorage.setItem('acme_token', token);
      },
    });
    // Wait until the session is restored (the signed-in header renders). Navigating away
    // while GET /auth/me is still in flight aborts it, and the app treats that failure as
    // a logout and clears the token.
    cy.get('header button[aria-haspopup="menu"]').should('be.visible');
  });
});

/** Sign out through the account menu. */
Cypress.Commands.add('logout', () => {
  cy.get('header button[aria-haspopup="menu"]').click();
  cy.contains('[role="menuitem"]', 'Sign out').click();
});

/** The form control for a visible <label> (scoped to an optional parent). */
Cypress.Commands.add('findField', { prevSubject: 'optional' }, (subject, label) => {
  const scope = subject ? cy.wrap(subject) : cy.root();
  return scope
    .contains('label', new RegExp(`^${Cypress._.escapeRegExp(label)}$`))
    .invoke('attr', 'for')
    .then((id) => cy.get(`#${id}`));
});

/** The open modal dialog with the given title. */
Cypress.Commands.add('dialog', (title) =>
  cy.get(`[role="dialog"][aria-label="${title}"]`).should('be.visible'));

/** The main-navigation link with the given text. */
Cypress.Commands.add('navLink', (label) => cy.get('nav[aria-label="Main"]').contains('a', label));

/** The table row (<tr>) containing the given text. */
Cypress.Commands.add('rowContaining', { prevSubject: 'optional' }, (subject, text) => {
  const scope = subject ? cy.wrap(subject) : cy.root();
  return scope.contains('tr', text);
});

/**
 * Create an isolated team for a test, all through the API as the seeded admin:
 * one manager, `employees` employees reporting to them, work terms for each,
 * and optionally a project managed by the new manager.
 */
Cypress.Commands.add('createTeam', ({ employees = 1, project = false, hourlyRate = '50.00', budget = '100000.00' } = {}) => {
  const id = uniqueId();
  const today = todayIso();
  const team = { id, today, password: TEST_PASSWORD, employees: [] };

  cy.apiLogin(demoUser('admin')).then((adminToken) => {
    team.adminToken = adminToken;
    const person = (role, first, n = '') => ({
      username: `e2e.${role}${n}.${id}`,
      email: `e2e.${role}${n}.${id}@example.com`,
      first_name: first,
      last_name: `E2E${id}${n}`,
      job_title: `E2E ${role}`,
      role,
      password: TEST_PASSWORD,
    });

    cy.api(adminToken, 'POST', '/users', person('manager', 'Morgana')).then((manager) => {
      team.manager = manager;
    });
    Cypress._.times(employees, (i) => {
      cy.api(adminToken, 'POST', '/users', person('employee', ['Emery', 'Quinn', 'Rowan'][i] || 'Sky', i + 1)).then((employee) => {
        team.employees.push(employee);
        cy.api(adminToken, 'POST', `/managers/${team.manager.id}/employees`, { employee_id: employee.id });
        cy.api(adminToken, 'POST', `/employees/${employee.id}/work-terms`, {
          hourly_rate: hourlyRate,
          weekly_hours: '40',
          effective_from: today,
        });
      });
    });
    if (project) {
      cy.then(() =>
        cy.api(adminToken, 'POST', '/projects', {
          name: `E2E Project ${id}`,
          description: 'Created by Cypress',
          manager_id: team.manager.id,
          start_date: today,
          estimated_end_date: addDays(today, 120),
          estimated_budget: budget,
        }).then((created) => {
          team.project = created;
        }));
    }
  });
  return cy.then(() => team);
});
