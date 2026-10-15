import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import OrganizationPage from '../OrganizationPage';
import { apiError, callsTo, renderApp, users } from '../../../test/utils';

const max = { ...users.manager, id: 2 };
const mia = { id: 5, username: 'mia', first_name: 'Mia', last_name: 'Moss', role: 'manager', is_active: false, job_title: 'Manager' };
const eve = { ...users.employee, id: 3 };
const finn = { id: 7, username: 'finn', first_name: 'Finn', last_name: 'Fox', role: 'employee', is_active: true, job_title: null };

/** GET /users is called for managers (page) and employees (add modal); answer by role. */
const usersByRole = (byRole) => (_, url) => byRole[new URL(url, 'http://localhost').searchParams.get('role')];

function renderOrg(routes = {}) {
  return renderApp(<OrganizationPage />, {
    user: users.admin,
    routes: {
      'GET /users': usersByRole({ manager: [max, mia], employee: [eve, finn] }),
      'GET /managers/2/employees': [eve],
      'GET /managers/5/employees': [],
      ...routes,
    },
  });
}

describe('OrganizationPage', () => {
  it("selects the first manager and shows their team", async () => {
    await renderOrg();
    expect(await screen.findByRole('heading', { name: 'Team of Max Manager' })).toBeInTheDocument();
    expect(await screen.findByText('Eve Employee')).toBeInTheDocument();
    expect(screen.getByText('Engineer')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Mia Moss \(inactive\)/ })).toBeInTheDocument();
  });

  it('switches to another manager with an empty team', async () => {
    await renderOrg();
    await screen.findByText('Eve Employee');
    await userEvent.click(screen.getByRole('button', { name: /Mia Moss/ }));
    expect(await screen.findByText('No employees assigned to this manager')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Team of Mia Moss' })).toBeInTheDocument();
  });

  it('adds an employee who is not already on the team', async () => {
    let team = [eve];
    const { calls } = await renderOrg({
      'GET /managers/2/employees': () => team,
      'POST /managers/2/employees': (body) => {
        team = [eve, finn];
        return { manager_id: 2, employee_id: body.employee_id };
      },
    });
    await screen.findByText('Eve Employee');
    await userEvent.click(screen.getByRole('button', { name: '+ Add Employee' }));
    const dialog = screen.getByRole('dialog', { name: 'Add employee to team' });
    const select = within(dialog).getByLabelText('Employee');
    await within(dialog).findByRole('option', { name: 'Finn Fox' });
    expect(within(select).queryByRole('option', { name: 'Eve Employee' })).not.toBeInTheDocument();

    await userEvent.selectOptions(select, 'Finn Fox');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add' }));

    expect(await screen.findByText('Finn Fox')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(callsTo(calls, 'POST /managers/2/employees')[0].body).toEqual({ employee_id: 7 });
  });

  it('requires an employee to be selected before adding', async () => {
    const { calls } = await renderOrg();
    await screen.findByText('Eve Employee');
    await userEvent.click(screen.getByRole('button', { name: '+ Add Employee' }));
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Select an employee');
    expect(callsTo(calls, 'POST /managers/2/employees')).toHaveLength(0);
  });

  it('removes an employee from the team after confirmation', async () => {
    let team = [eve];
    const { calls } = await renderOrg({
      'GET /managers/2/employees': () => team,
      'DELETE /managers/2/employees/3': () => { team = []; return null; },
    });
    await screen.findByText('Eve Employee');
    await userEvent.click(screen.getByRole('button', { name: 'Remove' }));
    const dialog = screen.getByRole('dialog', { name: 'Remove from team' });
    expect(dialog).toHaveTextContent("Remove Eve Employee from this manager's team?");
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove' }));

    expect(await screen.findByText('No employees assigned to this manager')).toBeInTheDocument();
    expect(callsTo(calls, 'DELETE /managers/2/employees/3')).toHaveLength(1);
  });

  it('shows the API error when removal fails', async () => {
    await renderOrg({ 'DELETE /managers/2/employees/3': apiError(404, 'Relationship not found') });
    await screen.findByText('Eve Employee');
    await userEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Relationship not found');
  });

  it('explains what to do when there are no managers', async () => {
    await renderOrg({ 'GET /users': usersByRole({ manager: [] }) });
    expect(await screen.findByText('No managers yet')).toBeInTheDocument();
    expect(screen.getByText('Create a user with the manager role first.')).toBeInTheDocument();
  });
});
