import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ProfilePage from '../ProfilePage';
import { apiError, callsTo, renderApp, users } from '../../test/utils';

const summaryCard = () => screen.getByText(/^@/).closest('section');

async function changePassword(current, next, confirm) {
  await userEvent.type(screen.getByLabelText('Current password'), current);
  await userEvent.type(screen.getByLabelText('New password'), next);
  await userEvent.type(screen.getByLabelText('Confirm new password'), confirm);
  await userEvent.click(screen.getByRole('button', { name: 'Change password' }));
}

describe('ProfilePage', () => {
  it('shows the signed-in user with their editable details', async () => {
    await renderApp(<ProfilePage />, { user: users.manager });
    expect(screen.getByRole('heading', { name: 'My Profile' })).toBeInTheDocument();
    expect(within(summaryCard()).getByText('Max Manager')).toBeInTheDocument();
    expect(within(summaryCard()).getByText('@mgr')).toBeInTheDocument();
    expect(within(summaryCard()).getByText('Manager')).toBeInTheDocument();
    expect(screen.getByLabelText('First name')).toHaveValue('Max');
    expect(screen.getByLabelText('Job title')).toHaveValue('Engineering Manager');
    expect(screen.getByLabelText('Profile picture URL')).toHaveValue('');
    expect(screen.getByLabelText('Email')).toHaveValue('mgr@acme.test');
    expect(screen.getByLabelText('Email')).toBeDisabled();
  });

  it('saves trimmed profile changes, sends blanks as null and updates the header', async () => {
    const { calls } = await renderApp(<ProfilePage />, {
      user: users.manager,
      routes: { 'PATCH /users/me': (body) => ({ ...users.manager, ...body }) },
    });
    await userEvent.clear(screen.getByLabelText('First name'));
    await userEvent.type(screen.getByLabelText('First name'), '  Maxine ');
    await userEvent.clear(screen.getByLabelText('Job title'));

    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Profile updated.');
    expect(callsTo(calls, 'PATCH /users/me')[0].body).toEqual({
      first_name: 'Maxine',
      last_name: 'Manager',
      job_title: null,
      profile_picture_url: null,
    });
    expect(within(summaryCard()).getByText('Maxine Manager')).toBeInTheDocument();
  });

  it('shows the profile picture once a URL is saved', async () => {
    await renderApp(<ProfilePage />, {
      user: users.employee,
      routes: { 'PATCH /users/me': (body) => ({ ...users.employee, ...body }) },
    });
    await userEvent.type(screen.getByLabelText('Profile picture URL'), 'https://img.test/eve.png');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByRole('img', { name: 'Eve Employee' })).toHaveAttribute('src', 'https://img.test/eve.png');
  });

  it('shows the API error when saving the profile fails', async () => {
    await renderApp(<ProfilePage />, { user: users.employee, routes: { 'PATCH /users/me': apiError(422, 'Invalid URL') } });
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid URL');
    expect(within(summaryCard()).getByText('Eve Employee')).toBeInTheDocument();
  });

  it('rejects mismatched new passwords without calling the API', async () => {
    const { calls } = await renderApp(<ProfilePage />, { user: users.employee });
    await changePassword('oldsecret', 'newsecret1', 'newsecret2');
    expect(screen.getByRole('alert')).toHaveTextContent('New passwords do not match.');
    expect(callsTo(calls, 'POST /auth/change-password')).toHaveLength(0);
  });

  it('changes the password and clears the form', async () => {
    const { calls } = await renderApp(<ProfilePage />, { user: users.employee, routes: { 'POST /auth/change-password': null } });
    await changePassword('oldsecret', 'newsecret1', 'newsecret1');
    expect(await screen.findByRole('status')).toHaveTextContent('Password changed.');
    expect(callsTo(calls, 'POST /auth/change-password')[0].body).toEqual({ current_password: 'oldsecret', new_password: 'newsecret1' });
    expect(screen.getByLabelText('Current password')).toHaveValue('');
    expect(screen.getByLabelText('New password')).toHaveValue('');
    expect(screen.getByLabelText('Confirm new password')).toHaveValue('');
  });

  it('shows the API error when the current password is wrong', async () => {
    await renderApp(<ProfilePage />, {
      user: users.employee,
      routes: { 'POST /auth/change-password': apiError(400, 'Current password is incorrect') },
    });
    await changePassword('wrongpass', 'newsecret1', 'newsecret1');
    expect(await screen.findByRole('alert')).toHaveTextContent('Current password is incorrect');
    expect(screen.getByLabelText('Current password')).toHaveValue('wrongpass');
  });
});
