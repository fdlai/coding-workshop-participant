import { demoUser } from '../support/commands';

// Critical path: failures are shown to the user with a way to recover. These tests
// stub single responses with cy.intercept; everything else hits the real API.
describe('Error handling', () => {
  it('shows a retryable error when the server cannot be reached, then recovers', () => {
    // Offline until we click 'Try again' (React StrictMode fetches twice in dev).
    let offline = true;
    cy.intercept({ method: 'GET', pathname: '/api/v1/projects' }, (req) => {
      if (offline) req.destroy(); // simulate a network failure
    }).as('projects');

    cy.loginByApi(demoUser('admin'), undefined, '/projects');
    cy.get('[role="alert"]').within(() => {
      cy.contains('Something went wrong');
      cy.contains('Unable to reach the server');
      cy.then(() => { offline = false; });
      cy.contains('button', 'Try again').click();
    });
    cy.get('[role="alert"]').should('not.exist');
    cy.get('tbody tr').should('have.length.at.least', 1);
  });

  it('shows the API error message for a failing request', () => {
    cy.intercept('GET', '**/api/v1/dashboard/admin', {
      statusCode: 500,
      body: { detail: 'Database temporarily unavailable' },
    });
    cy.loginByApi(demoUser('admin'), undefined, '/admin');
    cy.get('[role="alert"]').should('contain', 'Database temporarily unavailable');
  });

  it("shows access denied for another manager's project and not-found for a missing one", () => {
    cy.apiLogin(demoUser('manager')).then((managerToken) => {
      cy.api(managerToken, 'GET', '/auth/me').then((me) => {
        cy.apiLogin(demoUser('admin')).then((adminToken) => {
          cy.api(adminToken, 'GET', '/projects?limit=200').then((projects) => {
            const foreign = projects.find((p) => p.manager_id !== me.id);
            cy.loginByApi(demoUser('manager'), undefined, `/projects/${foreign.id}`);
            cy.contains('Access denied').should('be.visible');
            cy.contains(foreign.name).should('not.exist');
          });
        });
      });
    });
    cy.visit('/#/projects/999999');
    cy.get('[role="alert"]').should('contain', 'Something went wrong').and('contain', 'not found');
  });

  it('signs the user out when the session expires mid-use', () => {
    cy.loginByApi(demoUser('manager'), undefined, '/manager');
    cy.contains('h1', 'Manager Dashboard').should('be.visible');
    cy.intercept({ method: 'GET', pathname: '/api/v1/projects' }, { statusCode: 401, body: { detail: 'Token expired' } });
    cy.navLink('My Projects').click();
    cy.location('hash').should('eq', '#/');
    cy.contains('button', 'Sign in').should('be.visible');
  });
});
