import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import AppLayout from '../AppLayout';
import ProtectedRoute from '../ProtectedRoute';
import { renderApp, users } from '../../../test/utils';

/** Mounted behind ProtectedRoute exactly as App does, so signing out unmounts the layout. */
function renderLayout(user, route = '/home') {
  return renderApp(
    <Routes>
      <Route path="/" element={<h1>Login page</h1>} />
      <Route element={<ProtectedRoute />}>
        <Route element={<AppLayout />}>
          <Route path="/home" element={<h1>Home content</h1>} />
          <Route path="/profile" element={<h1>Profile content</h1>} />
          <Route path="/projects" element={<h1>Projects content</h1>} />
          <Route path="/admin" element={<h1>Admin content</h1>} />
          <Route path="/admin/users" element={<h1>People content</h1>} />
          <Route path="/schedule" element={<h1>Schedule content</h1>} />
        </Route>
      </Route>
    </Routes>,
    { user, route },
  );
}

const mainNavLabels = () =>
  within(screen.getByRole('navigation', { name: 'Main' })).getAllByRole('link').map((a) => a.textContent);

describe('AppLayout', () => {
  it.each([
    ['admin', ['Dashboard', 'Projects', 'People', 'Organization', 'Compensation', 'Audit Logs', 'Archived Projects']],
    ['manager', ['Dashboard', 'My Projects', 'Team', 'Schedule']],
    ['employee', ['Dashboard', 'My Schedule', 'My Projects']],
  ])('shows the %s navigation', async (role, labels) => {
    await renderLayout(users[role]);
    expect(mainNavLabels()).toEqual(labels);
    expect(screen.getByRole('heading', { name: 'Home content' })).toBeInTheDocument();
  });

  it('shows no links for an unknown role', async () => {
    await renderLayout({ ...users.employee, role: 'contractor' });
    expect(within(screen.getByRole('navigation', { name: 'Main' })).queryAllByRole('link')).toHaveLength(0);
  });

  it('highlights the active link; the dashboard link only matches exactly', async () => {
    await renderLayout(users.admin, '/admin/users');
    const nav = within(screen.getByRole('navigation', { name: 'Main' }));
    expect(nav.getByRole('link', { name: 'People' })).toHaveClass('bg-indigo-50');
    expect(nav.getByRole('link', { name: 'Dashboard' })).not.toHaveClass('bg-indigo-50');
  });

  it('navigates with the main links', async () => {
    await renderLayout(users.employee);
    await userEvent.click(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('link', { name: 'My Schedule' }));
    expect(screen.getByRole('heading', { name: 'Schedule content' })).toBeInTheDocument();
  });

  it('toggles the mobile menu, which closes after choosing a link', async () => {
    await renderLayout(users.manager);
    const toggle = screen.getByRole('button', { name: 'Toggle navigation' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('navigation', { name: 'Mobile' })).not.toBeInTheDocument();

    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const mobile = within(screen.getByRole('navigation', { name: 'Mobile' }));
    expect(mobile.getAllByRole('link').map((a) => a.textContent)).toEqual(['Dashboard', 'My Projects', 'Team', 'Schedule']);

    await userEvent.click(mobile.getByRole('link', { name: 'My Projects' }));
    expect(screen.getByRole('heading', { name: 'Projects content' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Mobile' })).not.toBeInTheDocument();

    await userEvent.click(toggle);
    await userEvent.click(toggle);
    expect(screen.queryByRole('navigation', { name: 'Mobile' })).not.toBeInTheDocument();
  });

  it('opens the account menu with the user name and role, and links to the profile', async () => {
    await renderLayout(users.manager);
    const accountButton = screen.getByRole('button', { name: /Max Manager/ });
    expect(accountButton).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(accountButton);
    const menu = within(screen.getByRole('menu'));
    expect(menu.getByText('Max Manager')).toBeInTheDocument();
    expect(menu.getByText('Manager')).toBeInTheDocument();

    await userEvent.click(menu.getByRole('menuitem', { name: 'Profile' }));
    expect(screen.getByRole('heading', { name: 'Profile content' })).toBeInTheDocument();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('closes the account menu when toggled again', async () => {
    await renderLayout(users.employee);
    const accountButton = screen.getByRole('button', { name: /Eve Employee/ });
    await userEvent.click(accountButton);
    await userEvent.click(accountButton);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('signs out: clears the session and returns to the login page', async () => {
    await renderLayout(users.admin);
    await userEvent.click(screen.getByRole('button', { name: /Ada Admin/ }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Sign out' }));
    expect(screen.getByRole('heading', { name: 'Login page' })).toBeInTheDocument();
    expect(localStorage.getItem('acme_token')).toBeNull();
  });
});
