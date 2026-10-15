import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuthProvider, useAuth } from '../AuthContext';
import { request } from '../../services/api';
import { apiError, callsTo, mockApi, users } from '../../test/utils';

/** Shows the auth state and exposes its actions as buttons. */
function Probe() {
  const { user, loading, login, logout } = useAuth();
  return (
    <div>
      <p>{loading ? 'loading' : 'ready'}</p>
      <p>{user ? `user:${user.username}` : 'signed out'}</p>
      <button type="button" onClick={() => login('admin', 'secret').catch(() => {})}>login</button>
      <button type="button" onClick={logout}>logout</button>
      <button type="button" onClick={() => request('/projects').catch(() => {})}>call api</button>
    </div>
  );
}

const renderProvider = () => render(<AuthProvider><Probe /></AuthProvider>);

describe('AuthProvider', () => {
  it('is ready and signed out when there is no stored token', () => {
    const calls = mockApi({});
    renderProvider();
    expect(screen.getByText('ready')).toBeInTheDocument();
    expect(screen.getByText('signed out')).toBeInTheDocument();
    expect(calls).toHaveLength(0);
  });

  it('restores the session from a stored token', async () => {
    localStorage.setItem('acme_token', 'stored');
    const calls = mockApi({ 'GET /auth/me': users.manager });
    renderProvider();
    expect(screen.getByText('loading')).toBeInTheDocument();
    expect(await screen.findByText('user:mgr')).toBeInTheDocument();
    expect(screen.getByText('ready')).toBeInTheDocument();
    expect(callsTo(calls, 'GET /auth/me')).toHaveLength(1);
  });

  it('clears an invalid stored token when the restore fails', async () => {
    localStorage.setItem('acme_token', 'expired');
    mockApi({ 'GET /auth/me': apiError(401, 'Token expired') });
    renderProvider();
    expect(await screen.findByText('ready')).toBeInTheDocument();
    expect(screen.getByText('signed out')).toBeInTheDocument();
    expect(localStorage.getItem('acme_token')).toBeNull();
  });

  it('logs in: stores the token and loads the user', async () => {
    const calls = mockApi({
      'POST /auth/login': { access_token: 'jwt-9', token_type: 'bearer' },
      'GET /auth/me': users.admin,
    });
    renderProvider();
    await userEvent.click(screen.getByRole('button', { name: 'login' }));
    expect(await screen.findByText('user:admin')).toBeInTheDocument();
    expect(localStorage.getItem('acme_token')).toBe('jwt-9');
    expect(callsTo(calls, 'POST /auth/login')[0].body).toEqual({ username: 'admin', password: 'secret' });
    expect(callsTo(calls, 'GET /auth/me')).toHaveLength(1);
  });

  it('stays signed out when login fails', async () => {
    mockApi({ 'POST /auth/login': apiError(401, 'Invalid username or password') });
    renderProvider();
    await userEvent.click(screen.getByRole('button', { name: 'login' }));
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    expect(screen.getByText('signed out')).toBeInTheDocument();
    expect(localStorage.getItem('acme_token')).toBeNull();
  });

  it('logout clears the token and the user', async () => {
    localStorage.setItem('acme_token', 'stored');
    mockApi({ 'GET /auth/me': users.employee });
    renderProvider();
    await screen.findByText('user:emp');
    await userEvent.click(screen.getByRole('button', { name: 'logout' }));
    expect(screen.getByText('signed out')).toBeInTheDocument();
    expect(localStorage.getItem('acme_token')).toBeNull();
  });

  it('logs out when any authenticated API call returns 401', async () => {
    localStorage.setItem('acme_token', 'stored');
    mockApi({ 'GET /auth/me': users.employee, 'GET /projects': apiError(401, 'Session expired') });
    renderProvider();
    await screen.findByText('user:emp');
    await userEvent.click(screen.getByRole('button', { name: 'call api' }));
    expect(await screen.findByText('signed out')).toBeInTheDocument();
    expect(localStorage.getItem('acme_token')).toBeNull();
  });
});
