import { TEST_PASSWORD } from '../support/commands';
import { addDays, formatDate } from '../support/utils';

// Critical paths: the manager assigns eligible employees to milestones; the app
// rejects conflicting schedules (double-booking); the manager transfers and removes
// assignments without losing history.
describe('Milestone assignments', () => {
  it('assigns, blocks double-booking, transfers and removes assignments', () => {
    cy.createTeam({ employees: 2, project: true }).then((team) => {
      const [first, second] = team.employees;
      const firstName = `${first.first_name} ${first.last_name}`;
      const secondName = `${second.first_name} ${second.last_name}`;
      const d = (n) => addDays(team.today, n);
      const ids = {};

      // Setup through the API: project 1 has Sprint A (now) and Sprint B (later);
      // project 2 (same manager) has one long milestone overlapping both.
      cy.api(team.adminToken, 'POST', `/projects/${team.project.id}/milestones`, { name: 'Sprint A', start_date: d(0), end_date: d(13) })
        .then((m) => { ids.sprintA = m.id; });
      cy.api(team.adminToken, 'POST', `/projects/${team.project.id}/milestones`, { name: 'Sprint B', start_date: d(14), end_date: d(30) })
        .then((m) => { ids.sprintB = m.id; });
      cy.api(team.adminToken, 'POST', '/projects', {
        name: `E2E Ops ${team.id}`, manager_id: team.manager.id, start_date: d(0), estimated_end_date: d(60), estimated_budget: '50000.00',
      }).then((p) => {
        ids.project2 = p.id;
        cy.api(team.adminToken, 'POST', `/projects/${p.id}/milestones`, { name: 'Ops rotation', start_date: d(0), end_date: d(30) });
      });

      // --- 1. Manager assigns the first employee to Sprint B through the UI.
      cy.loginByApi(team.manager.username, TEST_PASSWORD, `/projects/${team.project.id}`);
      cy.contains('[role="tab"]', 'Employees').click();
      cy.contains('No employees assigned').should('be.visible');
      cy.contains('button', '+ Assign Employee').click();
      cy.dialog('Assign employee').within(() => {
        cy.findField('Milestone').find('option:selected').should('contain', 'Sprint A');
        cy.findField('Milestone').select(`Sprint B (${formatDate(d(14))} – ${formatDate(d(30))})`);
        cy.findField('Start date').should('have.value', d(14));
        cy.findField('End date').should('have.value', d(30));
        cy.contains('label', firstName).should('contain', 'Available').find('input[type="radio"]').check();
        cy.contains('button', 'Assign').click();
      });
      cy.get('[role="dialog"]').should('not.exist');
      cy.rowContaining(firstName)
        .should('contain', 'Sprint B')
        .and('contain', `${formatDate(d(14))} – ${formatDate(d(30))}`)
        .and('contain', 'Scheduled');

      // --- 2. Double-booking: on the other project the first employee shows as busy.
      cy.then(() => cy.visit(`/#/projects/${ids.project2}`));
      cy.contains('h1', `E2E Ops ${team.id}`).should('be.visible');
      cy.contains('[role="tab"]', 'Employees').click();
      cy.contains('button', '+ Assign Employee').click();
      cy.dialog('Assign employee').within(() => {
        cy.contains('label', firstName)
          .should('contain', `Busy: ${formatDate(d(14))}–${formatDate(d(30))}`)
          .find('input[type="radio"]')
          .should('be.disabled');

        // The second employee looks free, so pick them...
        cy.contains('label', secondName).should('contain', 'Available').find('input[type="radio"]').check();
      });

      // ...but someone books them on Sprint A meanwhile (simulated through the API).
      cy.then(() => cy.api(team.adminToken, 'POST', `/milestones/${ids.sprintA}/assignments`, {
        employee_id: second.id, start_date: d(2), planned_end_date: d(5),
      }));

      // The server rejects the overlapping assignment and the modal shows why.
      cy.dialog('Assign employee').within(() => {
        cy.contains('button', 'Assign').click();
        cy.get('[role="alert"]').should('be.visible').and('contain', 'overlapping assignment');

        // Starting the day after the other booking ends (adjacent) is accepted.
        cy.findField('Start date').clear().type(d(6));
        cy.contains('label', secondName).find('input[type="radio"]').should('be.checked');
        cy.contains('button', 'Assign').click();
      });
      cy.get('[role="dialog"]').should('not.exist');
      cy.rowContaining(secondName).should('contain', 'Ops rotation').and('contain', `${formatDate(d(6))} – ${formatDate(d(30))}`);

      // Editing an assignment into an overlap is rejected too.
      cy.rowContaining(secondName).contains('button', 'Edit').click();
      cy.dialog(`Edit assignment – ${secondName}`).within(() => {
        cy.findField('Start date').clear().type(d(3));
        cy.contains('button', 'Save').click();
        cy.get('[role="alert"]').should('be.visible').and('contain', 'overlapping assignment');
        cy.contains('button', 'Cancel').click();
      });

      // --- 3. Transfer: move the first employee from Sprint B to Sprint A (starts today).
      cy.visit(`/#/projects/${team.project.id}`);
      cy.contains('[role="tab"]', 'Employees').click();
      cy.contains('tr', firstName).contains('button', 'Transfer').click();
      cy.dialog(`Transfer ${firstName}`).within(() => {
        cy.findField('Destination milestone').find('option:selected').should('contain', 'Sprint A');
        cy.contains('button', 'Transfer').click();
      });
      cy.get('[role="dialog"]').should('not.exist');
      // History is kept: the old row is cancelled (it never started) and a new row exists.
      cy.get('tbody tr').filter(`:contains("${firstName}")`).should('have.length', 2);
      cy.get('tbody tr').filter(`:contains("${firstName}")`).filter(':contains("Sprint B")').should('contain', 'Cancelled');
      cy.get('tbody tr').filter(`:contains("${firstName}")`).filter(':contains("Sprint A")')
        .should('contain', 'Active')
        .and('contain', `${formatDate(d(0))} – ${formatDate(d(13))}`);

      // --- 4. Remove the second employee from Sprint A; the row stays as history.
      cy.get('tbody tr').filter(`:contains("${secondName}")`).filter(':contains("Sprint A")').contains('button', 'Remove').click();
      cy.dialog('Remove from milestone').contains('button', 'Remove').click();
      cy.get('[role="dialog"]').should('not.exist');
      cy.get('tbody tr').filter(`:contains("${secondName}")`).filter(':contains("Sprint A")')
        .should('contain', 'Cancelled')
        .find('button')
        .should('not.exist');

      // The milestone details list everyone who was ever assigned.
      cy.contains('[role="tab"]', 'Milestones').click();
      cy.contains('button', 'Sprint A').click();
      cy.dialog('Sprint A').within(() => {
        cy.contains('tr', firstName).should('contain', 'Active');
        cy.contains('tr', secondName).should('contain', 'Cancelled');
      });
    });
  });

  it('rejects employees who are not on the project manager\'s team', () => {
    cy.createTeam({ employees: 1, project: true }).then((team) => {
      cy.createTeam({ employees: 1 }).then((other) => {
        cy.api(team.adminToken, 'POST', `/projects/${team.project.id}/milestones`, {
          name: 'Solo', start_date: team.today, end_date: addDays(team.today, 10),
        }).then((milestone) => {
          cy.apiLogin(team.manager.username, TEST_PASSWORD).then((token) => {
            cy.apiRaw(token, 'POST', `/milestones/${milestone.id}/assignments`, {
              employee_id: other.employees[0].id, start_date: team.today, planned_end_date: addDays(team.today, 10),
            }).then((res) => {
              expect(res.status).to.eq(409);
              expect(res.body.detail).to.contain("not organizationally assigned");
            });
          });
        });
        // The assign dialog only offers the manager's own team.
        cy.loginByApi(team.manager.username, TEST_PASSWORD, `/projects/${team.project.id}`);
        cy.contains('[role="tab"]', 'Employees').click();
        cy.contains('button', '+ Assign Employee').click();
        cy.dialog('Assign employee').within(() => {
          cy.contains('label', team.employees[0].last_name).should('exist');
          cy.contains('label', other.employees[0].last_name).should('not.exist');
        });
      });
    });
  });
});
