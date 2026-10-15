import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SchedulePage from '../SchedulePage';
import { apiError, callsTo, renderApp, users } from '../../test/utils';
import { freezeDate, person, scheduleItem } from '../../test/fixtures';

// Wednesday; its week runs Mon 2030-06-10 to Sun 2030-06-16.
beforeEach(() => freezeDate('2030-06-12T12:00:00Z'));
afterEach(() => jest.useRealTimers());

const queryOf = (call) => Object.fromEntries(new URL(call.url).searchParams);

describe('SchedulePage (employee)', () => {
  const item = scheduleItem(1, { assignment: { start_date: '2030-06-11', effective_end_date: '2030-06-13' } });

  it("loads this week's schedule and shows it as a calendar and a list", async () => {
    const { calls } = await renderApp(<SchedulePage />, {
      user: users.employee,
      routes: { 'GET /employees/3/schedule': [item] },
    });
    expect(screen.getByRole('heading', { name: 'My Schedule' })).toBeInTheDocument();
    expect(screen.getByText('Jun 10, 2030 – Jun 16, 2030')).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'Project 1' })).toBeInTheDocument();
    expect(screen.getAllByTitle('Project 1 – Milestone 1')).toHaveLength(3);
    expect(screen.getByText('06-12').parentElement).toHaveClass('bg-indigo-50');
    expect(queryOf(callsTo(calls, 'GET /employees/3/schedule')[0])).toEqual({ start: '2030-06-10', end: '2030-06-16' });
  });

  it('moves between weeks and back to today', async () => {
    const { calls } = await renderApp(<SchedulePage />, {
      user: users.employee,
      routes: { 'GET /employees/3/schedule': [] },
    });
    expect(await screen.findByText('Nothing scheduled this week')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '← Previous' }));
    expect(await screen.findByText('Jun 3, 2030 – Jun 9, 2030')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Today' }));
    await userEvent.click(screen.getByRole('button', { name: 'Next →' }));
    expect(await screen.findByText('Jun 17, 2030 – Jun 23, 2030')).toBeInTheDocument();

    const starts = callsTo(calls, 'GET /employees/3/schedule').map((c) => queryOf(c).start);
    expect(starts).toEqual(['2030-06-10', '2030-06-03', '2030-06-10', '2030-06-17']);
  });

  it('shows an error when the schedule fails to load', async () => {
    await renderApp(<SchedulePage />, {
      user: users.employee,
      routes: { 'GET /employees/3/schedule': apiError(500, 'Schedule unavailable') },
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('Schedule unavailable');
  });
});

describe('SchedulePage (manager team grid)', () => {
  const ann = person(11, 'Ann', 'Alpha');
  const bob = person(12, 'Bob', 'Beta');

  function teamRoutes(overrides = {}) {
    return {
      'GET /managers/2/employees': [ann, bob],
      'GET /availability': [
        { employee: ann, is_available: false, busy: [{ start_date: '2030-06-10', end_date: '2030-06-11' }] },
        { employee: bob, is_available: false, busy: [{ start_date: '2030-06-14', end_date: '2030-06-20' }] },
      ],
      'GET /employees/11/schedule': [
        scheduleItem(1, { assignment: { employee_id: 11, start_date: '2030-06-12', effective_end_date: '2030-06-13' } }),
      ],
      'GET /employees/12/schedule': [],
      ...overrides,
    };
  }

  const cellLabels = (name) =>
    within(screen.getByText(name).closest('tr')).getAllByRole('cell').slice(1).map((td) => td.getAttribute('title'));

  it('shows one row per team member with project, other-project and free days', async () => {
    const { calls } = await renderApp(<SchedulePage />, { user: users.manager, routes: teamRoutes() });

    expect(screen.getByRole('heading', { name: 'Team Schedule' })).toBeInTheDocument();
    expect(await screen.findByText('Ann Alpha')).toBeInTheDocument();
    const headers = screen.getAllByRole('columnheader').map((th) => th.textContent);
    expect(headers).toEqual(['Employee', '06-10', '06-11', '06-12', '06-13', '06-14', '06-15', '06-16']);
    expect(screen.getByRole('columnheader', { name: '06-12' })).toHaveClass('text-indigo-700');

    const mine = 'Project 1 – Milestone 1';
    const other = 'Booked on another project';
    expect(cellLabels('Ann Alpha')).toEqual([other, other, mine, mine, 'Free', 'Free', 'Free']);
    expect(cellLabels('Bob Beta')).toEqual(['Free', 'Free', 'Free', 'Free', other, other, other]);

    expect(queryOf(callsTo(calls, 'GET /availability')[0])).toEqual({ start: '2030-06-10', end: '2030-06-16' });
    expect(queryOf(callsTo(calls, 'GET /employees/12/schedule')[0])).toEqual({ start: '2030-06-10', end: '2030-06-16' });
  });

  it('treats members missing from availability as free', async () => {
    await renderApp(<SchedulePage />, {
      user: users.manager,
      routes: teamRoutes({ 'GET /availability': [] }),
    });
    expect(await screen.findByText('Bob Beta')).toBeInTheDocument();
    expect(cellLabels('Bob Beta').every((label) => label === 'Free')).toBe(true);
  });

  it('switches to a 4-week month view and pages by the view length', async () => {
    const { calls } = await renderApp(<SchedulePage />, { user: users.manager, routes: teamRoutes() });
    await screen.findByText('Ann Alpha');

    await userEvent.click(screen.getByRole('button', { name: 'Month' }));
    expect(await screen.findByText('Jun 10, 2030 – Jul 7, 2030')).toBeInTheDocument();
    expect(await screen.findByRole('columnheader', { name: '07-07' })).toBeInTheDocument();
    expect(screen.getAllByRole('columnheader')).toHaveLength(29);
    expect(screen.getByRole('button', { name: 'Month' })).toHaveClass('bg-indigo-600');

    await userEvent.click(screen.getByRole('button', { name: '→' }));
    expect(await screen.findByText('Jul 8, 2030 – Aug 4, 2030')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '←' }));
    await userEvent.click(screen.getByRole('button', { name: '←' }));
    expect(await screen.findByText('May 13, 2030 – Jun 9, 2030')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Today' }));
    expect(await screen.findByText('Jun 10, 2030 – Jul 7, 2030')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Week' }));
    expect(await screen.findByText('Jun 10, 2030 – Jun 16, 2030')).toBeInTheDocument();

    const ranges = callsTo(calls, 'GET /availability').map((c) => `${queryOf(c).start}..${queryOf(c).end}`);
    expect(ranges).toEqual([
      '2030-06-10..2030-06-16',
      '2030-06-10..2030-07-07',
      '2030-07-08..2030-08-04',
      '2030-06-10..2030-07-07',
      '2030-05-13..2030-06-09',
      '2030-06-10..2030-07-07',
      '2030-06-10..2030-06-16',
    ]);
  });

  it('shows an empty state when the manager has no team', async () => {
    await renderApp(<SchedulePage />, {
      user: users.manager,
      routes: { 'GET /managers/2/employees': [], 'GET /availability': [] },
    });
    expect(await screen.findByText('No team members')).toBeInTheDocument();
    expect(screen.getByText('An administrator assigns employees to managers.')).toBeInTheDocument();
  });

  it('shows an error when any request fails', async () => {
    await renderApp(<SchedulePage />, {
      user: users.manager,
      routes: teamRoutes({ 'GET /employees/12/schedule': apiError(500, 'Could not load Bob') }),
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load Bob');
  });
});
