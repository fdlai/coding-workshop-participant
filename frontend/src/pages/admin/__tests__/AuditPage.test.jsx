import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AuditPage from '../AuditPage';
import { apiError, callsTo, renderApp, users } from '../../../test/utils';

const actor = { id: 1, username: 'admin', first_name: 'Ada', last_name: 'Admin', role: 'admin', is_active: true };
const entry = (id, overrides = {}) => ({
  id,
  created_at: '2030-06-01T09:30:00Z',
  actor,
  action: 'project.create',
  entity_type: 'project',
  entity_id: id,
  description: `Created project ${id}`,
  changes: null,
  ...overrides,
});

const page = (items, extra = {}) => ({
  items,
  total: items.length,
  limit: 25,
  offset: 0,
  available_actions: ['project.create', 'user.create'],
  available_entity_types: ['project', 'user'],
  ...extra,
});

const lastParams = (calls) =>
  Object.fromEntries(new URL(callsTo(calls, 'GET /audit-logs').at(-1).url, 'http://localhost').searchParams);

function renderAudit(logs) {
  return renderApp(<AuditPage />, {
    user: users.admin,
    routes: { 'GET /users': [actor, users.manager], 'GET /audit-logs': logs },
  });
}

describe('AuditPage', () => {
  it('lists audit entries with actor, action and entity', async () => {
    await renderAudit(page([entry(7), entry(8, { action: 'user.create', entity_type: 'user', description: 'Created user bob' })]));
    expect(await screen.findByText('Created project 7')).toBeInTheDocument();
    expect(screen.getByText('project #7')).toBeInTheDocument();
    expect(screen.getByText('user #8')).toBeInTheDocument();
    expect(screen.getAllByText('Ada Admin').length).toBeGreaterThan(0);
  });

  it('sends each filter to the API and resets them with Clear', async () => {
    const { calls } = await renderAudit((_, url) => {
      const action = new URL(url, 'http://localhost').searchParams.get('action');
      return action === 'user.create' ? page([]) : page([entry(7)]);
    });
    await screen.findByText('Created project 7');
    await userEvent.selectOptions(screen.getByLabelText('Entity type'), 'user');
    await userEvent.selectOptions(await screen.findByRole('combobox', { name: 'Actor' }), 'Max Manager');
    await userEvent.type(screen.getByLabelText('From date'), '2030-01-01');
    await userEvent.type(screen.getByLabelText('To date'), '2030-12-31');
    await userEvent.selectOptions(screen.getByLabelText('Action'), 'user.create');

    expect(await screen.findByText('No audit entries match')).toBeInTheDocument();
    expect(lastParams(calls)).toEqual({
      action: 'user.create', entity_type: 'user', actor_id: '2', since: '2030-01-01', until: '2030-12-31', limit: '25', offset: '0',
    });

    await userEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(await screen.findByText('Created project 7')).toBeInTheDocument();
    expect(lastParams(calls)).toEqual({ limit: '25', offset: '0' });
  });

  it('pages through results using the server offset', async () => {
    const { calls } = await renderAudit((_, url) => {
      const offset = Number(new URL(url, 'http://localhost').searchParams.get('offset'));
      return offset === 0
        ? page([entry(1)], { total: 30 })
        : page([entry(26)], { total: 30, offset: 25 });
    });
    expect(await screen.findByText('Showing 1–25 of 30')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByText('Showing 26–30 of 30')).toBeInTheDocument();
    expect(screen.getByText('Created project 26')).toBeInTheDocument();
    expect(lastParams(calls).offset).toBe('25');
  });

  it('keeps the filters usable after a failed request so the user can recover', async () => {
    await renderAudit((_, url) => {
      const until = new URL(url, 'http://localhost').searchParams.get('until');
      return until === '2029-01-01'
        ? apiError(422, 'until: must be on or after since')
        : page([entry(7)]);
    });
    await screen.findByText('Created project 7');
    await userEvent.type(screen.getByLabelText('From date'), '2030-01-01');
    await userEvent.type(screen.getByLabelText('To date'), '2029-01-01');

    expect(await screen.findByText('until: must be on or after since')).toBeInTheDocument();
    expect(screen.getByLabelText('Action')).toHaveTextContent('user.create');

    await userEvent.clear(screen.getByLabelText('To date'));
    expect(await screen.findByText('Created project 7')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows permission denied when the API refuses access', async () => {
    await renderAudit(apiError(403, 'Admins only'));
    expect(await screen.findByText('Access denied')).toBeInTheDocument();
    expect(screen.getByText('Admins only')).toBeInTheDocument();
  });
});
