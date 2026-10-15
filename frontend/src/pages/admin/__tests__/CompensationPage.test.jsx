import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CompensationPage from '../CompensationPage';
import { apiError, callsTo, renderApp, users } from '../../../test/utils';

const eve = { ...users.employee, id: 3 };
const finn = { id: 7, username: 'finn', first_name: 'Finn', last_name: 'Fox', role: 'employee', is_active: true };
const term = (id, effective_from, hourly_rate, weekly_hours = '40.00') => ({
  id,
  employee_id: 3,
  hourly_rate,
  weekly_hours,
  effective_from,
  daily_cost: (Number(hourly_rate) * Number(weekly_hours) / 5).toFixed(2),
});

function renderComp(routes = {}) {
  return renderApp(<CompensationPage />, {
    user: users.admin,
    routes: { 'GET /users': [eve, finn], ...routes },
  });
}

describe('CompensationPage', () => {
  beforeEach(() => {
    // The add form defaults "Effective from" to today (UTC).
    jest.useFakeTimers({ advanceTimers: true, now: new Date('2030-06-12T12:00:00Z') });
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('asks for an employee before showing work terms', async () => {
    await renderComp();
    expect(await screen.findByText('Select an employee')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Finn Fox' })).toBeInTheDocument();
  });

  it("shows the selected employee's work terms and rate history", async () => {
    await renderComp({
      'GET /employees/3/work-terms': [term(2, '2030-01-01', '55.00'), term(1, '2029-01-01', '50.00')],
    });
    await userEvent.selectOptions(await screen.findByLabelText('Employee'), 'Eve Employee');

    expect(await screen.findByRole('cell', { name: 'Jan 1, 2030' })).toBeInTheDocument();
    const table = screen.getByRole('table');
    expect(within(table).getByText('$55.00')).toBeInTheDocument();
    expect(within(table).getByText('$440.00')).toBeInTheDocument();
    const history = screen.getByRole('img', { name: 'Hourly rate history' });
    // Oldest first in the chart.
    expect(history.textContent.indexOf('$50.00')).toBeLessThan(history.textContent.indexOf('$55.00'));
  });

  it('explains that an employee without terms cannot be scheduled', async () => {
    await renderComp({ 'GET /employees/7/work-terms': [] });
    await userEvent.selectOptions(await screen.findByLabelText('Employee'), 'Finn Fox');
    expect(await screen.findByText('No work terms yet')).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: 'Hourly rate history' })).not.toBeInTheDocument();
  });

  it('adds a future-dated rate that defaults from today and reloads the history', async () => {
    let terms = [term(1, '2029-01-01', '50.00')];
    const { calls } = await renderComp({
      'GET /employees/3/work-terms': () => terms,
      'POST /employees/3/work-terms': (body) => {
        terms = [term(2, body.effective_from, body.hourly_rate, body.weekly_hours), ...terms];
        return terms[0];
      },
    });
    await userEvent.selectOptions(await screen.findByLabelText('Employee'), 'Eve Employee');
    await userEvent.click(await screen.findByRole('button', { name: '+ Add Work Term' }));

    const dialog = screen.getByRole('dialog', { name: 'Add work terms – Eve Employee' });
    const date = within(dialog).getByLabelText('Effective from');
    expect(date).toHaveValue('2030-06-12');
    expect(within(dialog).getByLabelText('Weekly hours')).toHaveValue(40);
    await userEvent.type(within(dialog).getByLabelText('Hourly rate'), '62.5');
    await userEvent.clear(date);
    await userEvent.type(date, '2030-09-01');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('cell', { name: 'Sep 1, 2030' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(callsTo(calls, 'POST /employees/3/work-terms')[0].body).toEqual({
      hourly_rate: '62.5', weekly_hours: '40', effective_from: '2030-09-01',
    });
  });

  it('shows a validation error for back-dated terms that would change accrued costs', async () => {
    await renderComp({
      'GET /employees/3/work-terms': [term(1, '2029-01-01', '50.00')],
      'POST /employees/3/work-terms': apiError(422, [
        { loc: ['body', 'effective_from'], msg: 'Value error, would change costs already accrued' },
      ]),
    });
    await userEvent.selectOptions(await screen.findByLabelText('Employee'), 'Eve Employee');
    await userEvent.click(await screen.findByRole('button', { name: '+ Add Work Term' }));
    const dialog = screen.getByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Hourly rate'), '70');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    expect(await within(dialog).findByRole('alert'))
      .toHaveTextContent('effective_from: Value error, would change costs already accrued');
  });

  it('shows an error when work terms fail to load', async () => {
    await renderComp({ 'GET /employees/3/work-terms': apiError(500, 'Server exploded') });
    await userEvent.selectOptions(await screen.findByLabelText('Employee'), 'Eve Employee');
    expect(await screen.findByText('Server exploded')).toBeInTheDocument();
  });
});
