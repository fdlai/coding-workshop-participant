import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import UsersPage from '../UsersPage';
import { apiError, callsTo, renderApp, users } from '../../../test/utils';

const bob = { id: 10, username: 'bob', email: 'bob@acme.test', first_name: 'Bob', last_name: 'Builder', role: 'employee', is_active: true, job_title: 'Engineer' };
const carol = { id: 11, username: 'carol', email: 'carol@acme.test', first_name: 'Carol', last_name: 'Chen', role: 'manager', is_active: false, job_title: null };

function renderUsers(routes = {}) {
  return renderApp(<UsersPage />, {
    user: users.admin,
    routes: { 'GET /users': [bob, carol], ...routes },
  });
}

const rowFor = (name) => screen.getByRole('row', { name: new RegExp(name) });

describe('UsersPage', () => {
  it('lists users with their role and status', async () => {
    await renderUsers();
    expect(await screen.findByText('Bob Builder')).toBeInTheDocument();
    const carolRow = rowFor('Carol Chen');
    expect(within(carolRow).getByText('Manager')).toBeInTheDocument();
    expect(within(carolRow).getByText('Inactive')).toBeInTheDocument();
    expect(within(carolRow).getByRole('button', { name: 'Activate' })).toBeInTheDocument();
    expect(within(rowFor('Bob Builder')).getByRole('button', { name: 'Deactivate' })).toBeInTheDocument();
  });

  it('creates a user with trimmed fields and reloads the list', async () => {
    let list = [bob];
    const { calls } = await renderUsers({
      'GET /users': () => list,
      'POST /users': (body) => {
        list = [...list, { id: 12, is_active: true, ...body }];
        return list[1];
      },
    });
    await screen.findByText('Bob Builder');
    await userEvent.click(screen.getByRole('button', { name: '+ Add User' }));
    const dialog = screen.getByRole('dialog', { name: 'Add user' });
    await userEvent.type(within(dialog).getByLabelText('First name'), ' Dana ');
    await userEvent.type(within(dialog).getByLabelText('Last name'), 'Diaz');
    await userEvent.type(within(dialog).getByLabelText('Username'), ' dana ');
    await userEvent.type(within(dialog).getByLabelText('Email'), 'dana@acme.test');
    await userEvent.selectOptions(within(dialog).getByLabelText('Role'), 'manager');
    await userEvent.type(within(dialog).getByLabelText('Initial password'), 'longpassword');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Dana Diaz')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(callsTo(calls, 'POST /users')[0].body).toEqual({
      username: 'dana',
      email: 'dana@acme.test',
      first_name: 'Dana',
      last_name: 'Diaz',
      job_title: null,
      role: 'manager',
      password: 'longpassword',
    });
  });

  it('keeps the form open and shows the API error when creation is rejected', async () => {
    const { calls } = await renderUsers({ 'POST /users': apiError(409, 'Username already exists') });
    await screen.findByText('Bob Builder');
    await userEvent.click(screen.getByRole('button', { name: '+ Add User' }));
    const dialog = screen.getByRole('dialog', { name: 'Add user' });
    await userEvent.type(within(dialog).getByLabelText('First name'), 'Bob');
    await userEvent.type(within(dialog).getByLabelText('Last name'), 'Again');
    await userEvent.type(within(dialog).getByLabelText('Username'), 'bob');
    await userEvent.type(within(dialog).getByLabelText('Email'), 'bob2@acme.test');
    await userEvent.type(within(dialog).getByLabelText('Initial password'), 'longpassword');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Username already exists');
    expect(within(dialog).getByRole('button', { name: 'Save' })).toBeEnabled();
    expect(callsTo(calls, 'GET /users')).toHaveLength(1);
  });

  it('does not submit the create form while required fields are empty', async () => {
    const { calls } = await renderUsers();
    await screen.findByText('Bob Builder');
    await userEvent.click(screen.getByRole('button', { name: '+ Add User' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(callsTo(calls, 'POST /users')).toHaveLength(0);
    expect(screen.getByRole('dialog', { name: 'Add user' })).toBeInTheDocument();
  });

  it('edits a user without exposing username, role or password fields', async () => {
    const { calls } = await renderUsers({ 'PATCH /users/10': { ...bob, job_title: 'Lead' } });
    await screen.findByText('Bob Builder');
    await userEvent.click(within(rowFor('Bob Builder')).getByRole('button', { name: 'Edit' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit Bob Builder' });
    expect(within(dialog).queryByLabelText('Username')).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText('Initial password')).not.toBeInTheDocument();
    expect(within(dialog).getByLabelText('Email')).toHaveValue('bob@acme.test');
    const title = within(dialog).getByLabelText('Job title');
    await userEvent.clear(title);
    await userEvent.type(title, 'Lead');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(callsTo(calls, 'PATCH /users/10')[0].body).toEqual({
      email: 'bob@acme.test', first_name: 'Bob', last_name: 'Builder', job_title: 'Lead',
    });
    expect(callsTo(calls, 'GET /users')).toHaveLength(2);
  });

  it('changes a role and shows a conflict when the change is blocked', async () => {
    const { calls } = await renderUsers({
      'PATCH /users/11/role': apiError(409, 'Manager still owns active projects'),
    });
    await screen.findByText('Carol Chen');
    await userEvent.click(within(rowFor('Carol Chen')).getByRole('button', { name: 'Role' }));
    const dialog = screen.getByRole('dialog', { name: 'Change role – Carol Chen' });
    expect(within(dialog).getByLabelText('Role')).toHaveValue('manager');
    await userEvent.selectOptions(within(dialog).getByLabelText('Role'), 'employee');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Manager still owns active projects');
    expect(callsTo(calls, 'PATCH /users/11/role')[0].body).toEqual({ role: 'employee' });
  });

  it('deactivates an active user after confirmation', async () => {
    const { calls } = await renderUsers({ 'PATCH /users/10/status': { ...bob, is_active: false } });
    await screen.findByText('Bob Builder');
    await userEvent.click(within(rowFor('Bob Builder')).getByRole('button', { name: 'Deactivate' }));
    const dialog = screen.getByRole('dialog', { name: 'Deactivate user' });
    expect(dialog).toHaveTextContent('Deactivate Bob Builder? They can no longer sign in');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Deactivate' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(callsTo(calls, 'PATCH /users/10/status')[0].body).toEqual({ is_active: false });
  });

  it('reactivates an inactive user', async () => {
    const { calls } = await renderUsers({ 'PATCH /users/11/status': { ...carol, is_active: true } });
    await screen.findByText('Carol Chen');
    await userEvent.click(within(rowFor('Carol Chen')).getByRole('button', { name: 'Activate' }));
    const dialog = screen.getByRole('dialog', { name: 'Activate user' });
    expect(dialog).toHaveTextContent('Reactivate Carol Chen?');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Activate' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(callsTo(calls, 'PATCH /users/11/status')[0].body).toEqual({ is_active: true });
  });

  it('resets a password, and cancelling a dialog makes no call', async () => {
    const { calls } = await renderUsers({ 'POST /users/10/reset-password': null });
    await screen.findByText('Bob Builder');
    await userEvent.click(within(rowFor('Bob Builder')).getByRole('button', { name: 'Reset password' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await userEvent.click(within(rowFor('Bob Builder')).getByRole('button', { name: 'Reset password' }));
    const dialog = screen.getByRole('dialog', { name: 'Reset password – Bob Builder' });
    await userEvent.type(within(dialog).getByLabelText('New password'), 'brandnewpass');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reset password' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(callsTo(calls, 'POST /users/10/reset-password')).toEqual([
      expect.objectContaining({ body: { new_password: 'brandnewpass' } }),
    ]);
    // Initial load plus one reload for the successful reset; cancelling does not reload.
    expect(callsTo(calls, 'GET /users')).toHaveLength(2);
  });

  it('sends search, role and status filters to the API', async () => {
    const { calls } = await renderUsers({
      'GET /users': (_, url) => {
        const params = new URL(url, 'http://localhost').searchParams;
        return params.get('search') === 'zzz' ? [] : [bob, carol];
      },
    });
    await screen.findByText('Bob Builder');
    await userEvent.selectOptions(screen.getByLabelText('Filter by role'), 'manager');
    await userEvent.selectOptions(screen.getByLabelText('Filter by status'), 'false');
    await userEvent.type(screen.getByLabelText('Search users'), 'zzz');

    expect(await screen.findByText('No users match these filters')).toBeInTheDocument();
    const last = new URL(callsTo(calls, 'GET /users').at(-1).url, 'http://localhost').searchParams;
    expect(Object.fromEntries(last)).toEqual({ limit: '200', role: 'manager', is_active: 'false', search: 'zzz' });
  });

  it('paginates long lists ten at a time', async () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      ...bob, id: 100 + i, username: `user${i}`, first_name: 'User', last_name: `Number${i}`,
    }));
    await renderUsers({ 'GET /users': many });
    expect(await screen.findByText('Showing 1–10 of 12')).toBeInTheDocument();
    expect(screen.getByText('User Number0')).toBeInTheDocument();
    expect(screen.queryByText('User Number10')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('Showing 11–12 of 12')).toBeInTheDocument();
    expect(screen.getByText('User Number11')).toBeInTheDocument();
    expect(screen.queryByText('User Number0')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: 'Previous' }));
    expect(screen.getByText('Showing 1–10 of 12')).toBeInTheDocument();
  });

  it('shows a retryable error when the user list fails to load', async () => {
    let fail = true;
    await renderUsers({
      'GET /users': () => (fail ? apiError(500, 'Database unavailable') : [bob]),
    });
    expect(await screen.findByText('Database unavailable')).toBeInTheDocument();
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Bob Builder')).toBeInTheDocument();
  });
});
