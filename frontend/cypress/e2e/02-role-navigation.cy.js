import { demoUser } from '../support/commands';

// Critical path: role-aware navigation, and blocked access (UI guard + API 403) per role.
const NAV = {
  admin: ['Dashboard', 'Projects', 'People', 'Organization', 'Compensation', 'Audit Logs', 'Archived Projects'],
  manager: ['Dashboard', 'My Projects', 'Team', 'Schedule'],
  employee: ['Dashboard', 'My Schedule', 'My Projects'],
};

// Pages each role may open, with the heading that proves the page rendered.
const ALLOWED = {
  admin: [
    ['/admin', 'Admin Dashboard'],
    ['/projects', 'Projects'],
    ['/admin/users', 'People'],
    ['/admin/organization', 'Organization'],
    ['/admin/compensation', 'Compensation'],
    ['/admin/audit', 'Audit Logs'],
    ['/admin/archives', 'Archived Projects'],
  ],
  manager: [
    ['/manager', 'Manager Dashboard'],
    ['/projects', 'My Projects'],
    ['/team', 'My Team'],
    ['/schedule', 'Team Schedule'],
  ],
  employee: [
    ['/employee', 'My Dashboard'],
    ['/schedule', 'My Schedule'],
    ['/projects', 'My Projects'],
  ],
};

// Pages each role must NOT be able to open.
const BLOCKED = {
  admin: ['/manager', '/team', '/schedule', '/employee'],
  manager: ['/admin', '/admin/users', '/admin/compensation', '/admin/audit', '/admin/archives', '/employee'],
  employee: ['/admin', '/admin/users', '/admin/organization', '/admin/compensation', '/admin/audit', '/manager', '/team'],
};

// Admin-only API endpoints the other roles must be refused by the server itself.
const ADMIN_ONLY_API = [
  ['GET', '/audit-logs'],
  ['GET', '/dashboard/admin'],
  ['POST', '/users'],
  ['POST', '/projects'],
];

describe('Role-aware navigation and access control', () => {
  Object.keys(NAV).forEach((role) => {
    describe(role, () => {
      it('shows exactly the navigation for the role and every link opens its page', () => {
        cy.loginByApi(demoUser(role));
        cy.get('nav[aria-label="Main"] a').then(($links) => {
          expect([...$links].map((a) => a.textContent.trim())).to.deep.equal(NAV[role]);
        });
        NAV[role].forEach((label, index) => {
          cy.navLink(label).click();
          cy.location('hash').should('eq', `#${ALLOWED[role][index][0]}`);
          cy.contains('h1', ALLOWED[role][index][1]).should('be.visible');
          cy.navLink(label).should('have.class', 'text-indigo-700'); // active link
        });
      });

      it('shows "Access denied" for pages outside the role', () => {
        cy.loginByApi(demoUser(role));
        BLOCKED[role].forEach((path) => {
          cy.visit(`/#${path}`);
          cy.contains('Access denied').should('be.visible');
          cy.contains('You do not have permission to view this page.').should('be.visible');
        });
      });

      if (role !== 'admin') {
        it('is refused by the API for admin-only endpoints', () => {
          cy.apiLogin(demoUser(role)).then((token) => {
            ADMIN_ONLY_API.forEach(([method, path]) => {
              cy.apiRaw(token, method, path, method === 'POST' ? {} : undefined)
                .its('status')
                .should('be.oneOf', [403]);
            });
          });
        });
      }
    });
  });

  it('employees cannot see budget columns in the project list', () => {
    cy.loginByApi(demoUser('employee'), undefined, '/projects');
    cy.contains('h1', 'My Projects').should('be.visible');
    cy.get('thead').should('not.contain', 'Budget').and('contain', 'Status');
  });

  it('unauthenticated API calls are rejected', () => {
    cy.apiRaw(null, 'GET', '/projects').its('status').should('eq', 401);
  });
});
