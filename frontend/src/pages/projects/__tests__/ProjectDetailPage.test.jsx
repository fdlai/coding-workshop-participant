import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ProjectDetailPage from '../ProjectDetailPage';
import { apiError, callsTo, renderApp, users } from '../../../test/utils';
import { makeBudget, makeMilestone, makeProject, makeTimeline } from '../../../test/projectFixtures';

const design = makeMilestone(31, 'Design', { status: 'completed', completed_at: '2030-06-10T15:00:00Z' });
const build = makeMilestone(32, 'Build', { start_date: '2030-07-01', end_date: '2030-08-31' });
const dropped = makeMilestone(33, 'Dropped scope', { status: 'cancelled' });

function renderDetail(user, routes = {}) {
  return renderApp(<ProjectDetailPage />, {
    user,
    route: '/projects/7',
    path: '/projects/:id',
    routes: {
      'GET /projects/7': makeProject(),
      'GET /projects/7/timeline': makeTimeline([design, build, dropped]),
      'GET /projects/7/budget': makeBudget(),
      'GET /users': [users.manager],
      ...routes,
    },
  });
}

describe('ProjectDetailPage', () => {
  describe('loading and errors', () => {
    it('shows "not found" with a retry when the project does not exist', async () => {
      await renderDetail(users.admin, { 'GET /projects/7': apiError(404, 'Project not found') });
      expect(await screen.findByText('Something went wrong')).toBeInTheDocument();
      expect(screen.getByText('Project not found')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    });

    it('shows access denied when the user may not see the project', async () => {
      await renderDetail(users.employee, { 'GET /projects/7': apiError(403, 'You are not assigned to this project') });
      expect(await screen.findByText('Access denied')).toBeInTheDocument();
      expect(screen.getByText('You are not assigned to this project')).toBeInTheDocument();
    });

    it('shows a connection error when the API is unreachable and recovers on retry', async () => {
      let online = false;
      await renderDetail(users.admin, {
        'GET /projects/7': () => {
          if (!online) throw new TypeError('Failed to fetch');
          return makeProject();
        },
      });
      expect(await screen.findByText('Unable to reach the server. Check your connection and try again.')).toBeInTheDocument();
      online = true;
      await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
      expect(await screen.findByRole('heading', { name: 'Apollo Platform' })).toBeInTheDocument();
    });
  });

  describe('overview tab', () => {
    it('shows project info, milestone progress, budget health and the timeline', async () => {
      await renderDetail(users.admin);
      expect(await screen.findByRole('heading', { name: 'Apollo Platform' })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: '← Back to projects' })).toHaveAttribute('href', '/projects');
      expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByText('Replatform the billing stack.')).toBeInTheDocument();
      // Cancelled milestones are left out of progress: 1 of 2 done.
      expect(screen.getByText('1/2')).toBeInTheDocument();
      expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50');
      expect(await screen.findByText('$42,000.00')).toBeInTheDocument();
      expect(screen.getByText('On track')).toBeInTheDocument();
      expect(screen.getByTitle(/^Build: Jul 1, 2030/)).toBeInTheDocument();
      expect(screen.queryByTitle(/^Dropped scope/)).not.toBeInTheDocument();
    });

    it('says when there are no milestones and no description', async () => {
      await renderDetail(users.admin, {
        'GET /projects/7': makeProject({ description: null }),
        'GET /projects/7/timeline': makeTimeline([]),
      });
      expect(await screen.findByText('No milestones yet.')).toBeInTheDocument();
      expect(screen.getByText('No description provided.')).toBeInTheDocument();
      expect(screen.getByText('0/0')).toBeInTheDocument();
    });

    it('lets an admin edit the project, including its manager', async () => {
      let project = makeProject();
      const { calls } = await renderDetail(users.admin, {
        'GET /projects/7': () => project,
        'PATCH /projects/7': (body) => { project = { ...project, ...body, updated_at: '2030-06-12T10:00:00Z' }; return project; },
      });
      await userEvent.click(await screen.findByRole('button', { name: 'Edit Project' }));
      const dialog = screen.getByRole('dialog', { name: 'Edit project' });
      expect(within(dialog).getByLabelText('Name')).toHaveValue('Apollo Platform');
      await within(dialog).findByRole('option', { name: 'Max Manager' });
      expect(within(dialog).getByLabelText('Project manager')).toHaveValue('2');
      const name = within(dialog).getByLabelText('Name');
      await userEvent.clear(name);
      await userEvent.type(name, 'Apollo 2');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));

      expect(await screen.findByRole('heading', { name: 'Apollo 2' })).toBeInTheDocument();
      expect(callsTo(calls, 'PATCH /projects/7')[0].body).toEqual({
        name: 'Apollo 2',
        description: 'Replatform the billing stack.',
        manager_id: 2,
        start_date: '2030-06-01',
        estimated_end_date: '2030-09-30',
        estimated_budget: '100000.00',
      });
    });

    it('lets the owning manager edit without changing the manager', async () => {
      const { calls } = await renderDetail(users.manager, { 'PATCH /projects/7': makeProject() });
      await userEvent.click(await screen.findByRole('button', { name: 'Edit Project' }));
      const dialog = screen.getByRole('dialog', { name: 'Edit project' });
      expect(within(dialog).queryByLabelText('Project manager')).not.toBeInTheDocument();
      await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(callsTo(calls, 'PATCH /projects/7')[0].body).not.toHaveProperty('manager_id');
      expect(callsTo(calls, 'GET /users')).toHaveLength(0);
      // Managers cannot archive.
      expect(screen.queryByRole('button', { name: 'Archive' })).not.toBeInTheDocument();
    });

    it('shows the edit error when the update is rejected', async () => {
      await renderDetail(users.manager, { 'PATCH /projects/7': apiError(409, 'Milestones fall outside the new dates') });
      await userEvent.click(await screen.findByRole('button', { name: 'Edit Project' }));
      await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('Milestones fall outside the new dates');
    });

    it.each([
      ['Mark completed', 'Complete project', 'Complete', 'completed'],
      ['Abandon', 'Abandon project', 'Abandon', 'abandoned'],
    ])('%s sets the project status after confirmation', async (button, title, confirm, status) => {
      let project = makeProject();
      const { calls } = await renderDetail(users.manager, {
        'GET /projects/7': () => project,
        'PATCH /projects/7/status': (body) => { project = { ...project, status: body.status }; return project; },
      });
      await userEvent.click(await screen.findByRole('button', { name: button }));
      const dialog = screen.getByRole('dialog', { name: title });
      await userEvent.click(within(dialog).getByRole('button', { name: confirm }));

      await waitFor(() => expect(screen.queryByRole('button', { name: 'Mark completed' })).not.toBeInTheDocument());
      expect(callsTo(calls, 'PATCH /projects/7/status')[0].body).toEqual({ status });
      expect(screen.getByRole('button', { name: 'Edit Project' })).toBeInTheDocument();
    });

    it('lets an admin archive and then restore a project', async () => {
      let project = makeProject();
      const { calls } = await renderDetail(users.admin, {
        'GET /projects/7': () => project,
        'POST /projects/7/archive': () => { project = { ...project, is_archived: true }; return project; },
        'POST /projects/7/restore': () => { project = { ...project, is_archived: false }; return project; },
      });
      await userEvent.click(await screen.findByRole('button', { name: 'Archive' }));
      await userEvent.click(within(screen.getByRole('dialog', { name: 'Archive project' })).getByRole('button', { name: 'Archive' }));

      expect(await screen.findByText('This project is archived and read-only.')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Edit Project' })).not.toBeInTheDocument();
      expect(screen.getAllByText('Archived').length).toBeGreaterThan(0);

      await userEvent.click(screen.getByRole('button', { name: 'Restore' }));
      await userEvent.click(within(screen.getByRole('dialog', { name: 'Restore project' })).getByRole('button', { name: 'Restore' }));
      expect(await screen.findByRole('button', { name: 'Edit Project' })).toBeInTheDocument();
      expect(callsTo(calls, 'POST /projects/7/archive')).toHaveLength(1);
      expect(callsTo(calls, 'POST /projects/7/restore')).toHaveLength(1);
    });

    it('closing a confirmation without confirming changes nothing', async () => {
      const { calls } = await renderDetail(users.admin);
      await userEvent.click(await screen.findByRole('button', { name: 'Abandon' }));
      await userEvent.click(screen.getByRole('button', { name: 'Close' }));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(callsTo(calls, 'PATCH /projects/7/status')).toHaveLength(0);
      expect(callsTo(calls, 'GET /projects/7')).toHaveLength(1);
    });
  });

  describe('role differences', () => {
    it('gives a manager who does not own the project a read-only view without budget', async () => {
      const other = { ...users.manager, id: 50 };
      const { calls } = await renderDetail(other);
      expect(await screen.findByRole('heading', { name: 'Apollo Platform' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Edit Project' })).not.toBeInTheDocument();
      expect(screen.queryByText('Expected cost')).not.toBeInTheDocument();
      expect(callsTo(calls, 'GET /projects/7/budget')).toHaveLength(0);
    });

    it('hides edit controls and budget data from employees', async () => {
      const { calls } = await renderDetail(users.employee);
      expect(await screen.findByRole('heading', { name: 'Apollo Platform' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Edit Project' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Mark completed' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Archive' })).not.toBeInTheDocument();
      expect(screen.queryByText('Expected cost')).not.toBeInTheDocument();

      await userEvent.click(screen.getByRole('tab', { name: 'Budget' }));
      expect(screen.getByRole('tab', { name: 'Budget' })).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByText('Access denied')).toBeInTheDocument();
      expect(screen.getByText('Budget details are only available to administrators and the project manager.')).toBeInTheDocument();
      expect(callsTo(calls, 'GET /projects/7/budget')).toHaveLength(0);
    });
  });

  describe('scheduling tabs', () => {
    const tabRoutes = {
      'GET /projects/7/milestones': [build],
      'GET /milestones/32/assignments': [],
    };

    it('lets the owning manager schedule on an active project', async () => {
      await renderDetail(users.manager, tabRoutes);
      await userEvent.click(await screen.findByRole('tab', { name: 'Milestones' }));
      expect(await screen.findByRole('button', { name: '+ Add Milestone' })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'false');

      await userEvent.click(screen.getByRole('tab', { name: 'Employees' }));
      expect(await screen.findByRole('button', { name: '+ Assign Employee' })).toBeEnabled();
    });

    it('closes scheduling once a project is archived', async () => {
      await renderDetail(users.admin, { ...tabRoutes, 'GET /projects/7': makeProject({ is_archived: true }) });
      await userEvent.click(await screen.findByRole('tab', { name: 'Milestones' }));
      expect(await screen.findByRole('button', { name: 'Build' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: '+ Add Milestone' })).not.toBeInTheDocument();

      await userEvent.click(screen.getByRole('tab', { name: 'Employees' }));
      expect(await screen.findByText('No employees assigned')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: '+ Assign Employee' })).not.toBeInTheDocument();
    });
  });

  describe('budget tab', () => {
    async function openBudget(budget) {
      const result = await renderDetail(users.admin, { 'GET /projects/7/budget': budget });
      await userEvent.click(await screen.findByRole('tab', { name: 'Budget' }));
      return result;
    }

    it('shows budget metrics, utilization and cost per milestone', async () => {
      await openBudget(makeBudget({
        milestones: [
          { milestone_id: 31, name: 'Design', status: 'completed', accrued_cost: '12000.00', projected_cost: '0.00', total_expected_cost: '12000.00' },
          { milestone_id: 32, name: 'Build', status: 'pending', accrued_cost: '0.00', projected_cost: '30000.00', total_expected_cost: '30000.00' },
        ],
      }));
      expect(await screen.findByText('Estimated budget')).toBeInTheDocument();
      expect(screen.getByText('$100,000.00')).toBeInTheDocument();
      expect(screen.getByText('through Jun 11, 2030')).toBeInTheDocument();
      expect(screen.getByText('$58,000.00')).toBeInTheDocument();
      expect(screen.getByText('Total expected cost $42,000.00')).toBeInTheDocument();
      expect(screen.getByText('42.0% of budget')).toBeInTheDocument();
      expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '42');
      expect(screen.getByText('Costs are estimated from scheduled assignments, not timesheets.')).toBeInTheDocument();
      const buildRow = screen.getByRole('row', { name: /Build/ });
      expect(within(buildRow).getAllByText('$30,000.00')).toHaveLength(2);
      expect(within(buildRow).getByText('Pending')).toBeInTheDocument();
    });

    it('flags an over-budget project in red with a capped progress bar', async () => {
      await openBudget(makeBudget({
        total_expected_cost: '130000.00',
        budget_remaining: '-30000.00',
        budget_utilization_percent: '130.00',
        health: 'over_budget',
        unpriced_days: 3,
      }));
      const remaining = await screen.findByText('-$30,000.00');
      expect(remaining).toHaveClass('text-red-600');
      expect(screen.getByText('Over budget')).toBeInTheDocument();
      expect(screen.getByText('130.0% of budget')).toBeInTheDocument();
      expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
      expect(screen.getByText('3 scheduled day(s) have no work terms in effect and are not included in these costs.')).toBeInTheDocument();
    });

    it('shows at-risk health in amber', async () => {
      await openBudget(makeBudget({ budget_remaining: '8000.00', budget_utilization_percent: '92.00', health: 'at_risk' }));
      expect(await screen.findByText('$8,000.00')).toHaveClass('text-amber-600');
      expect(screen.getByText('At risk')).toBeInTheDocument();
    });

    it('handles a project with no budget set', async () => {
      await openBudget(makeBudget({ estimated_budget: '0.00', budget_utilization_percent: null, note: '' }));
      expect(await screen.findByText('No budget set')).toBeInTheDocument();
      expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
    });

    it('shows an error when the budget cannot be loaded', async () => {
      await openBudget(apiError(500, 'Budget service unavailable'));
      expect(await screen.findAllByText('Budget service unavailable')).not.toHaveLength(0);
    });
  });
});
