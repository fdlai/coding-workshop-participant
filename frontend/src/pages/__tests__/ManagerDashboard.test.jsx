import { screen, within } from '@testing-library/react';
import ManagerDashboard from '../ManagerDashboard';
import { apiError, renderApp, users } from '../../test/utils';
import { person, projectHealth } from '../../test/fixtures';

function managerPayload(overrides = {}) {
  return {
    projects: [projectHealth(1), projectHealth(2)],
    upcoming_milestones: [
      { id: 7, name: 'Beta launch', project_id: 1, project_name: 'Project 1', start_date: '2030-06-01', end_date: '2030-06-20', days_remaining: 8 },
    ],
    team_size: 5,
    employees_scheduled_now: 3,
    budget_at_risk: 1,
    unscheduled_team_members: [person(11, 'Ian', 'Idle'), person(12, 'Fay', 'Free')],
    ...overrides,
  };
}

const metric = (label) => screen.getByText(label).nextElementSibling;
const card = (title) => screen.getByRole('heading', { name: title }).closest('section');

describe('ManagerDashboard', () => {
  it('shows team metrics, projects, upcoming milestones and unscheduled people', async () => {
    await renderApp(<ManagerDashboard />, { user: users.manager, routes: { 'GET /dashboard/manager': managerPayload() } });

    expect(await screen.findByRole('link', { name: 'Beta launch' })).toHaveAttribute('href', '/projects/1');
    expect(metric('Active projects')).toHaveTextContent('2');
    expect(metric('Team size')).toHaveTextContent('5');
    expect(metric('Scheduled now')).toHaveTextContent('3');
    expect(metric('Budgets at risk')).toHaveTextContent('1');
    expect(metric('Budgets at risk')).toHaveClass('text-amber-600');

    expect(within(card('My active projects')).getByRole('link', { name: 'All projects' })).toHaveAttribute('href', '/projects');
    expect(within(card('My active projects')).getByRole('link', { name: 'Project 2' })).toBeInTheDocument();
    expect(within(card('Upcoming milestones')).getByText('Project 1 · ends Jun 20, 2030 (8 days)')).toBeInTheDocument();
    const unscheduled = within(card('Not scheduled right now'));
    expect(unscheduled.getAllByRole('listitem')).toHaveLength(2);
    expect(unscheduled.getByText('Ian Idle')).toBeInTheDocument();
    expect(unscheduled.getByText('Fay Free')).toBeInTheDocument();
  });

  it('shows empty states for a manager with nothing going on', async () => {
    await renderApp(<ManagerDashboard />, {
      user: users.manager,
      routes: {
        'GET /dashboard/manager': managerPayload({ projects: [], upcoming_milestones: [], unscheduled_team_members: [], budget_at_risk: 0 }),
      },
    });
    expect(await screen.findByText('Nothing upcoming')).toBeInTheDocument();
    expect(screen.getByText('No active projects')).toBeInTheDocument();
    expect(screen.getByText('Everyone on your team is scheduled.')).toBeInTheDocument();
    expect(metric('Budgets at risk')).not.toHaveClass('text-amber-600');
  });

  it('shows an error when the dashboard fails to load', async () => {
    await renderApp(<ManagerDashboard />, { user: users.manager, routes: { 'GET /dashboard/manager': apiError(500, 'Server error') } });
    expect(await screen.findByRole('alert')).toHaveTextContent('Server error');
  });
});
