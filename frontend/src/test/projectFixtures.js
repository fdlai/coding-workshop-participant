/**
 * Realistic API payloads for project-related component tests, shaped like the
 * backend's ProjectOut, MilestoneOut, AssignmentOut, BudgetOut and TimelineOut.
 */
import { users } from './utils';

export const TODAY = '2030-06-12';

export function makeProject(overrides = {}) {
  return {
    id: 7,
    name: 'Apollo Platform',
    description: 'Replatform the billing stack.',
    manager_id: users.manager.id,
    created_by: users.admin.id,
    start_date: '2030-06-01',
    estimated_end_date: '2030-09-30',
    estimated_budget: '100000.00',
    status: 'active',
    is_archived: false,
    archived_at: null,
    created_at: '2030-05-01T09:00:00Z',
    updated_at: '2030-05-01T09:00:00Z',
    ...overrides,
  };
}

export function makeMilestone(id, name, overrides = {}) {
  return {
    id,
    project_id: 7,
    name,
    description: null,
    deliverables: null,
    start_date: '2030-06-01',
    end_date: '2030-06-30',
    status: 'pending',
    completed_at: null,
    created_at: '2030-05-01T09:00:00Z',
    updated_at: '2030-05-01T09:00:00Z',
    ...overrides,
  };
}

export const summary = (user) => ({
  id: user.id,
  username: user.username,
  first_name: user.first_name,
  last_name: user.last_name,
  role: user.role,
  job_title: user.job_title ?? null,
  profile_picture_url: null,
  is_active: user.is_active ?? true,
});

export function makeAssignment(id, milestoneId, employee, overrides = {}) {
  return {
    id,
    milestone_id: milestoneId,
    employee_id: employee.id,
    start_date: '2030-06-03',
    planned_end_date: '2030-06-20',
    ended_at: null,
    effective_end_date: '2030-06-20',
    state: 'scheduled',
    employee: summary(employee),
    ...overrides,
  };
}

export function makeTimeline(milestones = [], overrides = {}) {
  return {
    project_id: 7,
    name: 'Apollo Platform',
    status: 'active',
    is_archived: false,
    start_date: '2030-06-01',
    estimated_end_date: '2030-09-30',
    today: TODAY,
    milestones: milestones.map((m) => ({
      id: m.id,
      name: m.name,
      status: m.status,
      start_date: m.start_date,
      end_date: m.end_date,
      completed_at: m.completed_at,
      assigned_employee_count: 0,
    })),
    ...overrides,
  };
}

export function makeBudget(overrides = {}) {
  return {
    project_id: 7,
    as_of: TODAY,
    accrued_through: '2030-06-11',
    estimated_budget: '100000.00',
    accrued_cost: '12000.00',
    projected_cost: '30000.00',
    total_expected_cost: '42000.00',
    budget_remaining: '58000.00',
    budget_utilization_percent: '42.00',
    health: 'on_track',
    unpriced_days: 0,
    milestones: [],
    note: 'Costs are estimated from scheduled assignments, not timesheets.',
    ...overrides,
  };
}
