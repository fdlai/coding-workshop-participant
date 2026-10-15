import {
  assignmentsApi,
  auditApi,
  authApi,
  dashboardApi,
  milestonesApi,
  projectsApi,
  relationshipsApi,
  scheduleApi,
  usersApi,
  workTermsApi,
} from '../endpoints';
import { tokenStore } from '../api';

/** Make every fetch succeed with `reply`. */
function replyWith(reply) {
  global.fetch.mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve(reply) });
}

/** Decode the last request sent through fetch. */
function lastRequest() {
  const [rawUrl, options] = global.fetch.mock.calls.at(-1);
  const url = new URL(rawUrl);
  return {
    method: options.method,
    path: url.pathname.replace('/api/v1', ''),
    query: Object.fromEntries(url.searchParams),
    body: options.body === undefined ? undefined : JSON.parse(options.body),
    headers: options.headers,
  };
}

// [name, call, method, path, query, body]
const cases = [
  ['authApi.me', () => authApi.me(), 'GET', '/auth/me', {}, undefined],
  ['authApi.refresh', () => authApi.refresh(), 'POST', '/auth/refresh', {}, undefined],
  ['authApi.changePassword', () => authApi.changePassword('old', 'newpass12'), 'POST', '/auth/change-password', {}, { current_password: 'old', new_password: 'newpass12' }],
  ['authApi.updateProfile', () => authApi.updateProfile({ job_title: 'Lead' }), 'PATCH', '/users/me', {}, { job_title: 'Lead' }],

  ['usersApi.list (default limit)', () => usersApi.list(), 'GET', '/users', { limit: '200' }, undefined],
  ['usersApi.list (filters)', () => usersApi.list({ role: 'manager', search: 'max', limit: 50 }), 'GET', '/users', { role: 'manager', search: 'max', limit: '50' }, undefined],
  ['usersApi.create', () => usersApi.create({ username: 'new' }), 'POST', '/users', {}, { username: 'new' }],
  ['usersApi.update', () => usersApi.update(7, { first_name: 'A' }), 'PATCH', '/users/7', {}, { first_name: 'A' }],
  ['usersApi.setRole', () => usersApi.setRole(7, 'manager'), 'PATCH', '/users/7/role', {}, { role: 'manager' }],
  ['usersApi.setStatus', () => usersApi.setStatus(7, false), 'PATCH', '/users/7/status', {}, { is_active: false }],
  ['usersApi.resetPassword', () => usersApi.resetPassword(7, 'temp-pass'), 'POST', '/users/7/reset-password', {}, { new_password: 'temp-pass' }],

  ['relationshipsApi.employeesOf', () => relationshipsApi.employeesOf(2), 'GET', '/managers/2/employees', {}, undefined],
  ['relationshipsApi.managersOf', () => relationshipsApi.managersOf(3), 'GET', '/employees/3/managers', {}, undefined],
  ['relationshipsApi.add', () => relationshipsApi.add(2, 3), 'POST', '/managers/2/employees', {}, { employee_id: 3 }],
  ['relationshipsApi.remove', () => relationshipsApi.remove(2, 3), 'DELETE', '/managers/2/employees/3', {}, undefined],

  ['projectsApi.list', () => projectsApi.list({ status: 'active', archived: false }), 'GET', '/projects', { limit: '200', status: 'active', archived: 'false' }, undefined],
  ['projectsApi.get', () => projectsApi.get(5), 'GET', '/projects/5', {}, undefined],
  ['projectsApi.create', () => projectsApi.create({ name: 'Apollo' }), 'POST', '/projects', {}, { name: 'Apollo' }],
  ['projectsApi.update', () => projectsApi.update(5, { name: 'B' }), 'PATCH', '/projects/5', {}, { name: 'B' }],
  ['projectsApi.setStatus', () => projectsApi.setStatus(5, 'completed'), 'PATCH', '/projects/5/status', {}, { status: 'completed' }],
  ['projectsApi.archive', () => projectsApi.archive(5), 'POST', '/projects/5/archive', {}, undefined],
  ['projectsApi.restore', () => projectsApi.restore(5), 'POST', '/projects/5/restore', {}, undefined],
  ['projectsApi.budget', () => projectsApi.budget(5), 'GET', '/projects/5/budget', {}, undefined],
  ['projectsApi.timeline', () => projectsApi.timeline(5), 'GET', '/projects/5/timeline', {}, undefined],

  ['milestonesApi.list', () => milestonesApi.list(5), 'GET', '/projects/5/milestones', {}, undefined],
  ['milestonesApi.create', () => milestonesApi.create(5, { name: 'M1' }), 'POST', '/projects/5/milestones', {}, { name: 'M1' }],
  ['milestonesApi.update', () => milestonesApi.update(9, { name: 'M2' }), 'PATCH', '/milestones/9', {}, { name: 'M2' }],
  ['milestonesApi.setStatus', () => milestonesApi.setStatus(9, 'cancelled'), 'PATCH', '/milestones/9/status', {}, { status: 'cancelled' }],
  ['milestonesApi.remove', () => milestonesApi.remove(9), 'DELETE', '/milestones/9', {}, undefined],

  ['assignmentsApi.list', () => assignmentsApi.list(9), 'GET', '/milestones/9/assignments', {}, undefined],
  ['assignmentsApi.create', () => assignmentsApi.create(9, { employee_id: 3 }), 'POST', '/milestones/9/assignments', {}, { employee_id: 3 }],
  ['assignmentsApi.update', () => assignmentsApi.update(11, { planned_end_date: '2030-07-01' }), 'PATCH', '/assignments/11', {}, { planned_end_date: '2030-07-01' }],
  ['assignmentsApi.end', () => assignmentsApi.end(11), 'POST', '/assignments/11/end', {}, undefined],
  ['assignmentsApi.transfer', () => assignmentsApi.transfer(11, { to_milestone_id: 10 }), 'POST', '/assignments/11/transfer', {}, { to_milestone_id: 10 }],

  ['scheduleApi.forEmployee', () => scheduleApi.forEmployee(3, '2030-06-10', '2030-06-16'), 'GET', '/employees/3/schedule', { start: '2030-06-10', end: '2030-06-16' }, undefined],
  ['scheduleApi.availability', () => scheduleApi.availability({ start: '2030-06-10', end: '2030-06-10' }), 'GET', '/availability', { start: '2030-06-10', end: '2030-06-10' }, undefined],

  ['workTermsApi.list', () => workTermsApi.list(3), 'GET', '/employees/3/work-terms', {}, undefined],
  ['workTermsApi.create', () => workTermsApi.create(3, { hourly_rate: '50.00' }), 'POST', '/employees/3/work-terms', {}, { hourly_rate: '50.00' }],

  ['auditApi.list', () => auditApi.list({ entity_type: 'project', offset: 20 }), 'GET', '/audit-logs', { entity_type: 'project', offset: '20' }, undefined],

  ['dashboardApi.admin', () => dashboardApi.admin(), 'GET', '/dashboard/admin', {}, undefined],
  ['dashboardApi.manager', () => dashboardApi.manager(), 'GET', '/dashboard/manager', {}, undefined],
  ['dashboardApi.employee', () => dashboardApi.employee(), 'GET', '/dashboard/employee', {}, undefined],
];

describe('endpoint functions', () => {
  beforeEach(() => tokenStore.set('jwt-token'));

  it.each(cases)('%s sends the right request', async (_name, call, method, path, query, body) => {
    replyWith({ id: 1 });
    await expect(call()).resolves.toEqual({ id: 1 });
    const sent = lastRequest();
    expect(sent.method).toBe(method);
    expect(sent.path).toBe(path);
    expect(sent.query).toEqual(query);
    expect(sent.body).toEqual(body);
    expect(sent.headers.Authorization).toBe('Bearer jwt-token');
  });

  it('logs in without sending a stored token', async () => {
    replyWith({ access_token: 'new', token_type: 'bearer' });
    await expect(authApi.login('admin', 'secret')).resolves.toEqual({ access_token: 'new', token_type: 'bearer' });
    const sent = lastRequest();
    expect(sent.method).toBe('POST');
    expect(sent.path).toBe('/auth/login');
    expect(sent.body).toEqual({ username: 'admin', password: 'secret' });
    expect(sent.headers.Authorization).toBeUndefined();
  });

  it('propagates API errors from the backend', async () => {
    global.fetch.mockResolvedValue({ ok: false, status: 409, json: () => Promise.resolve({ detail: 'Assignment overlaps' }) });
    await expect(assignmentsApi.create(9, { employee_id: 3 })).rejects.toMatchObject({ status: 409, message: 'Assignment overlaps' });
  });
});
