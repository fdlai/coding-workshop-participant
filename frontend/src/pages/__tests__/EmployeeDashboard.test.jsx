import { screen, within } from '@testing-library/react';
import EmployeeDashboard from '../EmployeeDashboard';
import { apiError, renderApp, users } from '../../test/utils';
import { person, scheduleItem } from '../../test/fixtures';

function employeePayload(overrides = {}) {
  return {
    today: '2030-06-12',
    current_assignments: [scheduleItem(1, { assignment: { start_date: '2030-06-10', effective_end_date: '2030-06-14' } })],
    upcoming_assignments: [
      scheduleItem(2, { assignment: { state: 'scheduled', start_date: '2030-06-24', effective_end_date: '2030-06-26' } }),
    ],
    managers: [person(2, 'Max', 'Manager', { role: 'manager', job_title: 'Engineering Manager' }), person(5, 'Mia', 'Mentor', { role: 'manager' })],
    ...overrides,
  };
}

const card = (title) => screen.getByRole('heading', { name: title }).closest('section');

describe('EmployeeDashboard', () => {
  it('shows today, current and upcoming assignments, a 4-week calendar and managers', async () => {
    await renderApp(<EmployeeDashboard />, { user: users.employee, routes: { 'GET /dashboard/employee': employeePayload() } });

    expect(await screen.findByRole('heading', { name: 'My Dashboard' })).toBeInTheDocument();
    expect(screen.getByText('Today is Jun 12, 2030')).toBeInTheDocument();
    expect(within(card('Current assignments')).getByRole('link', { name: 'Project 1' })).toBeInTheDocument();
    expect(within(card('Upcoming assignments')).getByRole('link', { name: 'Project 2' })).toBeInTheDocument();

    const calendar = card('My schedule (next 4 weeks)');
    expect(within(calendar).getByText('06-10')).toBeInTheDocument();
    expect(within(calendar).getByText('07-07')).toBeInTheDocument(); // last day of week 4
    expect(within(calendar).getAllByText('Project 1')).toHaveLength(5);
    expect(within(calendar).getAllByText('Project 2')).toHaveLength(3);

    const managers = card('My managers');
    expect(within(managers).getByText('Max Manager')).toBeInTheDocument();
    expect(within(managers).getByText('Engineering Manager')).toBeInTheDocument();
    expect(within(managers).getByText('Manager')).toBeInTheDocument(); // default title for Mia
  });

  it('shows empty states when nothing is scheduled and no manager is assigned', async () => {
    await renderApp(<EmployeeDashboard />, {
      user: users.employee,
      routes: { 'GET /dashboard/employee': employeePayload({ current_assignments: [], upcoming_assignments: [], managers: [] }) },
    });
    expect(await screen.findByText('You have no assignment today')).toBeInTheDocument();
    expect(screen.getByText('Nothing scheduled to start after today')).toBeInTheDocument();
    expect(screen.getByText('No managers assigned yet.')).toBeInTheDocument();
  });

  it('shows an error when the dashboard fails to load', async () => {
    await renderApp(<EmployeeDashboard />, { user: users.employee, routes: { 'GET /dashboard/employee': apiError(503, 'Try later') } });
    expect(await screen.findByRole('alert')).toHaveTextContent('Try later');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});
