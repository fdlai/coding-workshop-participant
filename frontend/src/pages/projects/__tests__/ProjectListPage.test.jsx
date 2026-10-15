import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ProjectListPage from '../ProjectListPage';
import { apiError, callsTo, renderApp, users } from '../../../test/utils';
import { makeProject } from '../../../test/projectFixtures';

const mia = { id: 5, username: 'mia', first_name: 'Mia', last_name: 'Moss', role: 'manager', is_active: true };
const apollo = makeProject();
const borealis = makeProject({ id: 8, name: 'Borealis', manager_id: 5, status: 'completed', estimated_budget: '25000.00' });
const comet = makeProject({ id: 9, name: 'Comet', manager_id: 999, status: 'abandoned' });

function renderList(user, routes = {}) {
  return renderApp(<ProjectListPage />, {
    user,
    route: '/projects',
    path: '/projects',
    routes: { 'GET /projects': [apollo, borealis, comet], 'GET /users': [users.manager, mia], ...routes },
  });
}

const rowFor = (name) => screen.getByRole('row', { name: new RegExp(name) });

describe('ProjectListPage', () => {
  describe('as an admin', () => {
    it('lists projects with manager, dates, budget and status', async () => {
      await renderList(users.admin);
      expect(await screen.findByRole('heading', { name: 'Projects' })).toBeInTheDocument();
      const row = await screen.findByRole('row', { name: /Apollo Platform/ });
      expect(within(row).getByText('Max Manager')).toBeInTheDocument();
      expect(within(row).getByText('Jun 1, 2030')).toBeInTheDocument();
      expect(within(row).getByText('Sep 30, 2030')).toBeInTheDocument();
      expect(within(row).getByText('$100,000')).toBeInTheDocument();
      expect(within(row).getByText('Active')).toBeInTheDocument();
      expect(within(rowFor('Borealis')).getByText('Mia Moss')).toBeInTheDocument();
      // Unknown manager ids fall back to a dash.
      expect(within(rowFor('Comet')).getByText('—')).toBeInTheDocument();
    });

    it('filters by search text, status and manager', async () => {
      await renderList(users.admin);
      await screen.findByText('Apollo Platform');

      await userEvent.type(screen.getByLabelText('Search projects'), 'BORE');
      expect(screen.getByText('Borealis')).toBeInTheDocument();
      expect(screen.queryByText('Apollo Platform')).not.toBeInTheDocument();
      await userEvent.clear(screen.getByLabelText('Search projects'));

      await userEvent.selectOptions(screen.getByLabelText('Filter by status'), 'abandoned');
      expect(screen.getByText('Comet')).toBeInTheDocument();
      expect(screen.queryByText('Borealis')).not.toBeInTheDocument();
      await userEvent.selectOptions(screen.getByLabelText('Filter by status'), '');

      await userEvent.selectOptions(screen.getByLabelText('Filter by manager'), 'Mia Moss');
      expect(screen.getByText('Borealis')).toBeInTheDocument();
      expect(screen.queryByText('Apollo Platform')).not.toBeInTheDocument();

      await userEvent.selectOptions(screen.getByLabelText('Filter by status'), 'active');
      expect(screen.getByText('No projects found')).toBeInTheDocument();
      expect(screen.getByText('Try changing your filters.')).toBeInTheDocument();
    });

    it('paginates ten projects per page and resets to page one when filtering', async () => {
      const many = Array.from({ length: 13 }, (_, i) => makeProject({ id: 100 + i, name: `Project ${String(i).padStart(2, '0')}` }));
      await renderList(users.admin, { 'GET /projects': many });
      expect(await screen.findByText('Showing 1–10 of 13')).toBeInTheDocument();
      expect(screen.queryByText('Project 10')).not.toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Next' }));
      expect(screen.getByText('Showing 11–13 of 13')).toBeInTheDocument();
      expect(screen.getByText('Project 12')).toBeInTheDocument();

      await userEvent.type(screen.getByLabelText('Search projects'), 'Project 0');
      expect(screen.getByText('Project 00')).toBeInTheDocument();
      expect(screen.queryByText(/Showing/)).not.toBeInTheDocument();
    });

    it('opens a project from its row or its View button', async () => {
      await renderList(users.admin);
      await userEvent.click(await screen.findByText('Apollo Platform'));
      expect(await screen.findByText('Navigated away')).toBeInTheDocument();
    });

    it('creates a project with the chosen manager and reloads the list', async () => {
      let rows = [apollo];
      const { calls } = await renderList(users.admin, {
        'GET /projects': () => rows,
        'POST /projects': (body) => {
          rows = [...rows, makeProject({ id: 20, ...body })];
          return rows.at(-1);
        },
      });
      await screen.findByText('Apollo Platform');
      await userEvent.click(screen.getByRole('button', { name: '+ New Project' }));
      const dialog = screen.getByRole('dialog', { name: 'New project' });
      await userEvent.type(within(dialog).getByLabelText('Name'), '  Zephyr  ');
      await userEvent.selectOptions(within(dialog).getByLabelText('Project manager'), await within(dialog).findByRole('option', { name: 'Mia Moss' }));
      await userEvent.type(within(dialog).getByLabelText('Start date'), '2030-07-01');
      await userEvent.type(within(dialog).getByLabelText('Estimated end'), '2030-12-31');
      await userEvent.type(within(dialog).getByLabelText('Budget (USD)'), '75000');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Create project' }));

      expect(await screen.findByText('Zephyr')).toBeInTheDocument();
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(callsTo(calls, 'POST /projects')[0].body).toEqual({
        name: 'Zephyr',
        description: null,
        manager_id: 5,
        start_date: '2030-07-01',
        estimated_end_date: '2030-12-31',
        estimated_budget: '75000',
      });
      // The manager picker only offers active managers.
      const managerQueries = callsTo(calls, 'GET /users').map((c) => c.url);
      expect(managerQueries.some((u) => u.includes('role=manager') && u.includes('is_active=true'))).toBe(true);
    });

    it('blocks submission until required fields are filled', async () => {
      const { calls } = await renderList(users.admin);
      await screen.findByText('Apollo Platform');
      await userEvent.click(screen.getByRole('button', { name: '+ New Project' }));
      await userEvent.click(screen.getByRole('button', { name: 'Create project' }));
      expect(callsTo(calls, 'POST /projects')).toHaveLength(0);
      expect(screen.getByRole('dialog', { name: 'New project' })).toBeInTheDocument();
    });

    it('shows server validation errors without closing the form', async () => {
      await renderList(users.admin, {
        'POST /projects': apiError(422, [
          { loc: ['body', 'estimated_end_date'], msg: 'Value error, estimated_end_date must be on or after start_date' },
        ]),
      });
      await screen.findByText('Apollo Platform');
      await userEvent.click(screen.getByRole('button', { name: '+ New Project' }));
      const dialog = screen.getByRole('dialog', { name: 'New project' });
      await userEvent.type(within(dialog).getByLabelText('Name'), 'Backwards');
      await userEvent.selectOptions(within(dialog).getByLabelText('Project manager'), await within(dialog).findByRole('option', { name: 'Max Manager' }));
      await userEvent.type(within(dialog).getByLabelText('Start date'), '2030-12-31');
      await userEvent.type(within(dialog).getByLabelText('Estimated end'), '2030-01-01');
      await userEvent.type(within(dialog).getByLabelText('Budget (USD)'), '1000');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Create project' }));

      expect(await within(dialog).findByRole('alert'))
        .toHaveTextContent('estimated_end_date: Value error, estimated_end_date must be on or after start_date');
      expect(within(dialog).getByRole('button', { name: 'Create project' })).toBeEnabled();
    });

    it('archives a project after confirmation', async () => {
      let rows = [apollo, borealis];
      const { calls } = await renderList(users.admin, {
        'GET /projects': () => rows,
        'POST /projects/8/archive': () => { rows = [apollo]; return { ...borealis, is_archived: true }; },
      });
      await screen.findByText('Borealis');
      await userEvent.click(within(rowFor('Borealis')).getByRole('button', { name: 'Archive' }));
      const dialog = screen.getByRole('dialog', { name: 'Archive project' });
      expect(dialog).toHaveTextContent('Archive "Borealis"?');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Archive' }));

      await waitFor(() => expect(screen.queryByText('Borealis')).not.toBeInTheDocument());
      expect(screen.getByText('Apollo Platform')).toBeInTheDocument();
      expect(callsTo(calls, 'POST /projects/8/archive')).toHaveLength(1);
    });

    it('shows a retryable error when projects fail to load', async () => {
      await renderList(users.admin, { 'GET /projects': apiError(500, 'Internal server error') });
      expect(await screen.findByText('Internal server error')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    });
  });

  describe('as a manager', () => {
    it('shows "My Projects" with budgets but no admin controls', async () => {
      const { calls } = await renderList(users.manager, { 'GET /projects': [apollo] });
      expect(await screen.findByRole('heading', { name: 'My Projects' })).toBeInTheDocument();
      const row = await screen.findByRole('row', { name: /Apollo Platform/ });
      expect(within(row).getByText('$100,000')).toBeInTheDocument();
      expect(within(row).queryByRole('button', { name: 'Archive' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: '+ New Project' })).not.toBeInTheDocument();
      expect(screen.queryByLabelText('Filter by manager')).not.toBeInTheDocument();
      expect(screen.queryByRole('columnheader', { name: 'Manager' })).not.toBeInTheDocument();
      expect(callsTo(calls, 'GET /users')).toHaveLength(0);
    });
  });

  describe('as an employee', () => {
    it('hides budget data and admin actions', async () => {
      // Employees get ProjectEmployeeOut: no budget or creator fields.
      const employeeView = { ...apollo };
      delete employeeView.estimated_budget;
      delete employeeView.created_by;
      await renderList(users.employee, { 'GET /projects': [employeeView] });
      const row = await screen.findByRole('row', { name: /Apollo Platform/ });
      expect(screen.queryByRole('columnheader', { name: 'Budget' })).not.toBeInTheDocument();
      expect(within(row).getByRole('button', { name: 'View' })).toBeInTheDocument();
      expect(within(row).queryByRole('button', { name: 'Archive' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: '+ New Project' })).not.toBeInTheDocument();

      await userEvent.click(within(row).getByRole('button', { name: 'View' }));
      expect(await screen.findByText('Navigated away')).toBeInTheDocument();
    });

    it('shows an empty state when there are no projects', async () => {
      await renderList(users.employee, { 'GET /projects': [] });
      expect(await screen.findByText('No projects found')).toBeInTheDocument();
      expect(screen.getByText('There are no projects to show yet.')).toBeInTheDocument();
    });
  });
});
