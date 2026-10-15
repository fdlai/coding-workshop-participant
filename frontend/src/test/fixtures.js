/**
 * Factories for backend payloads used by dashboard/schedule tests.
 * Shapes follow backend/acme-api/schemas (Decimals arrive as strings).
 */
import { users } from './utils';

const HEALTHS = ['on_track', 'at_risk', 'over_budget'];

/** ProjectHealthOut from the dashboard endpoints. Health cycles on_track/at_risk/over_budget by id. */
export function projectHealth(id, overrides = {}) {
  return {
    id,
    name: `Project ${id}`,
    status: 'active',
    manager: users.manager,
    start_date: '2030-01-01',
    estimated_end_date: '2030-12-31',
    estimated_budget: '100000.00',
    total_expected_cost: '42000.00',
    budget_utilization_percent: '42.00',
    health: HEALTHS[(id - 1) % 3],
    milestones_total: 4,
    milestones_completed: 1,
    assigned_employee_count: 3,
    ...overrides,
  };
}

/** ScheduleItem: an assignment plus its project/milestone names. */
export function scheduleItem(id, overrides = {}) {
  const { assignment, ...rest } = overrides;
  return {
    project_id: 10 + id,
    project_name: `Project ${id}`,
    milestone_name: `Milestone ${id}`,
    ...rest,
    assignment: {
      id,
      milestone_id: 100 + id,
      employee_id: 3,
      start_date: '2030-06-10',
      planned_end_date: '2030-06-14',
      ended_at: null,
      effective_end_date: '2030-06-14',
      state: 'active',
      ...assignment,
    },
  };
}

/** UserSummary for a team member. */
export function person(id, first, last, overrides = {}) {
  return {
    id,
    username: first.toLowerCase(),
    first_name: first,
    last_name: last,
    role: 'employee',
    job_title: null,
    profile_picture_url: null,
    is_active: true,
    ...overrides,
  };
}

/**
 * Pin `Date` to a fixed moment while leaving real timers in place, so
 * userEvent and findBy* keep working.
 */
export function freezeDate(iso) {
  jest.useFakeTimers({
    now: new Date(iso),
    doNotFake: [
      'hrtime', 'nextTick', 'performance', 'queueMicrotask', 'requestAnimationFrame',
      'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback', 'setImmediate',
      'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout',
    ],
  });
}
