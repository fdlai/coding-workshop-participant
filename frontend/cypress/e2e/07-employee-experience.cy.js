import { TEST_PASSWORD } from '../support/commands';
import { addDays, formatDate } from '../support/utils';

// Critical paths: the employee signs in and sees their own assignments and schedule,
// and cannot edit projects or milestones (UI hides controls, API refuses).
describe('Employee experience', () => {
  let team;
  const ids = {};

  beforeEach(() => {
    cy.createTeam({ employees: 2, project: true }).then((created) => {
      team = created;
      const [me, colleague] = team.employees;
      const d = (n) => addDays(team.today, n);
      cy.api(team.adminToken, 'POST', `/projects/${team.project.id}/milestones`, { name: 'Current work', start_date: d(0), end_date: d(6) })
        .then((m) => {
          ids.current = m.id;
          cy.api(team.adminToken, 'POST', `/milestones/${m.id}/assignments`, { employee_id: me.id, start_date: d(0), planned_end_date: d(6) });
          cy.api(team.adminToken, 'POST', `/milestones/${m.id}/assignments`, { employee_id: colleague.id, start_date: d(0), planned_end_date: d(6) });
        });
      cy.api(team.adminToken, 'POST', `/projects/${team.project.id}/milestones`, { name: 'Next phase', start_date: d(7), end_date: d(20) })
        .then((m) => {
          ids.next = m.id;
          cy.api(team.adminToken, 'POST', `/milestones/${m.id}/assignments`, { employee_id: me.id, start_date: d(7), planned_end_date: d(20) });
        });
    });
  });

  it('sees current and upcoming assignments on the dashboard and schedule', () => {
    const [me] = team.employees;
    cy.login(me.username, TEST_PASSWORD);
    cy.location('hash').should('eq', '#/employee');
    cy.contains('h1', 'My Dashboard').should('be.visible');

    cy.contains('h2', 'Current assignments').parent().parent().within(() => {
      cy.contains('a', team.project.name).should('be.visible');
      cy.contains('Current work');
      cy.contains(`${formatDate(team.today)} – ${formatDate(addDays(team.today, 6))}`);
    });
    cy.contains('h2', 'Upcoming assignments').parent().parent().within(() => {
      cy.contains('Next phase');
      cy.contains('Scheduled');
    });
    cy.contains('h2', 'My managers').parent().parent()
      .should('contain', `${team.manager.first_name} ${team.manager.last_name}`);

    // Weekly schedule: this week shows the current assignment; later weeks the next one.
    cy.navLink('My Schedule').click();
    cy.contains('h1', 'My Schedule').should('be.visible');
    cy.contains('h2', 'Assignments this week').parent().parent().should('contain', 'Current work');
    // Two weeks ahead always falls inside 'Next phase' (days 7-20) and after 'Current work'.
    cy.contains('button', 'Next →').click();
    cy.contains('button', 'Next →').click();
    cy.contains('h2', 'Assignments this week').parent().parent()
      .should('contain', 'Next phase')
      .and('not.contain', 'Current work');
    cy.contains('button', 'Today').click();
    cy.contains('h2', 'Assignments this week').parent().parent().should('contain', 'Current work');

    // The project link from the schedule opens the project.
    cy.contains('a', team.project.name).first().click();
    cy.contains('h1', team.project.name).should('be.visible');
  });

  it('cannot edit projects or milestones and sees only their own assignments', () => {
    const [me, colleague] = team.employees;
    cy.loginByApi(me.username, TEST_PASSWORD, '/projects');
    cy.contains('h1', 'My Projects').should('be.visible');
    cy.contains('button', '+ New Project').should('not.exist');
    cy.rowContaining(team.project.name).should('not.contain', 'Archive').click();

    // Overview: no lifecycle or edit controls, no budget figures.
    cy.contains('h1', team.project.name).should('be.visible');
    ['Edit Project', 'Mark completed', 'Abandon', 'Archive'].forEach((label) => {
      cy.contains('button', label).should('not.exist');
    });
    cy.contains('h2', 'Quick stats').parent().parent().should('not.contain', 'Budget');

    // Milestones: read-only table, no add/edit/complete actions.
    cy.contains('[role="tab"]', 'Milestones').click();
    cy.contains('tr', 'Current work').should('be.visible');
    cy.contains('button', '+ Add Milestone').should('not.exist');
    cy.get('thead').should('not.contain', 'Actions');
    ['Edit', 'Complete', 'Cancel', 'Delete'].forEach((label) => {
      cy.get('tbody').contains('button', new RegExp(`^${label}$`)).should('not.exist');
    });

    // Employees: own assignments plus teammates on shared milestones (by design, no cost
    // data), and no scheduling controls.
    cy.contains('[role="tab"]', 'Employees').click();
    cy.contains('button', '+ Assign Employee').should('not.exist');
    cy.get('tbody tr').should('have.length', 3);
    cy.get('tbody tr').filter(`:contains("${me.last_name}")`).should('have.length', 2);
    cy.get('tbody tr').filter(`:contains("${colleague.last_name}")`).should('have.length', 1).and('contain', 'Current work');
    cy.get('tbody').contains('button', /^(Edit|Transfer|Remove)$/).should('not.exist');
    cy.get('thead').should('not.contain', 'Actions');

    // Budget: permission denied.
    cy.contains('[role="tab"]', 'Budget').click();
    cy.contains('Access denied').should('be.visible');
    cy.contains('Budget details are only available to administrators and the project manager.');

    // The API enforces the same rules.
    cy.apiLogin(me.username, TEST_PASSWORD).then((token) => {
      const d = (n) => addDays(team.today, n);
      const attempts = [
        ['PATCH', `/projects/${team.project.id}`, { name: 'Hacked' }],
        ['PATCH', `/projects/${team.project.id}/status`, { status: 'completed' }],
        ['POST', `/projects/${team.project.id}/milestones`, { name: 'Sneaky', start_date: d(30), end_date: d(31) }],
        ['PATCH', `/milestones/${ids.next}`, { name: 'Renamed' }],
        ['PATCH', `/milestones/${ids.next}/status`, { status: 'completed' }],
        ['DELETE', `/milestones/${ids.next}`],
        ['POST', `/milestones/${ids.next}/assignments`, { employee_id: me.id, start_date: d(21), planned_end_date: d(21) }],
      ];
      attempts.forEach(([method, path, body]) => {
        cy.apiRaw(token, method, path, body).its('status').should('eq', 403);
      });
      cy.api(token, 'GET', `/projects/${team.project.id}`).its('name').should('eq', team.project.name);
    });
  });
});
