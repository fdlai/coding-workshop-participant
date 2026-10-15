/**
 * Shared helpers for component tests.
 *
 * `mockApi(routes)` replaces `fetch` with a fake backend keyed by "METHOD /path"
 * (path below /api/v1, query string ignored). A route value can be a response body,
 * a function `(body, url) => body`, or `apiError(status, detail)`. Unmatched calls
 * fail the test loudly so missing mocks are obvious.
 *
 * `renderApp(ui, { user, route })` renders inside the real AuthProvider and a
 * MemoryRouter. Passing `user` signs that user in (via a stored token and GET /auth/me).
 */
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from '../context/AuthContext';

const API_PREFIX = '/api/v1';

export function apiError(status, detail) {
  return { __error: true, status, detail };
}

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  };
}

export function mockApi(routes = {}) {
  const calls = [];
  global.fetch = jest.fn(async (url, options = {}) => {
    const method = options.method || 'GET';
    const path = new URL(url, 'http://localhost').pathname.split(API_PREFIX)[1];
    const body = options.body ? JSON.parse(options.body) : undefined;
    calls.push({ method, path, body, url });
    const key = `${method} ${path}`;
    if (!(key in routes)) throw new Error(`Unmocked API call: ${key}`);
    let value = routes[key];
    if (typeof value === 'function') value = value(body, url);
    if (value && value.__error) return jsonResponse(value.status, { detail: value.detail });
    if (value === null) return jsonResponse(204, null);
    return jsonResponse(200, value);
  });
  return calls;
}

/** Find calls made to the fake backend, e.g. callsTo(calls, 'POST /projects'). */
export const callsTo = (calls, key) => calls.filter((c) => `${c.method} ${c.path}` === key);

export const users = {
  admin: { id: 1, username: 'admin', first_name: 'Ada', last_name: 'Admin', role: 'admin', email: 'admin@acme.test', is_active: true, job_title: 'Administrator' },
  manager: { id: 2, username: 'mgr', first_name: 'Max', last_name: 'Manager', role: 'manager', email: 'mgr@acme.test', is_active: true, job_title: 'Engineering Manager' },
  employee: { id: 3, username: 'emp', first_name: 'Eve', last_name: 'Employee', role: 'employee', email: 'emp@acme.test', is_active: true, job_title: 'Engineer' },
};

/**
 * Render `ui` with auth + routing. `path` is the route pattern (for useParams),
 * `route` the URL to open. Waits for the session to be restored when `user` is set.
 */
export async function renderApp(ui, { user, route = '/', path, routes = {} } = {}) {
  if (user) {
    localStorage.setItem('acme_token', 'test-token');
    if (!('GET /auth/me' in routes)) routes['GET /auth/me'] = user;
  }
  const calls = mockApi(routes);
  const element = path ? (
    <Routes>
      <Route path={path} element={ui} />
      <Route path="*" element={<div>Navigated away</div>} />
    </Routes>
  ) : ui;
  const result = render(
    <MemoryRouter initialEntries={[route]}>
      <AuthProvider>
        <SessionGate>{element}</SessionGate>
      </AuthProvider>
    </MemoryRouter>,
  );
  if (user) await screen.findByTestId('session-ready');
  return { ...result, calls };
}

/** Holds rendering until the stored session is restored, like ProtectedRoute does. */
function SessionGate({ children }) {
  const { loading } = useAuth();
  if (loading) return null;
  return (
    <>
      <span data-testid="session-ready" hidden />
      {children}
    </>
  );
}
