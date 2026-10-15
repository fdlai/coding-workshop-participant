import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TeamPage from '../TeamPage';
import { apiError, callsTo, renderApp, users } from '../../test/utils';
import { freezeDate, person } from '../../test/fixtures';

beforeEach(() => freezeDate('2030-06-12T12:00:00Z'));
afterEach(() => jest.useRealTimers());

const ann = person(11, 'Ann', 'Alpha', { job_title: 'Developer' });
const bob = person(12, 'Bob', 'Beta');
const cat = person(13, 'Cat', 'Gamma', { is_active: false });
const dan = person(14, 'Dan', 'Delta');

const rowOf = (name) => within(screen.getByText(name).closest('tr')).getAllByRole('cell').map((td) => td.textContent);

describe('TeamPage', () => {
  it("lists team members with today's availability and bookings", async () => {
    const { calls } = await renderApp(<TeamPage />, {
      user: users.manager,
      routes: {
        'GET /managers/2/employees': [ann, bob, cat, dan],
        'GET /availability': [
          { employee: ann, is_available: true, busy: [] },
          { employee: bob, is_available: false, busy: [{ start_date: '2030-06-01', end_date: '2030-06-30' }, { start_date: '2030-07-01', end_date: '2030-07-05' }] },
          { employee: cat, is_available: true, busy: [] },
        ],
      },
    });

    expect(screen.getByRole('heading', { name: 'My Team' })).toBeInTheDocument();
    expect(await screen.findByText('Ann Alpha')).toBeInTheDocument();
    expect(rowOf('Ann Alpha').slice(1)).toEqual(['Developer', 'Available', '—']);
    expect(rowOf('Bob Beta').slice(1)).toEqual(['—', 'Scheduled', 'Jun 1, 2030 – Jun 30, 2030, Jul 1, 2030 – Jul 5, 2030']);
    expect(rowOf('Cat Gamma')[2]).toBe('Inactive');
    expect(rowOf('Dan Delta').slice(2)).toEqual(['Unknown', '—']);

    const availability = callsTo(calls, 'GET /availability')[0];
    expect(Object.fromEntries(new URL(availability.url).searchParams)).toEqual({ start: '2030-06-12', end: '2030-06-12' });
  });

  it('shows an empty state when no employees are assigned', async () => {
    await renderApp(<TeamPage />, {
      user: users.manager,
      routes: { 'GET /managers/2/employees': [], 'GET /availability': [] },
    });
    expect(await screen.findByText('No employees assigned')).toBeInTheDocument();
  });

  it('shows an error and recovers on retry', async () => {
    let attempts = 0;
    await renderApp(<TeamPage />, {
      user: users.manager,
      routes: {
        'GET /managers/2/employees': () => {
          attempts += 1;
          return attempts === 1 ? apiError(500, 'Team unavailable') : [ann];
        },
        'GET /availability': [],
      },
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('Team unavailable');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Ann Alpha')).toBeInTheDocument();
  });
});
