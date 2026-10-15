import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MilestonesTab from '../MilestonesTab';
import { apiError, callsTo, renderApp, users } from '../../../test/utils';
import { TODAY, makeAssignment, makeBudget, makeMilestone, makeProject } from '../../../test/projectFixtures';

const design = makeMilestone(31, 'Design', {
  status: 'completed',
  completed_at: '2030-06-10T15:00:00Z',
  description: 'Wireframes and specs',
  deliverables: 'Figma file',
});
const build = makeMilestone(32, 'Build', { start_date: '2030-07-01', end_date: '2030-08-31' });
const dropped = makeMilestone(33, 'Dropped scope', { status: 'cancelled' });

function renderTab({ canSchedule = true, canSeeBudget = true, routes = {} } = {}) {
  const onChanged = jest.fn();
  const result = renderApp(
    <MilestonesTab project={makeProject()} canSchedule={canSchedule} canSeeBudget={canSeeBudget} today={TODAY} onChanged={onChanged} />,
    { routes: { 'GET /projects/7/milestones': [design, build, dropped], ...routes } },
  );
  return result.then((r) => ({ ...r, onChanged }));
}

const rowFor = (name) => screen.getByRole('row', { name: new RegExp(`^${name}`) });

describe('MilestonesTab', () => {
  it('lists milestones on a timeline and in a table', async () => {
    await renderTab();
    expect(await screen.findByRole('heading', { name: 'Timeline' })).toBeInTheDocument();
    expect(screen.getByTitle('Build: Jul 1, 2030 – Aug 31, 2030')).toBeInTheDocument();
    const designRow = rowFor('Design');
    expect(within(designRow).getByText('Completed')).toBeInTheDocument();
    expect(within(designRow).getByText('Jun 10, 2030')).toBeInTheDocument();
    expect(within(designRow).getByText('No actions available')).toBeInTheDocument();
    expect(within(rowFor('Dropped scope')).getByText('Cancelled')).toBeInTheDocument();
    expect(within(rowFor('Build')).getByRole('button', { name: 'Complete' })).toBeInTheDocument();
  });

  it('creates a milestone and notifies the project page', async () => {
    let rows = [build];
    const { calls, onChanged } = await renderTab({
      routes: {
        'GET /projects/7/milestones': () => rows,
        'POST /projects/7/milestones': (body) => { rows = [...rows, makeMilestone(40, body.name, body)]; return rows.at(-1); },
      },
    });
    await screen.findByRole('button', { name: 'Build' });
    await userEvent.click(screen.getByRole('button', { name: '+ Add Milestone' }));
    const dialog = screen.getByRole('dialog', { name: 'Add milestone' });
    await userEvent.type(within(dialog).getByLabelText('Name'), ' Launch ');
    await userEvent.type(within(dialog).getByLabelText('Deliverables'), 'Go-live checklist');
    await userEvent.type(within(dialog).getByLabelText('Start date'), '2030-09-01');
    await userEvent.type(within(dialog).getByLabelText('End date'), '2030-09-15');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('button', { name: 'Launch' })).toBeInTheDocument();
    expect(callsTo(calls, 'POST /projects/7/milestones')[0].body).toEqual({
      name: 'Launch',
      description: null,
      deliverables: 'Go-live checklist',
      start_date: '2030-09-01',
      end_date: '2030-09-15',
    });
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('shows validation errors from the API when a milestone is outside the project', async () => {
    const { onChanged } = await renderTab({
      routes: { 'POST /projects/7/milestones': apiError(422, 'Milestone dates must fall within the project period') },
    });
    await screen.findByRole('button', { name: 'Build' });
    await userEvent.click(screen.getByRole('button', { name: '+ Add Milestone' }));
    const dialog = screen.getByRole('dialog', { name: 'Add milestone' });
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Too late');
    await userEvent.type(within(dialog).getByLabelText('Start date'), '2031-01-01');
    await userEvent.type(within(dialog).getByLabelText('End date'), '2031-02-01');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Milestone dates must fall within the project period');
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('does not submit a milestone without a name and dates', async () => {
    const { calls } = await renderTab();
    await screen.findByRole('button', { name: 'Build' });
    await userEvent.click(screen.getByRole('button', { name: '+ Add Milestone' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(callsTo(calls, 'POST /projects/7/milestones')).toHaveLength(0);
  });

  it('edits a pending milestone with its current values prefilled', async () => {
    const { calls, onChanged } = await renderTab({ routes: { 'PATCH /milestones/32': { ...build, name: 'Build v2' } } });
    await screen.findByRole('button', { name: 'Build' });
    await userEvent.click(within(rowFor('Build')).getByRole('button', { name: 'Edit' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit milestone' });
    expect(within(dialog).getByLabelText('Start date')).toHaveValue('2030-07-01');
    const name = within(dialog).getByLabelText('Name');
    await userEvent.clear(name);
    await userEvent.type(name, 'Build v2');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(callsTo(calls, 'PATCH /milestones/32')[0].body).toEqual({
      name: 'Build v2', description: null, deliverables: null, start_date: '2030-07-01', end_date: '2030-08-31',
    });
  });

  it.each([
    ['Complete', 'Complete milestone', 'Today counts as the final billable day', 'completed'],
    ['Cancel', 'Cancel milestone', 'so today is not billed', 'cancelled'],
  ])('%s changes the milestone status after confirmation', async (action, title, warning, status) => {
    let rows = [build];
    const { calls, onChanged } = await renderTab({
      routes: {
        'GET /projects/7/milestones': () => rows,
        'PATCH /milestones/32/status': (body) => { rows = [{ ...build, status: body.status }]; return rows[0]; },
      },
    });
    await screen.findByRole('button', { name: 'Build' });
    await userEvent.click(within(rowFor('Build')).getByRole('button', { name: action }));
    const dialog = screen.getByRole('dialog', { name: title });
    expect(dialog).toHaveTextContent(warning);
    await userEvent.click(within(dialog).getByRole('button', { name: title }));

    expect(await screen.findByText('No actions available')).toBeInTheDocument();
    expect(callsTo(calls, 'PATCH /milestones/32/status')[0].body).toEqual({ status });
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('deletes an unassigned milestone', async () => {
    let rows = [build];
    const { calls } = await renderTab({
      routes: {
        'GET /projects/7/milestones': () => rows,
        'DELETE /milestones/32': () => { rows = []; return null; },
      },
    });
    await screen.findByRole('button', { name: 'Build' });
    await userEvent.click(within(rowFor('Build')).getByRole('button', { name: 'Delete' }));
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Delete milestone' })).getByRole('button', { name: 'Delete milestone' }));

    expect(await screen.findByText('No milestones yet')).toBeInTheDocument();
    expect(screen.getByText('Add the first milestone to start planning.')).toBeInTheDocument();
    expect(callsTo(calls, 'DELETE /milestones/32')).toHaveLength(1);
  });

  it('explains why a milestone with assignments cannot be deleted', async () => {
    const { onChanged } = await renderTab({
      routes: { 'DELETE /milestones/32': apiError(409, 'Milestone has assignments; cancel it instead') },
    });
    await screen.findByRole('button', { name: 'Build' });
    await userEvent.click(within(rowFor('Build')).getByRole('button', { name: 'Delete' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete milestone' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete milestone' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Milestone has assignments; cancel it instead');
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('is read-only for users who cannot schedule', async () => {
    await renderTab({ canSchedule: false, canSeeBudget: false, routes: { 'GET /projects/7/milestones': [] } });
    expect(await screen.findByText('No milestones yet')).toBeInTheDocument();
    expect(screen.queryByText('Add the first milestone to start planning.')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '+ Add Milestone' })).not.toBeInTheDocument();
  });

  it('hides row actions from users who cannot schedule', async () => {
    await renderTab({ canSchedule: false, canSeeBudget: false });
    await screen.findByRole('button', { name: 'Build' });
    expect(screen.queryByRole('columnheader', { name: 'Actions' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
  });

  describe('milestone details', () => {
    const ivan = { id: 20, username: 'ivan', first_name: 'Ivan', last_name: 'Idle', role: 'employee', is_active: false };

    it('shows dates, description, cost and everyone who worked on it', async () => {
      const { calls } = await renderTab({
        routes: {
          'GET /milestones/31/assignments': [
            makeAssignment(1, 31, users.employee, { state: 'completed', effective_end_date: '2030-06-10', planned_end_date: '2030-06-10', ended_at: '2030-06-10T15:00:00Z' }),
            makeAssignment(2, 31, ivan, { state: 'completed', ended_at: '2030-06-05T10:00:00Z', effective_end_date: '2030-06-05', planned_end_date: '2030-06-20' }),
            makeAssignment(3, 31, users.manager, { state: 'cancelled' }),
          ],
          'GET /projects/7/budget': makeBudget({
            milestones: [{ milestone_id: 31, name: 'Design', status: 'completed', accrued_cost: '9000.00', projected_cost: '0.00', total_expected_cost: '9000.00' }],
          }),
        },
      });
      await userEvent.click(await screen.findByRole('button', { name: 'Design' }));
      const dialog = screen.getByRole('dialog', { name: 'Design' });
      expect(within(dialog).getByText('Jun 1, 2030 – Jun 30, 2030')).toBeInTheDocument();
      expect(within(dialog).getByText('Wireframes and specs')).toBeInTheDocument();
      expect(within(dialog).getByText('Figma file')).toBeInTheDocument();

      const accrued = await within(dialog).findByText('Accrued');
      expect(accrued.nextSibling).toHaveTextContent('$9,000.00');
      const eveRow = within(dialog).getByRole('row', { name: /Eve Employee/ });
      expect(within(eveRow).getByText('Completed')).toBeInTheDocument();
      const ivanRow = within(dialog).getByRole('row', { name: /Ivan Idle/ });
      expect(within(ivanRow).getByText('Inactive')).toBeInTheDocument();
      expect(within(ivanRow).getByText('Removed early')).toBeInTheDocument();
      const maxRow = within(dialog).getByRole('row', { name: /Max Manager/ });
      expect(within(maxRow).getByText('Cancelled')).toBeInTheDocument();
      expect(within(maxRow).getByText('—')).toBeInTheDocument();
      expect(callsTo(calls, 'GET /projects/7/budget')).toHaveLength(1);

      await userEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('labels work cut short by a cancelled milestone and hides cost without budget access', async () => {
      const { calls } = await renderTab({
        canSchedule: false,
        canSeeBudget: false,
        routes: {
          'GET /milestones/33/assignments': [
            makeAssignment(4, 33, users.employee, { state: 'completed', ended_at: '2030-06-08T00:00:00Z', effective_end_date: '2030-06-07' }),
          ],
        },
      });
      // Clicking anywhere on the row opens the details too.
      await screen.findByRole('button', { name: 'Dropped scope' });
      await userEvent.click(within(rowFor('Dropped scope')).getByText('Cancelled'));
      const dialog = screen.getByRole('dialog', { name: 'Dropped scope' });
      expect(await within(dialog).findByText('Milestone cancelled')).toBeInTheDocument();
      expect(within(dialog).queryByText('Accrued')).not.toBeInTheDocument();
      expect(callsTo(calls, 'GET /projects/7/budget')).toHaveLength(0);

      await userEvent.keyboard('{Escape}');
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('says when nobody has been assigned', async () => {
      await renderTab({
        routes: {
          'GET /milestones/32/assignments': [],
          'GET /projects/7/budget': makeBudget(),
        },
      });
      await userEvent.click(await screen.findByRole('button', { name: 'Build' }));
      expect(await screen.findByText('No one has been assigned to this milestone.')).toBeInTheDocument();
    });

    it('shows an error if the assignments cannot be loaded', async () => {
      await renderTab({
        canSeeBudget: false,
        routes: { 'GET /milestones/32/assignments': apiError(500, 'Could not load assignments') },
      });
      await userEvent.click(await screen.findByRole('button', { name: 'Build' }));
      expect(await screen.findByText('Could not load assignments')).toBeInTheDocument();
    });
  });
});
