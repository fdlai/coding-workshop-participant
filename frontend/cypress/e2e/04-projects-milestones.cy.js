import { demoUser, TEST_PASSWORD } from '../support/commands';
import { addDays, formatDate } from '../support/utils';

// Critical path: the admin creates a project for a manager; the manager sees it,
// opens the detail page and plans non-overlapping milestones (overlaps rejected).
describe('Projects and milestones', () => {
  it('admin creates a project, the manager sees it and adds milestones', () => {
    cy.createTeam({ employees: 1 }).then((team) => {
      const name = `E2E Launch ${team.id}`;
      const start = team.today;
      const end = addDays(team.today, 90);
      const managerName = `${team.manager.first_name} ${team.manager.last_name}`;

      // --- Admin creates the project through the UI.
      cy.loginByApi(demoUser('admin'), undefined, '/projects');
      cy.contains('h1', 'Projects').should('be.visible');
      cy.contains('button', '+ New Project').click();
      cy.dialog('New project').within(() => {
        cy.findField('Name').type(name);
        cy.findField('Description').type('Created end-to-end by Cypress');
        cy.findField('Project manager').select(managerName);
        cy.findField('Start date').type(start);
        cy.findField('Estimated end').type(end);
        cy.findField('Budget (USD)').type('75000');
        cy.contains('button', 'Create project').click();
      });
      cy.get('[role="dialog"]').should('not.exist');

      cy.get('input[aria-label="Search projects"]').type(team.id);
      cy.rowContaining(name).within(() => {
        cy.contains(managerName);
        cy.contains(formatDate(start));
        cy.contains('$75,000');
        cy.contains('Active');
      });

      // Validation: end before start is rejected with a visible error.
      cy.contains('button', '+ New Project').click();
      cy.dialog('New project').within(() => {
        cy.findField('Name').type(`${name} invalid`);
        cy.findField('Project manager').select(managerName);
        cy.findField('Start date').type(end);
        cy.findField('Estimated end').type(start);
        cy.findField('Budget (USD)').type('1000');
        cy.contains('button', 'Create project').click();
        cy.get('[role="alert"]').should('be.visible');
        cy.contains('button', 'Cancel').click();
      });

      // --- The assigned manager signs in and sees the project.
      cy.logout();
      cy.login(team.manager.username, TEST_PASSWORD);
      cy.location('hash').should('eq', '#/manager');
      cy.contains(name).should('be.visible'); // dashboard "My active projects"
      cy.navLink('My Projects').click();
      cy.rowContaining(name).contains('button', 'View').click();
      cy.contains('h1', name).should('be.visible');
      cy.contains('Created end-to-end by Cypress');
      cy.contains('button', 'Edit Project').should('be.visible');
      cy.contains('No milestones yet.').should('be.visible');

      // --- Manager adds two adjacent milestones.
      cy.contains('[role="tab"]', 'Milestones').click();
      cy.contains('No milestones yet').should('be.visible');
      const addMilestone = (title, from, to) => {
        cy.contains('button', '+ Add Milestone').click();
        cy.dialog('Add milestone').within(() => {
          cy.findField('Name').type(title);
          cy.findField('Deliverables').type(`${title} deliverables`);
          cy.findField('Start date').type(from);
          cy.findField('End date').type(to);
          cy.contains('button', 'Save').click();
        });
      };
      addMilestone('Discovery', addDays(start, 0), addDays(start, 20));
      cy.get('[role="dialog"]').should('not.exist');
      addMilestone('Build', addDays(start, 21), addDays(start, 60));
      cy.get('[role="dialog"]').should('not.exist');

      cy.rowContaining('Discovery').should('contain', `${formatDate(start)} – ${formatDate(addDays(start, 20))}`).and('contain', 'Pending');
      cy.rowContaining('Build').should('contain', 'Pending');

      // --- Overlapping milestone is rejected by the API and the error is shown.
      addMilestone('Overlap', addDays(start, 10), addDays(start, 30));
      cy.dialog('Add milestone').within(() => {
        cy.get('[role="alert"]').should('be.visible').invoke('text').should('match', /overlap/i);
        cy.contains('button', 'Cancel').click();
      });
      cy.contains('tr', 'Overlap').should('not.exist');

      // --- Milestone outside the project dates is rejected.
      addMilestone('Too late', addDays(end, 1), addDays(end, 5));
      cy.dialog('Add milestone').within(() => {
        cy.get('[role="alert"]').should('be.visible');
        cy.contains('button', 'Cancel').click();
      });

      // --- Milestone details modal shows the period and deliverables.
      cy.contains('button', 'Discovery').click();
      cy.dialog('Discovery').within(() => {
        cy.contains('Discovery deliverables');
        cy.contains('No one has been assigned to this milestone.');
        cy.get('button[aria-label="Close"]').click();
      });

      // Overview shows progress for the two milestones.
      cy.contains('[role="tab"]', 'Overview').click();
      cy.contains('h2', 'Quick stats').parent().parent().should('contain', '0/2');
    });
  });

  it('admin can edit a project and the change is visible on the detail page', () => {
    cy.createTeam({ employees: 0, project: true }).then((team) => {
      cy.loginByApi(demoUser('admin'), undefined, `/projects/${team.project.id}`);
      cy.contains('h1', team.project.name).should('be.visible');
      cy.contains('button', 'Edit Project').click();
      cy.dialog('Edit project').within(() => {
        cy.findField('Description').clear().type('Updated description from Cypress');
        cy.findField('Budget (USD)').clear().type('123456');
        cy.contains('button', 'Save changes').click();
      });
      cy.get('[role="dialog"]').should('not.exist');
      cy.contains('Updated description from Cypress').should('be.visible');
      cy.contains('Quick stats').parent().parent().should('contain', '$123,456');
    });
  });
});
