import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import LoginPage from '../LoginPage';
import { apiError, callsTo, renderApp, users } from '../../test/utils';

function renderLogin(routes) {
  return renderApp(
    <Routes>
      <Route path="/" element={<LoginPage />} />
      <Route path="/admin" element={<h1>Admin home</h1>} />
      <Route path="/employee" element={<h1>Employee home</h1>} />
    </Routes>,
    { routes },
  );
}

describe('LoginPage', () => {
  it('signs in, stores the token and redirects to the role dashboard', async () => {
    const { calls } = await renderLogin({
      'POST /auth/login': { access_token: 'jwt-1', token_type: 'bearer' },
      'GET /auth/me': users.admin,
    });
    await userEvent.type(screen.getByLabelText('Username'), '  admin ');
    await userEvent.type(screen.getByLabelText('Password'), 'secret');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('heading', { name: 'Admin home' })).toBeInTheDocument();
    expect(localStorage.getItem('acme_token')).toBe('jwt-1');
    expect(callsTo(calls, 'POST /auth/login')[0].body).toEqual({ username: 'admin', password: 'secret' });
  });

  it('shows the API error and re-enables the form when login fails', async () => {
    await renderLogin({ 'POST /auth/login': apiError(401, 'Invalid username or password') });
    await userEvent.type(screen.getByLabelText('Username'), 'admin');
    await userEvent.type(screen.getByLabelText('Password'), 'wrong');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('Invalid username or password')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
    expect(localStorage.getItem('acme_token')).toBeNull();
  });

  it('toggles password visibility', async () => {
    await renderLogin();
    const input = screen.getByLabelText('Password');
    expect(input).toHaveAttribute('type', 'password');
    await userEvent.click(screen.getByRole('button', { name: 'Show' }));
    expect(input).toHaveAttribute('type', 'text');
    await userEvent.click(screen.getByRole('button', { name: 'Hide' }));
    expect(input).toHaveAttribute('type', 'password');
  });

  it('redirects an already signed-in user straight to their dashboard', async () => {
    localStorage.setItem('acme_token', 'existing');
    await renderLogin({ 'GET /auth/me': users.employee });
    expect(await screen.findByRole('heading', { name: 'Employee home' })).toBeInTheDocument();
  });
});
