import { demoUser } from '../support/commands';

// Critical path: sign in / sign out for every role, failed login, session restore.
describe('Authentication', () => {
  const roles = [
    { role: 'admin', home: '/admin', heading: 'Admin Dashboard' },
    { role: 'manager', home: '/manager', heading: 'Manager Dashboard' },
    { role: 'employee', home: '/employee', heading: 'My Dashboard' },
  ];

  roles.forEach(({ role, home, heading }) => {
    it(`${role} signs in through the form, lands on their dashboard and signs out`, () => {
      cy.login(demoUser(role));
      cy.location('hash').should('eq', `#${home}`);
      cy.contains('h1', heading).should('be.visible');
      cy.get('header').contains(role, { matchCase: false }).should('be.visible');
      cy.window().its('localStorage.acme_token').should('be.a', 'string');

      cy.logout();
      cy.location('hash').should('eq', '#/');
      cy.contains('h2', 'Welcome back').should('be.visible');
      cy.window().its('localStorage.acme_token').should('be.undefined');

      // Protected pages are no longer reachable after sign-out.
      cy.visit(`/#${home}`);
      cy.location('hash').should('eq', '#/');
      cy.contains('button', 'Sign in').should('be.visible');
    });
  });

  it('rejects a wrong password with an error and stays on the login page', () => {
    cy.login(demoUser('manager'), 'definitely-not-the-password');
    cy.get('[role="alert"]').should('be.visible').and('contain', 'Incorrect username or password');
    cy.location('hash').should('eq', '#/');
    cy.window().its('localStorage.acme_token').should('be.undefined');
    cy.contains('button', 'Sign in').should('be.enabled');
  });

  it('rejects an unknown user with the same generic error', () => {
    cy.login('no.such.user.e2e', 'whatever-password');
    cy.get('[role="alert"]').should('contain', 'Incorrect username or password');
  });

  it('keeps the session across a page reload and returns signed-in users to their dashboard', () => {
    cy.loginByApi(demoUser('employee'), undefined, '/schedule');
    cy.contains('h1', 'My Schedule').should('be.visible');
    cy.reload();
    cy.contains('h1', 'My Schedule').should('be.visible');
    // Visiting the login page while signed in redirects home.
    cy.visit('/#/');
    cy.location('hash').should('eq', '#/employee');
  });

  it('signs the user out when the stored token is invalid', () => {
    cy.visit('/#/admin', {
      onBeforeLoad(win) {
        win.localStorage.setItem('acme_token', 'not-a-valid-token');
      },
    });
    cy.location('hash').should('eq', '#/');
    cy.contains('button', 'Sign in').should('be.visible');
  });
});
