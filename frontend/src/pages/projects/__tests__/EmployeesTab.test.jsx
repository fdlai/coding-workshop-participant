import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import EmployeesTab from '../EmployeesTab';
import { apiError, callsTo, renderApp, users } from '../../../test/utils';
import { makeAssignment, makeMilestone, makeProject, summary } from '../../../test/projectFixtures';

const finn = { id: 7, username: 'finn', first_name: 'Finn', last_name: 'Fox', role: 'employee', is_active: true };
const design = makeMilestone(31, 'Design', { status: 'completed', completed_at: '2030-06-10T15:00:00Z' });
const build = makeMilestone(32, 'Build', { start_date: '2030-07-01', end_date: '2030-08-31' });
const launch = makeMilestone(34, 'Launch', { start_date: '2030-09-01', end_date: '2030-09-15' });

const eveOnBuild = makeAssignment(1, 32, users.employee, { start_date: '2030-07-01', planned_end_date: '2030-07-31', effective_end_date: '2030-07-31' });
const finnOnDesign = makeAssignment(2, 31, finn, {
  state: 'completed', start_date: '2030-06-01', planned_end_date: '2030-06-20', ended_at: '2030-06-10T15:00:00Z', effective_end_date: '2030-06-10',
});

const availability = [
  { employee: summary(users.employee), is_available: true, busy: [] },
  { employee: summary(finn), is_available: false, busy: [{ start_date: '2030-07-05', end_date: '2030-07-09' }] },
];

function renderTab({ canSchedule = true, isAdmin = false, routes = {} } = {}) {
  const onChanged = jest.fn();
  return renderApp(
    <EmployeesTab project={makeProject()} canSchedule={canSchedule} isAdmin={isAdmin} onChanged={onChanged} />,
    {
      routes: {
        'GET /projects/7/milestones': [design, build, launch],
        'GET /milestones/31/assignments': [finnOnDesign],
        'GET /milestones/32/assignments': [eveOnBuild],
        'GET /milestones/34/assignments': [],
        'GET /availability': availability,
        ...routes,
      },
    },
  ).then((r) => ({ ...r, onChanged }));
}

const rowFor = (name) => screen.getByRole('row', { name: new RegExp(name) });
const params = (call) => Object.fromEntries(new URL(call.url, 'http://localhost').searchParams);

async function openAssign() {
  await userEvent.click(await screen.findByRole('button', { name: '+ Assign Employee' }));
  return screen.getByRole('dialog', { name: 'Assign employee' });
}

describe('EmployeesTab', () => {
  it('lists every assignment across milestones with its status', async () => {
    await renderTab();
    const eveRow = await screen.findByRole('row', { name: /Eve Employee/ });
    expect(within(eveRow).getByText('Build')).toBeInTheDocument();
    expect(within(eveRow).getByText('Jul 1, 2030 – Jul 31, 2030')).toBeInTheDocument();
    expect(within(eveRow).getByText('Scheduled')).toBeInTheDocument();
    expect(within(eveRow).getByRole('button', { name: 'Transfer' })).toBeInTheDocument();
    const finnRow = rowFor('Finn Fox');
    expect(within(finnRow).getByText('Removed early')).toBeInTheDocument();
    expect(within(finnRow).getByText('No actions available')).toBeInTheDocument();
  });

  it('is read-only for employees', async () => {
    await renderTab({ canSchedule: false, routes: { 'GET /projects/7/milestones': [build], 'GET /milestones/32/assignments': [] } });
    expect(await screen.findByText('No employees assigned')).toBeInTheDocument();
    expect(screen.queryByText(/Use “Assign Employee”/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '+ Assign Employee' })).not.toBeInTheDocument();
  });

  it('hides row actions when scheduling is closed', async () => {
    await renderTab({ canSchedule: false });
    await screen.findByRole('row', { name: /Eve Employee/ });
    expect(screen.queryByRole('columnheader', { name: 'Actions' })).not.toBeInTheDocument();
  });

  it('disables assigning when no milestone is open', async () => {
    await renderTab({ routes: { 'GET /projects/7/milestones': [design] } });
    expect(await screen.findByRole('button', { name: '+ Assign Employee' })).toBeDisabled();
  });

  it('shows an error when assignments fail to load', async () => {
    await renderTab({ routes: { 'GET /milestones/32/assignments': apiError(500, 'Assignments unavailable') } });
    expect(await screen.findByText('Assignments unavailable')).toBeInTheDocument();
  });

  describe('assigning an employee', () => {
    it('shows who is free for the milestone dates and assigns the chosen employee', async () => {
      let buildRows = [eveOnBuild];
      let releaseAvailability;
      const availabilityReady = new Promise((resolve) => { releaseAvailability = resolve; });
      const { calls, onChanged } = await renderTab({
        routes: {
          'GET /milestones/32/assignments': () => buildRows,
          'POST /milestones/32/assignments': (body) => {
            const created = makeAssignment(9, 32, finn, { ...body, effective_end_date: body.planned_end_date });
            buildRows = [...buildRows, created];
            return created;
          },
          // The fake backend holds the availability answer until released.
          'GET /availability': () => availabilityReady.then(() => [
            { employee: summary(finn), is_available: true, busy: [] },
            { employee: summary(users.employee), is_available: false, busy: [{ start_date: '2030-07-01', end_date: '2030-07-31' }] },
          ]),
        },
      });
      const dialog = await openAssign();
      expect(within(dialog).getByText('Checking availability…')).toBeInTheDocument();
      expect(within(dialog).getByLabelText('Milestone')).toHaveValue('32');
      expect(within(dialog).getByLabelText('Start date')).toHaveValue('2030-07-01');
      expect(within(dialog).getByLabelText('End date')).toHaveValue('2030-08-31');
      // Only open (pending) milestones can be chosen.
      expect(within(dialog).queryByRole('option', { name: /Design/ })).not.toBeInTheDocument();
      releaseAvailability();

      const finnRadio = await within(dialog).findByRole('radio', { name: /Finn Fox/ });
      const eveRadio = within(dialog).getByRole('radio', { name: /Eve Employee/ });
      expect(eveRadio).toBeDisabled();
      expect(within(dialog).getByText('Busy: Jul 1, 2030–Jul 31, 2030')).toBeInTheDocument();

      await userEvent.click(finnRadio);
      await userEvent.click(within(dialog).getByRole('button', { name: 'Assign' }));

      expect(await screen.findByRole('row', { name: /Finn Fox.*Build/ })).toBeInTheDocument();
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(callsTo(calls, 'POST /milestones/32/assignments')[0].body).toEqual({
        employee_id: 7, start_date: '2030-07-01', planned_end_date: '2030-08-31',
      });
      expect(params(callsTo(calls, 'GET /availability')[0])).toEqual({ start: '2030-07-01', end: '2030-08-31', project_id: '7' });
      expect(onChanged).toHaveBeenCalledTimes(1);
    });

    it("scopes availability to the project's manager when an admin assigns", async () => {
      const { calls } = await renderTab({ isAdmin: true });
      const dialog = await openAssign();
      await within(dialog).findByRole('radio', { name: /Eve Employee/ });
      expect(params(callsTo(calls, 'GET /availability')[0])).toMatchObject({ manager_id: '2', project_id: '7' });
    });

    it('updates dates and availability when another milestone is chosen', async () => {
      const { calls } = await renderTab();
      const dialog = await openAssign();
      await within(dialog).findByRole('radio', { name: /Eve Employee/ });
      await userEvent.selectOptions(within(dialog).getByLabelText('Milestone'), '34');
      expect(within(dialog).getByLabelText('Start date')).toHaveValue('2030-09-01');
      expect(within(dialog).getByLabelText('End date')).toHaveValue('2030-09-15');
      await waitFor(() => expect(params(callsTo(calls, 'GET /availability').at(-1))).toMatchObject({ start: '2030-09-01', end: '2030-09-15' }));
    });

    it('requires an employee to be selected', async () => {
      const { calls } = await renderTab();
      const dialog = await openAssign();
      await within(dialog).findByRole('radio', { name: /Eve Employee/ });
      await userEvent.click(within(dialog).getByRole('button', { name: 'Assign' }));
      expect(await within(dialog).findByRole('alert')).toHaveTextContent('Select an employee to assign');
      expect(callsTo(calls, 'POST /milestones/32/assignments')).toHaveLength(0);
    });

    it('shows the overlap conflict returned by the API and keeps the dialog open', async () => {
      const { onChanged } = await renderTab({
        routes: { 'POST /milestones/32/assignments': apiError(409, 'Eve Employee is already assigned from 2030-07-01 to 2030-07-31') },
      });
      const dialog = await openAssign();
      await userEvent.click(await within(dialog).findByRole('radio', { name: /Eve Employee/ }));
      await userEvent.click(within(dialog).getByRole('button', { name: 'Assign' }));

      expect(await within(dialog).findByRole('alert')).toHaveTextContent('Eve Employee is already assigned from 2030-07-01 to 2030-07-31');
      expect(within(dialog).getByRole('button', { name: 'Assign' })).toBeEnabled();
      expect(onChanged).not.toHaveBeenCalled();
    });

    it('shows a validation error for dates outside the milestone', async () => {
      await renderTab({
        routes: {
          'POST /milestones/32/assignments': apiError(422, [
            { loc: ['body', 'planned_end_date'], msg: 'Assignment must fall within the milestone dates' },
          ]),
        },
      });
      const dialog = await openAssign();
      await userEvent.click(await within(dialog).findByRole('radio', { name: /Eve Employee/ }));
      await userEvent.click(within(dialog).getByRole('button', { name: 'Assign' }));
      expect(await within(dialog).findByRole('alert')).toHaveTextContent('planned_end_date: Assignment must fall within the milestone dates');
    });

    it('does not check availability for an inverted date range', async () => {
      const { calls } = await renderTab();
      const dialog = await openAssign();
      await within(dialog).findByRole('radio', { name: /Eve Employee/ });
      const before = callsTo(calls, 'GET /availability').length;
      const end = within(dialog).getByLabelText('End date');
      await userEvent.clear(end);
      await userEvent.type(end, '2030-06-15');
      expect(await within(dialog).findByText("No team members found for this project's manager.")).toBeInTheDocument();
      expect(callsTo(calls, 'GET /availability')).toHaveLength(before);
    });

    it('shows an error when availability cannot be loaded', async () => {
      await renderTab({ routes: { 'GET /availability': apiError(500, 'Availability service down') } });
      const dialog = await openAssign();
      expect(await within(dialog).findByRole('alert')).toHaveTextContent('Availability service down');
      expect(within(dialog).queryByText('Checking availability…')).not.toBeInTheDocument();
    });
  });

  describe('managing an assignment', () => {
    it('edits the assignment dates', async () => {
      const { calls, onChanged } = await renderTab({ routes: { 'PATCH /assignments/1': eveOnBuild } });
      await userEvent.click(within(await screen.findByRole('row', { name: /Eve Employee/ })).getByRole('button', { name: 'Edit' }));
      const dialog = screen.getByRole('dialog', { name: 'Edit assignment – Eve Employee' });
      const start = within(dialog).getByLabelText('Start date');
      expect(start).toHaveValue('2030-07-01');
      await userEvent.clear(start);
      await userEvent.type(start, '2030-07-02');
      const end = within(dialog).getByLabelText('Planned end');
      await userEvent.clear(end);
      await userEvent.type(end, '2030-08-15');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

      await waitFor(() => expect(onChanged).toHaveBeenCalled());
      expect(callsTo(calls, 'PATCH /assignments/1')[0].body).toEqual({ start_date: '2030-07-02', planned_end_date: '2030-08-15' });
    });

    it('shows an overlap error when edited dates clash', async () => {
      await renderTab({ routes: { 'PATCH /assignments/1': apiError(409, 'Overlaps another assignment for this employee') } });
      await userEvent.click(within(await screen.findByRole('row', { name: /Eve Employee/ })).getByRole('button', { name: 'Edit' }));
      await userEvent.click(screen.getByRole('button', { name: 'Save' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('Overlaps another assignment for this employee');
    });

    it('transfers to another open milestone', async () => {
      const { calls, onChanged } = await renderTab({ routes: { 'POST /assignments/1/transfer': { source: eveOnBuild, destination: eveOnBuild } } });
      await userEvent.click(within(await screen.findByRole('row', { name: /Eve Employee/ })).getByRole('button', { name: 'Transfer' }));
      const dialog = screen.getByRole('dialog', { name: 'Transfer Eve Employee' });
      const select = within(dialog).getByLabelText('Destination milestone');
      // The current milestone and closed ones are not offered.
      expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual(['Launch (Sep 1, 2030 – Sep 15, 2030)']);
      await userEvent.click(within(dialog).getByRole('button', { name: 'Transfer' }));

      await waitFor(() => expect(onChanged).toHaveBeenCalled());
      expect(callsTo(calls, 'POST /assignments/1/transfer')[0].body).toEqual({ target_milestone_id: 34 });
    });

    it('explains when there is nowhere to transfer to', async () => {
      const { calls } = await renderTab({ routes: { 'GET /projects/7/milestones': [design, build] } });
      await userEvent.click(within(await screen.findByRole('row', { name: /Eve Employee/ })).getByRole('button', { name: 'Transfer' }));
      const dialog = screen.getByRole('dialog', { name: 'Transfer Eve Employee' });
      expect(within(dialog).getByText('There is no other open milestone to transfer to.')).toBeInTheDocument();
      await userEvent.click(within(dialog).getByRole('button', { name: 'Transfer' }));
      expect(await within(dialog).findByRole('alert')).toHaveTextContent('Select a destination milestone');
      expect(callsTo(calls, 'POST /assignments/1/transfer')).toHaveLength(0);
    });

    it('ends an assignment after confirmation', async () => {
      let buildRows = [eveOnBuild];
      const { calls, onChanged } = await renderTab({
        routes: {
          'GET /milestones/32/assignments': () => buildRows,
          'POST /assignments/1/end': () => {
            buildRows = [{ ...eveOnBuild, state: 'completed', ended_at: '2030-06-12T00:00:00Z', effective_end_date: '2030-06-11' }];
            return buildRows[0];
          },
        },
      });
      await userEvent.click(within(await screen.findByRole('row', { name: /Eve Employee/ })).getByRole('button', { name: 'Remove' }));
      const dialog = screen.getByRole('dialog', { name: 'Remove from milestone' });
      expect(dialog).toHaveTextContent('Remove Eve Employee from this milestone? Cost stops accruing today');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Remove' }));

      expect(await within(rowFor('Eve Employee')).findByText('Removed early')).toBeInTheDocument();
      expect(callsTo(calls, 'POST /assignments/1/end')).toHaveLength(1);
      expect(onChanged).toHaveBeenCalledTimes(1);
    });

    it('cancelling a dialog does not reload', async () => {
      const { onChanged } = await renderTab();
      await userEvent.click(within(await screen.findByRole('row', { name: /Eve Employee/ })).getByRole('button', { name: 'Remove' }));
      await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(onChanged).not.toHaveBeenCalled();
    });
  });
});
