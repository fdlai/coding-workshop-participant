import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AdminDashboard from '../AdminDashboard';
import { apiError, callsTo, renderApp, users } from '../../test/utils';
import { projectHealth } from '../../test/fixtures';

function adminPayload(overrides = {}) {
  return {
    active_projects: 3,
    employees: 42,
    managers: 6,
    projects_at_risk: 2,
    health_counts: { on_track: 1, at_risk: 1, over_budget: 1 },
    projects: [projectHealth(1), projectHealth(2), projectHealth(3)],
    recent_activity: [
      {
        id: 99,
        created_at: '2030-06-12T09:30:00Z',
        actor: users.admin,
        action: 'create',
        entity_type: 'project',
        entity_id: 1,
        description: 'Created project Project 1',
        changes: null,
      },
    ],
    ...overrides,
  };
}

const metric = (label) => screen.getByText(label).nextElementSibling;

describe('AdminDashboard', () => {
  it('shows company-wide metrics, budget health, activity and projects', async () => {
    const { calls } = await renderApp(<AdminDashboard />, { user: users.admin, routes: { 'GET /dashboard/admin': adminPayload() } });

    expect(screen.getByRole('heading', { name: 'Admin Dashboard' })).toBeInTheDocument();
    expect(await screen.findByText('Created project Project 1')).toBeInTheDocument();
    expect(callsTo(calls, 'GET /dashboard/admin')).toHaveLength(1);

    expect(metric('Employees')).toHaveTextContent('42');
    expect(metric('Managers')).toHaveTextContent('6');
    expect(metric('Projects at risk')).toHaveTextContent('2');
    expect(metric('Projects at risk')).toHaveClass('text-amber-600');

    expect(screen.getByRole('img', { name: 'Budget health distribution' })).toBeInTheDocument();
    expect(screen.getAllByRole('tooltip', { hidden: true })).toHaveLength(3);

    const activity = screen.getByText('Created project Project 1').closest('li');
    expect(activity).toHaveTextContent(/Ada Admin · Jun 12, 2030/);
    expect(screen.getByRole('link', { name: 'View all' })).toHaveAttribute('href', '/admin/audit');

    const projectsCard = screen.getByRole('heading', { name: 'Active projects' }).closest('section');
    expect(within(projectsCard).getAllByRole('link').map((a) => a.textContent)).toEqual(['Project 1', 'Project 2', 'Project 3']);
  });

  it('shows empty states when there is no activity or project', async () => {
    await renderApp(<AdminDashboard />, {
      user: users.admin,
      routes: {
        'GET /dashboard/admin': adminPayload({
          active_projects: 0,
          projects_at_risk: 0,
          health_counts: { on_track: 0, at_risk: 0, over_budget: 0 },
          projects: [],
          recent_activity: [],
        }),
      },
    });
    expect(await screen.findByText('No activity yet')).toBeInTheDocument();
    expect(screen.getByText('No active projects')).toBeInTheDocument();
    expect(metric('Projects at risk')).not.toHaveClass('text-amber-600');
  });

  it('shows the error and retries', async () => {
    let attempts = 0;
    await renderApp(<AdminDashboard />, {
      user: users.admin,
      routes: {
        'GET /dashboard/admin': () => {
          attempts += 1;
          return attempts === 1 ? apiError(500, 'Dashboard unavailable') : adminPayload();
        },
      },
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('Dashboard unavailable');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Created project Project 1')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows permission denied when the API refuses access', async () => {
    await renderApp(<AdminDashboard />, { user: users.admin, routes: { 'GET /dashboard/admin': apiError(403, 'Admins only') } });
    expect(await screen.findByText('Access denied')).toBeInTheDocument();
    expect(screen.getByText('Admins only')).toBeInTheDocument();
  });
});
