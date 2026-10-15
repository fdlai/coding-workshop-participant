import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import ProtectedRoute from '../ProtectedRoute';
import { AuthProvider } from '../../../context/AuthContext';
import { mockApi, users } from '../../../test/utils';

function renderGuarded({ roles, route = '/secret' } = {}) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<h1>Login page</h1>} />
          <Route element={<ProtectedRoute roles={roles} />}>
            <Route path="/secret" element={<h1>Secret content</h1>} />
          </Route>
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

function signIn(user) {
  localStorage.setItem('acme_token', 'token');
  mockApi({ 'GET /auth/me': user });
}

describe('ProtectedRoute', () => {
  it('shows a loading state while the session is restored', async () => {
    signIn(users.employee);
    renderGuarded();
    expect(screen.getByRole('status')).toHaveTextContent('Restoring your session…');
    expect(await screen.findByRole('heading', { name: 'Secret content' })).toBeInTheDocument();
  });

  it('redirects to the login page when signed out', () => {
    mockApi({});
    renderGuarded();
    expect(screen.getByRole('heading', { name: 'Login page' })).toBeInTheDocument();
    expect(screen.queryByText('Secret content')).not.toBeInTheDocument();
  });

  it('lets any signed-in user through when no roles are required', async () => {
    signIn(users.manager);
    renderGuarded();
    expect(await screen.findByRole('heading', { name: 'Secret content' })).toBeInTheDocument();
  });

  it('allows users whose role is listed', async () => {
    signIn(users.manager);
    renderGuarded({ roles: ['manager', 'employee'] });
    expect(await screen.findByRole('heading', { name: 'Secret content' })).toBeInTheDocument();
  });

  it('shows permission denied to users with the wrong role', async () => {
    signIn(users.employee);
    renderGuarded({ roles: ['admin'] });
    expect(await screen.findByText('Access denied')).toBeInTheDocument();
    expect(screen.queryByText('Secret content')).not.toBeInTheDocument();
  });
});
