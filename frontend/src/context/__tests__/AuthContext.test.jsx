import { act, render, screen, waitFor } from '@testing-library/react';
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

  describe('silent token refresh', () => {
    const NOW = new Date('2030-06-12T12:00:00Z').getTime();
    const jwtExpiring = (msFromNow, tag = 'a') =>
      `h.${btoa(JSON.stringify({ sub: 'emp', exp: (NOW + msFromNow) / 1000, tag }))}.sig`;

    beforeEach(() => jest.useFakeTimers({ now: NOW }));
    afterEach(() => jest.useRealTimers());

    async function signedIn(token, routes) {
      localStorage.setItem('acme_token', token);
      const calls = mockApi({ 'GET /auth/me': users.employee, ...routes });
      renderProvider();
      await act(() => jest.advanceTimersByTimeAsync(0));
      expect(screen.getByText('user:emp')).toBeInTheDocument();
      return calls;
    }

    it('swaps the token five minutes before it expires, then schedules the next refresh', async () => {
      const second = jwtExpiring(20 * 60 * 1000, 'b');
      const third = jwtExpiring(40 * 60 * 1000, 'c');
      const issued = [second, third];
      const calls = await signedIn(jwtExpiring(10 * 60 * 1000), {
        'POST /auth/refresh': () => ({ access_token: issued.shift(), token_type: 'bearer', expires_in: 1200 }),
      });

      await act(() => jest.advanceTimersByTimeAsync(5 * 60 * 1000 - 1));
      expect(callsTo(calls, 'POST /auth/refresh')).toHaveLength(0);

      await act(() => jest.advanceTimersByTimeAsync(1));
      expect(callsTo(calls, 'POST /auth/refresh')).toHaveLength(1);
      expect(localStorage.getItem('acme_token')).toBe(second);

      // Next refresh is 5 minutes before the new token's expiry (20 min from start).
      await act(() => jest.advanceTimersByTimeAsync(10 * 60 * 1000));
      expect(callsTo(calls, 'POST /auth/refresh')).toHaveLength(2);
      expect(localStorage.getItem('acme_token')).toBe(third);
      expect(screen.getByText('user:emp')).toBeInTheDocument();
    });

    it('refreshes right away when the token is already inside the refresh window', async () => {
      const calls = await signedIn(jwtExpiring(60 * 1000), {
        'POST /auth/refresh': { access_token: jwtExpiring(24 * 3600 * 1000, 'b'), token_type: 'bearer', expires_in: 86400 },
      });
      await act(() => jest.advanceTimersByTimeAsync(0));
      expect(callsTo(calls, 'POST /auth/refresh')).toHaveLength(1);
    });

    it('signs the user out when the server refuses (session too old)', async () => {
      await signedIn(jwtExpiring(60 * 1000), {
        'POST /auth/refresh': apiError(401, 'Session expired; please sign in again'),
      });
      await act(() => jest.advanceTimersByTimeAsync(0));
      expect(screen.getByText('signed out')).toBeInTheDocument();
      expect(localStorage.getItem('acme_token')).toBeNull();
    });

    it('keeps the current token when the refresh request cannot reach the server', async () => {
      const token = jwtExpiring(60 * 1000);
      await signedIn(token, {
        'POST /auth/refresh': () => { throw new TypeError('Failed to fetch'); },
      });
      await act(() => jest.advanceTimersByTimeAsync(0));
      expect(screen.getByText('user:emp')).toBeInTheDocument();
      expect(localStorage.getItem('acme_token')).toBe(token);
    });

    it('does not schedule anything for a token without a readable expiry', async () => {
      const calls = await signedIn('opaque-token');
      await act(() => jest.advanceTimersByTimeAsync(48 * 3600 * 1000));
      expect(callsTo(calls, 'POST /auth/refresh')).toHaveLength(0);
    });

    it('stops the timer on logout', async () => {
      const calls = await signedIn(jwtExpiring(10 * 60 * 1000), {
        'POST /auth/refresh': { access_token: 'x', token_type: 'bearer', expires_in: 1 },
      });
      act(() => screen.getByRole('button', { name: 'logout' }).click());
      await act(() => jest.advanceTimersByTimeAsync(10 * 60 * 1000));
      expect(callsTo(calls, 'POST /auth/refresh')).toHaveLength(0);
    });
  });
});
