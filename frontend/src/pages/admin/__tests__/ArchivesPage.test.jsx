import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ArchivesPage from '../ArchivesPage';
import { apiError, callsTo, renderApp, users } from '../../../test/utils';

const project = (id, name, overrides = {}) => ({
  id,
  name,
  description: null,
  manager_id: 2,
  created_by: 1,
  start_date: '2029-01-01',
  estimated_end_date: '2029-06-30',
  estimated_budget: '50000.00',
  status: 'completed',
  is_archived: false,
  archived_at: null,
  created_at: '2028-12-01T00:00:00Z',
  updated_at: '2029-07-01T00:00:00Z',
  ...overrides,
});

const archived = project(4, 'Legacy Portal', { is_archived: true, archived_at: '2029-07-01T10:00:00Z' });
const live = project(5, 'Live Project', { status: 'active' });

function renderArchives(routes) {
  return renderApp(<ArchivesPage />, { user: users.admin, route: '/archives', path: '/archives', routes });
}

describe('ArchivesPage', () => {
  it('lists only archived projects, requesting archived ones from the API', async () => {
    const { calls } = await renderArchives({ 'GET /projects': [archived, live] });
    expect(await screen.findByRole('link', { name: 'Legacy Portal' })).toHaveAttribute('href', '/projects/4');
    expect(screen.queryByText('Live Project')).not.toBeInTheDocument();
    expect(screen.getByText('$50,000')).toBeInTheDocument();
    expect(screen.getByText('Jan 1, 2029 – Jun 30, 2029')).toBeInTheDocument();
    expect(callsTo(calls, 'GET /projects')[0].url).toContain('include_archived=true');
  });

  it('restores a project after confirmation and removes it from the list', async () => {
    let rows = [archived];
    const { calls } = await renderArchives({
      'GET /projects': () => rows,
      'POST /projects/4/restore': () => { rows = [{ ...archived, is_archived: false }]; return rows[0]; },
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Restore' }));
    const dialog = screen.getByRole('dialog', { name: 'Restore project' });
    expect(dialog).toHaveTextContent('Restore "Legacy Portal"?');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Restore' }));

    expect(await screen.findByText('No archived projects')).toBeInTheDocument();
    expect(callsTo(calls, 'POST /projects/4/restore')).toHaveLength(1);
  });

  it('shows the error when a restore fails', async () => {
    await renderArchives({
      'GET /projects': [archived],
      'POST /projects/4/restore': apiError(409, 'Manager is inactive'),
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Restore' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Restore' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Manager is inactive');
  });

  it('shows an empty state when nothing is archived', async () => {
    await renderArchives({ 'GET /projects': [live] });
    expect(await screen.findByText('No archived projects')).toBeInTheDocument();
  });
});
