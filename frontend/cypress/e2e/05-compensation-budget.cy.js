import { demoUser, TEST_PASSWORD } from '../support/commands';
import { addDays, formatDate, formatMoneyCents, weekdaysBetween } from '../support/utils';

// Critical paths: the admin records compensation including a future-dated raise; the
// project budget uses the right rate for each date; budget figures are displayed to
// the admin and the project's manager (and only to them).
describe('Compensation and budget', () => {
  it('a future-dated rate changes projected cost only from its effective date', () => {
    cy.createTeam({ employees: 1, project: true, hourlyRate: '50.00', budget: '20000.00' }).then((team) => {
      const [employee] = team.employees;
      const employeeName = `${employee.first_name} ${employee.last_name}`;
      const msStart = addDays(team.today, 7);
      const msEnd = addDays(team.today, 48);
      const raiseFrom = addDays(team.today, 28);

      // Schedule the employee across the future raise date (setup through the API).
      cy.api(team.adminToken, 'POST', `/projects/${team.project.id}/milestones`, {
        name: 'Costed milestone', start_date: msStart, end_date: msEnd,
      }).then((milestone) => {
        cy.api(team.adminToken, 'POST', `/milestones/${milestone.id}/assignments`, {
          employee_id: employee.id, start_date: msStart, planned_end_date: msEnd,
        });
      });

      const days = weekdaysBetween(msStart, msEnd);
      const before = days.length * 400; // $50/h * 40h / 5 days
      const after = days.reduce((sum, day) => sum + (day < raiseFrom ? 400 : 640), 0); // $80/h from raiseFrom

      // --- Budget before the raise (manager's view).
      cy.loginByApi(team.manager.username, TEST_PASSWORD, `/projects/${team.project.id}`);
      cy.contains('[role="tab"]', 'Budget').click();
      cy.contains('Estimated budget').parent().should('contain', '$20,000.00');
      cy.contains('Accrued to date').parent().should('contain', '$0.00');
      cy.contains('Projected remaining').parent().should('contain', formatMoneyCents(before));
      cy.contains('Budget remaining').parent().should('contain', formatMoneyCents(20000 - before));
      cy.contains('h2', 'Cost by milestone').parent().parent().within(() => {
        cy.rowContaining('Costed milestone').should('contain', formatMoneyCents(before));
      });
      cy.contains(`Total expected cost ${formatMoneyCents(before)}`).should('be.visible');

      // --- Admin records a future-dated raise on the Compensation page.
      cy.loginByApi(demoUser('admin'), undefined, '/admin/compensation');
      cy.contains('h1', 'Compensation').should('be.visible');
      cy.contains('p', 'Choose an employee to view and manage their work terms.').should('be.visible');
      cy.findField('Employee').select(employeeName);
      cy.rowContaining(formatDate(team.today)).should('contain', '$50.00').and('contain', '$400.00');

      cy.contains('button', '+ Add Work Term').click();
      cy.dialog(`Add work terms – ${employeeName}`).within(() => {
        cy.findField('Hourly rate').type('80');
        cy.findField('Weekly hours').clear().type('40');
        cy.findField('Effective from').type(raiseFrom);
        cy.contains('button', 'Save').click();
      });
      cy.get('[role="dialog"]').should('not.exist');
      cy.rowContaining(formatDate(raiseFrom)).should('contain', '$80.00').and('contain', '$640.00');
      cy.get('[role="img"][aria-label="Hourly rate history"]')
        .should('contain', '$50.00')
        .and('contain', '$80.00')
        .and('contain', formatDate(raiseFrom));

      // Duplicate effective dates are rejected (history is append-only).
      cy.contains('button', '+ Add Work Term').click();
      cy.dialog(`Add work terms – ${employeeName}`).within(() => {
        cy.findField('Hourly rate').type('90');
        cy.findField('Effective from').type(raiseFrom);
        cy.contains('button', 'Save').click();
        cy.get('[role="alert"]').should('be.visible').and('contain', 'already exist');
        cy.contains('button', 'Cancel').click();
      });

      // --- The admin sees the recalculated budget: old rate before, new rate after.
      cy.visit(`/#/projects/${team.project.id}`);
      cy.contains('[role="tab"]', 'Budget').click();
      cy.contains('Projected remaining').parent().should('contain', formatMoneyCents(after));
      cy.contains('Budget remaining').parent().should('contain', formatMoneyCents(20000 - after));
      cy.contains(`Total expected cost ${formatMoneyCents(after)}`).should('be.visible');
      cy.contains(`${((after / 20000) * 100).toFixed(1)}% of budget`).should('be.visible');
    });
  });

  it('shows budget health and per-milestone costs on a seeded project for its manager', () => {
    cy.loginByApi(demoUser('manager'), undefined, '/projects');
    cy.contains('h1', 'My Projects').should('be.visible');
    cy.get('tbody tr').first().click();
    cy.contains('[role="tab"]', 'Budget').click();
    ['Estimated budget', 'Accrued to date', 'Projected remaining', 'Budget remaining'].forEach((label) => {
      cy.contains('p', label).parent().invoke('text').should('match', /\$[\d,]+\.\d{2}/);
    });
    cy.contains('h2', 'Budget utilization').parent().invoke('text').should('match', /On track|At risk|Over budget/);
    cy.contains('h2', 'Cost by milestone').parent().parent().find('tbody tr').should('have.length.at.least', 1);
  });

  it('keeps historical cost after a raise, an early removal and a deactivation (seeded showcase)', () => {
    // Seeded scenarios (scripts/seed_data.py SHOWCASE_PROJECT): $50/h x 40h = $2,000/week.
    cy.loginByApi(demoUser('manager'), undefined, '/projects');
    cy.get('input[aria-label="Search projects"]').type('Showcase: Labor Cost Accuracy');
    cy.rowContaining('Showcase: Labor Cost Accuracy').click();
    cy.contains('[role="tab"]', 'Budget').click();
    cy.contains('h2', 'Cost by milestone').parent().parent().within(() => {
      // Raise to $75/h after week 1: $2,000 + $3,000.
      cy.rowContaining('1. Pay raise halfway through').should('contain', 'Completed').and('contain', '$5,000.00');
      // Removed after one of two scheduled weeks: only the worked week counts.
      cy.rowContaining('2. Removed after one week').should('contain', '$2,000.00').and('not.contain', '$4,000.00');
      // Account deactivated after finishing: the worked cost is kept.
      cy.rowContaining('3. Deactivated after finishing').should('contain', '$4,000.00');
    });

    // History stays visible: the removed and deactivated people are still listed.
    cy.contains('[role="tab"]', 'Milestones').click();
    cy.contains('button', '2. Removed after one week').click();
    cy.dialog('2. Removed after one week').within(() => {
      cy.get('tbody tr').should('have.length', 1).and('contain', 'Casey Holt').and('contain', 'Removed early');
      cy.get('button[aria-label="Close"]').click();
    });
    cy.contains('button', '3. Deactivated after finishing').click();
    cy.dialog('3. Deactivated after finishing').within(() => {
      cy.contains('tr', 'Riley Shaw').should('contain', 'Inactive');
    });
  });

  it('employees cannot see compensation or budget data', () => {
    cy.createTeam({ employees: 1, project: true }).then((team) => {
      const [employee] = team.employees;
      cy.apiLogin(employee.username, TEST_PASSWORD).then((token) => {
        cy.apiRaw(token, 'GET', `/employees/${employee.id}/work-terms`).its('status').should('eq', 403);
        cy.apiRaw(token, 'GET', `/projects/${team.project.id}/budget`).its('status').should('be.oneOf', [403, 404]);
        cy.apiRaw(token, 'POST', `/employees/${employee.id}/work-terms`, {
          hourly_rate: '999.00', weekly_hours: '40', effective_from: addDays(team.today, 60),
        }).its('status').should('eq', 403);
      });
      // The manager cannot record compensation either.
      cy.apiLogin(team.manager.username, TEST_PASSWORD).then((token) => {
        cy.apiRaw(token, 'POST', `/employees/${employee.id}/work-terms`, {
          hourly_rate: '999.00', weekly_hours: '40', effective_from: addDays(team.today, 60),
        }).its('status').should('eq', 403);
      });
    });
  });
});
