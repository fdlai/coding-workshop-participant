/**
 * One function per backend endpoint, grouped by domain.
 * Pages call these instead of building URLs themselves.
 */
import { request } from './api';

export const authApi = {
  login: (username, password) =>
    request('/auth/login', { method: 'POST', body: { username, password }, auth: false }),
  me: () => request('/auth/me'),
  changePassword: (current_password, new_password) =>
    request('/auth/change-password', { method: 'POST', body: { current_password, new_password } }),
  updateProfile: (changes) => request('/users/me', { method: 'PATCH', body: changes }),
};

export const usersApi = {
  list: (params) => request('/users', { params: { limit: 200, ...params } }),
  create: (user) => request('/users', { method: 'POST', body: user }),
  update: (id, changes) => request(`/users/${id}`, { method: 'PATCH', body: changes }),
  setRole: (id, role) => request(`/users/${id}/role`, { method: 'PATCH', body: { role } }),
  setStatus: (id, is_active) =>
    request(`/users/${id}/status`, { method: 'PATCH', body: { is_active } }),
  resetPassword: (id, new_password) =>
    request(`/users/${id}/reset-password`, { method: 'POST', body: { new_password } }),
};

export const relationshipsApi = {
  employeesOf: (managerId) => request(`/managers/${managerId}/employees`),
  managersOf: (employeeId) => request(`/employees/${employeeId}/managers`),
  add: (managerId, employee_id) =>
    request(`/managers/${managerId}/employees`, { method: 'POST', body: { employee_id } }),
  remove: (managerId, employeeId) =>
    request(`/managers/${managerId}/employees/${employeeId}`, { method: 'DELETE' }),
};

export const projectsApi = {
  list: (params) => request('/projects', { params: { limit: 200, ...params } }),
  get: (id) => request(`/projects/${id}`),
  create: (project) => request('/projects', { method: 'POST', body: project }),
  update: (id, changes) => request(`/projects/${id}`, { method: 'PATCH', body: changes }),
  setStatus: (id, status) => request(`/projects/${id}/status`, { method: 'PATCH', body: { status } }),
  archive: (id) => request(`/projects/${id}/archive`, { method: 'POST' }),
  restore: (id) => request(`/projects/${id}/restore`, { method: 'POST' }),
  budget: (id) => request(`/projects/${id}/budget`),
  timeline: (id) => request(`/projects/${id}/timeline`),
};

export const milestonesApi = {
  list: (projectId) => request(`/projects/${projectId}/milestones`),
  create: (projectId, milestone) =>
    request(`/projects/${projectId}/milestones`, { method: 'POST', body: milestone }),
  update: (id, changes) => request(`/milestones/${id}`, { method: 'PATCH', body: changes }),
  setStatus: (id, status) => request(`/milestones/${id}/status`, { method: 'PATCH', body: { status } }),
  remove: (id) => request(`/milestones/${id}`, { method: 'DELETE' }),
};

export const assignmentsApi = {
  list: (milestoneId) => request(`/milestones/${milestoneId}/assignments`),
  create: (milestoneId, assignment) =>
    request(`/milestones/${milestoneId}/assignments`, { method: 'POST', body: assignment }),
  update: (id, changes) => request(`/assignments/${id}`, { method: 'PATCH', body: changes }),
  end: (id) => request(`/assignments/${id}/end`, { method: 'POST' }),
  transfer: (id, body) => request(`/assignments/${id}/transfer`, { method: 'POST', body }),
};

export const scheduleApi = {
  forEmployee: (employeeId, start, end) =>
    request(`/employees/${employeeId}/schedule`, { params: { start, end } }),
  availability: (params) => request('/availability', { params }),
};

export const workTermsApi = {
  list: (employeeId) => request(`/employees/${employeeId}/work-terms`),
  create: (employeeId, terms) =>
    request(`/employees/${employeeId}/work-terms`, { method: 'POST', body: terms }),
};

export const auditApi = {
  list: (params) => request('/audit-logs', { params }),
};

export const dashboardApi = {
  admin: () => request('/dashboard/admin'),
  manager: () => request('/dashboard/manager'),
  employee: () => request('/dashboard/employee'),
};
