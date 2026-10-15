import { demoUser, TEST_PASSWORD } from '../support/commands';
import { uniqueId } from '../support/utils';

// Critical path: the administrator creates manager and employee accounts, puts the
// employee on the manager's team, and the new accounts can sign in.
describe('Admin user management', () => {
  function addUser({ first, last, username, role }) {
    cy.contains('button', '+ Add User').click();
    cy.dialog('Add user').within(() => {
      cy.findField('First name').type(first);
      cy.findField('Last name').type(last);
      cy.findField('Username').type(username);
      cy.findField('Email').type(`${username}@example.com`);
      cy.findField('Job title').type(`E2E ${role}`);
      cy.findField('Role').select(role === 'manager' ? 'Manager' : 'Employee');
      cy.findField('Initial password').type(TEST_PASSWORD, { log: false });
      cy.contains('button', 'Save').click();
    });
    cy.get('[role="dialog"]').should('not.exist');
  }

  it('creates a manager and an employee, links them, and both can sign in', () => {
    const id = uniqueId();
    const manager = { first: 'Marlow', last: `Mgr${id}`, username: `e2e.newmgr.${id}`, role: 'manager' };
    const employee = { first: 'Ellis', last: `Emp${id}`, username: `e2e.newemp.${id}`, role: 'employee' };

    cy.loginByApi(demoUser('admin'), undefined, '/admin/users');
    cy.contains('h1', 'People').should('be.visible');
    addUser(manager);
    addUser(employee);

    // Both appear in the list (search narrows to the new accounts).
    cy.get('input[aria-label="Search users"]').type(id);
    cy.rowContaining(manager.username).within(() => {
      cy.contains(`${manager.first} ${manager.last}`);
      cy.contains('Manager');
      cy.contains('Active');
    });
    cy.rowContaining(employee.username).should('contain', 'Employee');
    cy.get('tbody tr').should('have.length', 2);

    // Role filter works against the same data.
    cy.get('select[aria-label="Filter by role"]').select('Managers');
    cy.get('tbody tr').should('have.length', 1).and('contain', manager.username);
    cy.get('select[aria-label="Filter by role"]').select('All roles');

    // Assign the employee to the manager on the Organization page.
    cy.navLink('Organization').click();
    cy.contains('h1', 'Organization').should('be.visible');
    cy.contains('button', `${manager.first} ${manager.last}`).click();
    cy.contains('h2', `Team of ${manager.first} ${manager.last}`).should('be.visible');
    cy.contains('No employees assigned to this manager').should('be.visible');
    cy.contains('button', '+ Add Employee').click();
    cy.dialog('Add employee to team').within(() => {
      cy.findField('Employee').select(`${employee.first} ${employee.last}`);
      cy.contains('button', 'Add').click();
    });
    cy.get('[role="dialog"]').should('not.exist');
    cy.contains('li', `${employee.first} ${employee.last}`).should('be.visible');

    // Duplicate usernames are rejected with a visible error.
    cy.navLink('People').click();
    cy.contains('button', '+ Add User').click();
    cy.dialog('Add user').within(() => {
      cy.findField('First name').type('Dup');
      cy.findField('Last name').type('Licate');
      cy.findField('Username').type(employee.username);
      cy.findField('Email').type(`dup.${id}@example.com`);
      cy.findField('Initial password').type(TEST_PASSWORD, { log: false });
      cy.contains('button', 'Save').click();
      cy.get('[role="alert"]').should('be.visible').invoke('text').should('match', /already|exists|taken/i);
      cy.contains('button', 'Cancel').click();
    });

    // The new manager signs in and sees the employee on their team.
    cy.logout();
    cy.login(manager.username, TEST_PASSWORD);
    cy.location('hash').should('eq', '#/manager');
    cy.navLink('Team').click();
    cy.contains(`${employee.first} ${employee.last}`).should('be.visible');

    // The new employee signs in to the employee dashboard.
    cy.logout();
    cy.login(employee.username, TEST_PASSWORD);
    cy.location('hash').should('eq', '#/employee');
    cy.contains('h1', 'My Dashboard').should('be.visible');
    cy.contains(`${manager.first} ${manager.last}`).should('be.visible'); // "My managers"
  });

  it('deactivated users can no longer sign in', () => {
    cy.createTeam({ employees: 1 }).then((team) => {
      const [employee] = team.employees;
      cy.loginByApi(demoUser('admin'), undefined, '/admin/users');
      cy.get('input[aria-label="Search users"]').type(employee.username);
      cy.rowContaining(employee.username).contains('button', 'Deactivate').click();
      cy.dialog('Deactivate user').contains('button', 'Deactivate').click();
      cy.rowContaining(employee.username).should('contain', 'Inactive');

      cy.logout();
      cy.login(employee.username, TEST_PASSWORD);
      cy.get('[role="alert"]').should('be.visible');
      cy.location('hash').should('eq', '#/');
    });
  });
});
