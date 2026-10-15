import { demoUser, TEST_PASSWORD } from '../support/commands';

// Critical path: the administrator archives and restores a project and reviews the
// audit history of those changes. Managers cannot archive.
describe('Archive, restore and audit history', () => {
  it('admin archives a project, restores it and sees both actions in the audit log', () => {
    cy.createTeam({ employees: 0, project: true }).then((team) => {
      const { name, id } = team.project;

      // A manager is refused by the API.
      cy.apiLogin(team.manager.username, TEST_PASSWORD).then((token) => {
        cy.apiRaw(token, 'POST', `/projects/${id}/archive`).its('status').should('eq', 403);
      });

      // --- Archive from the project list.
      cy.loginByApi(demoUser('admin'), undefined, '/projects');
      cy.get('input[aria-label="Search projects"]').type(name);
      cy.rowContaining(name).contains('button', 'Archive').click();
      cy.dialog('Archive project').within(() => {
        cy.contains(`Archive "${name}"?`);
        cy.contains('button', 'Archive').click();
      });
      cy.get('[role="dialog"]').should('not.exist');
      cy.contains('No projects found').should('be.visible');

      // --- It is listed on Archived Projects and is read-only.
      cy.navLink('Archived Projects').click();
      cy.contains('h1', 'Archived Projects').should('be.visible');
      cy.rowContaining(name).contains('a', name).click();
      cy.contains('h1', name).should('be.visible');
      cy.contains('This project is archived and read-only.').should('be.visible');
      cy.contains('button', 'Edit Project').should('not.exist');
      cy.contains('[role="tab"]', 'Milestones').click();
      cy.contains('button', '+ Add Milestone').should('not.exist');

      // --- Restore from the Archived Projects page.
      cy.navLink('Archived Projects').click();
      cy.rowContaining(name).contains('button', 'Restore').click();
      cy.dialog('Restore project').contains('button', 'Restore').click();
      cy.get('[role="dialog"]').should('not.exist');
      cy.contains('tr', name).should('not.exist');

      cy.navLink('Projects').click();
      cy.get('input[aria-label="Search projects"]').type(name);
      cy.rowContaining(name).should('contain', 'Active');

      // --- Archive + restore from the project's overview as well.
      cy.rowContaining(name).click();
      cy.contains('h1', name).should('be.visible');
      cy.contains('button', 'Archive').click();
      cy.dialog('Archive project').contains('button', 'Archive').click();
      cy.contains('This project is archived and read-only.').should('be.visible');
      cy.contains('button', 'Restore').click();
      cy.dialog('Restore project').contains('button', 'Restore').click();
      cy.contains('This project is archived and read-only.').should('not.exist');

      // --- Audit log: filter to project archive / restore actions.
      cy.navLink('Audit Logs').click();
      cy.contains('h1', 'Audit Logs').should('be.visible');
      cy.get('tbody tr').should('have.length.at.least', 1);
      cy.get('select[aria-label="Action"]').select('project.archive');
      // Wait until the filtered page has loaded: every row is an archive action.
      cy.get('tbody tr').should(($rows) => {
        expect([...$rows].every((row) => row.textContent.includes('project.archive'))).to.equal(true);
      });
      cy.contains('tr', `Archived project '${name}'`).within(() => {
        cy.contains('Avery Brooks');
        cy.contains(`project #${id}`);
      });
      cy.get('tbody tr').filter(`:contains("Archived project '${name}'")`).should('have.length', 2);

      cy.get('select[aria-label="Action"]').select('project.restore');
      cy.get('tbody tr').filter(`:contains("Restored project '${name}'")`).should('have.length', 2);

      // Other entity types are recorded too: the project's creation and the team setup.
      cy.contains('button', 'Clear').click();
      cy.get('select[aria-label="Entity type"]').select('project');
      cy.get('select[aria-label="Action"]').select('project.create');
      cy.contains('tr', `Created project '${name}'`).should('be.visible');
      cy.contains('button', 'Clear').click();
      cy.get('select[aria-label="Action"]').select('user.create');
      cy.contains('tr', `Created manager account '${team.manager.username}'`).should('be.visible');

      // The admin dashboard shows recent activity.
      cy.navLink('Dashboard').click();
      cy.contains('h2', 'Recent activity').parent().parent().should('contain', `project '${name}'`);
    });
  });

  it('non-admins cannot read the audit log', () => {
    cy.loginByApi(demoUser('manager'), undefined, '/admin/audit');
    cy.contains('Access denied').should('be.visible');
    cy.contains('h1', 'Audit Logs').should('not.exist');
  });
});
