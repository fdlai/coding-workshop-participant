import { screen } from '@testing-library/react';
import App from '../App';
import { renderApp, users } from '../test/utils';

/**
 * Pages are replaced with stubs that just name themselves, so these tests cover
 * routing, guards and the layout only. Each page has its own tests.
 */
function mockPage(name) {
  const { createElement } = require('react');
  const { useParams } = require('react-router-dom');
  return function MockPage() {
    const { id } = useParams();
    return createElement('h1', null, id ? `${name} ${id}` : name);
  };
}

jest.mock('../pages/LoginPage', () => mockPage('Login page'));
jest.mock('../pages/AdminDashboard', () => mockPage('Admin dashboard'));
jest.mock('../pages/ManagerDashboard', () => mockPage('Manager dashboard'));
jest.mock('../pages/EmployeeDashboard', () => mockPage('Employee dashboard'));
jest.mock('../pages/projects/ProjectListPage', () => mockPage('Project list'));
jest.mock('../pages/projects/ProjectDetailPage', () => mockPage('Project detail'));
jest.mock('../pages/admin/UsersPage', () => mockPage('Users page'));
jest.mock('../pages/admin/OrganizationPage', () => mockPage('Organization page'));
jest.mock('../pages/admin/CompensationPage', () => mockPage('Compensation page'));
jest.mock('../pages/admin/AuditPage', () => mockPage('Audit page'));
jest.mock('../pages/admin/ArchivesPage', () => mockPage('Archives page'));
jest.mock('../pages/TeamPage', () => mockPage('Team page'));
jest.mock('../pages/SchedulePage', () => mockPage('Schedule page'));
jest.mock('../pages/ProfilePage', () => mockPage('Profile page'));

const heading = (name) => screen.findByRole('heading', { level: 1, name });

describe('App routing', () => {
  describe('signed out', () => {
    it.each(['/', '/admin', '/projects/4', '/schedule', '/no/such/page'])('%s shows the login page', async (route) => {
      await renderApp(<App />, { route });
      expect(await heading('Login page')).toBeInTheDocument();
      expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
    });
  });

  describe('allowed routes render inside the layout', () => {
    it.each([
      ['admin', '/admin', 'Admin dashboard'],
      ['admin', '/admin/users', 'Users page'],
      ['admin', '/admin/organization', 'Organization page'],
      ['admin', '/admin/compensation', 'Compensation page'],
      ['admin', '/admin/audit', 'Audit page'],
      ['admin', '/admin/archives', 'Archives page'],
      ['admin', '/projects', 'Project list'],
      ['manager', '/manager', 'Manager dashboard'],
      ['manager', '/team', 'Team page'],
      ['manager', '/schedule', 'Schedule page'],
      ['manager', '/projects/7', 'Project detail 7'],
      ['employee', '/employee', 'Employee dashboard'],
      ['employee', '/schedule', 'Schedule page'],
      ['employee', '/profile', 'Profile page'],
    ])('%s can open %s', async (role, route, page) => {
      await renderApp(<App />, { user: users[role], route });
      expect(await heading(page)).toBeInTheDocument();
      expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument();
    });
  });

  describe('wrong-role access shows permission denied inside the layout', () => {
    it.each([
      ['employee', '/admin'],
      ['manager', '/admin/users'],
      ['employee', '/team'],
      ['admin', '/manager'],
      ['manager', '/employee'],
      ['admin', '/schedule'],
    ])('%s at %s', async (role, route) => {
      await renderApp(<App />, { user: users[role], route });
      expect(await screen.findByText('Access denied')).toBeInTheDocument();
      expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument();
      expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument();
    });
  });

  describe('unknown URLs fall back to the role dashboard', () => {
    it.each([
      ['admin', 'Admin dashboard'],
      ['manager', 'Manager dashboard'],
      ['employee', 'Employee dashboard'],
    ])('%s goes to %s', async (role, page) => {
      await renderApp(<App />, { user: users[role], route: '/definitely/not/here' });
      expect(await heading(page)).toBeInTheDocument();
    });
  });
});
