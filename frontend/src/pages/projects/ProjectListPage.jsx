import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import useFetch from '../../hooks/useFetch';
import { projectsApi, usersApi } from '../../services/endpoints';
import { Async, EmptyState } from '../../components/ui/Feedback';
import { StatusBadge, PageHeader } from '../../components/ui/Display';
import { Button, DataTable, FilterBar, Pagination, SelectInput, TextInput, ConfirmDialog } from '../../components/ui/Controls';
import ProjectFormModal from './ProjectFormModal';
import { formatDate, formatMoney, fullName } from '../../utils/format';

const PAGE_SIZE = 10;

/** Project list (role-filtered by the API) with search, filters and admin actions. */
export default function ProjectListPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const isAdmin = user.role === 'admin';
  const canSeeBudget = user.role !== 'employee';

  const projects = useFetch(() => projectsApi.list());
  const managers = useFetch(() => (isAdmin ? usersApi.list({ role: 'manager' }) : Promise.resolve([])), [isAdmin]);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [managerId, setManagerId] = useState('');
  const [offset, setOffset] = useState(0);
  const [creating, setCreating] = useState(false);
  const [archiving, setArchiving] = useState(null);

  const managerName = useMemo(() => {
    const map = new Map((managers.data || []).map((m) => [m.id, fullName(m)]));
    if (user.role === 'manager') map.set(user.id, fullName(user));
    return (id) => map.get(id) || '—';
  }, [managers.data, user]);

  function filtered(rows) {
    return rows.filter((p) => (
      p.name.toLowerCase().includes(search.toLowerCase()) &&
      (!status || p.status === status) &&
      (!managerId || p.manager_id === Number(managerId))
    ));
  }

  const columns = [
    { key: 'name', header: 'Name', render: (p) => <span className="font-medium text-slate-900">{p.name}</span> },
    ...(isAdmin ? [{ key: 'manager', header: 'Manager', render: (p) => managerName(p.manager_id) }] : []),
    { key: 'start_date', header: 'Start', render: (p) => formatDate(p.start_date) },
    { key: 'estimated_end_date', header: 'End', render: (p) => formatDate(p.estimated_end_date) },
    ...(canSeeBudget ? [{ key: 'estimated_budget', header: 'Budget', render: (p) => formatMoney(p.estimated_budget) }] : []),
    { key: 'status', header: 'Status', render: (p) => <StatusBadge status={p.status} /> },
    {
      key: 'actions',
      header: 'Actions',
      render: (p) => (
        <div className="flex gap-2" onClick={(e) => e.stopPropagation()} role="presentation">
          <Button variant="ghost" size="sm" onClick={() => navigate(`/projects/${p.id}`)}>View</Button>
          {isAdmin && <Button variant="ghost" size="sm" onClick={() => setArchiving(p)}>Archive</Button>}
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title={user.role === 'admin' ? 'Projects' : 'My Projects'}
        subtitle={isAdmin ? 'All active (non-archived) projects' : 'Projects you are involved in'}
        actions={isAdmin && <Button onClick={() => setCreating(true)}>+ New Project</Button>}
      />
      <FilterBar>
        <div className="w-full sm:w-64">
          <TextInput placeholder="Search projects…" aria-label="Search projects" value={search} onChange={(e) => { setSearch(e.target.value); setOffset(0); }} />
        </div>
        <div className="w-40">
          <SelectInput aria-label="Filter by status" value={status} onChange={(e) => { setStatus(e.target.value); setOffset(0); }}>
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="completed">Completed</option>
            <option value="abandoned">Abandoned</option>
          </SelectInput>
        </div>
        {isAdmin && (
          <div className="w-48">
            <SelectInput aria-label="Filter by manager" value={managerId} onChange={(e) => { setManagerId(e.target.value); setOffset(0); }}>
              <option value="">All managers</option>
              {(managers.data || []).map((m) => <option key={m.id} value={m.id}>{fullName(m)}</option>)}
            </SelectInput>
          </div>
        )}
      </FilterBar>

      <Async state={projects}>
        {(rows) => {
          const visible = filtered(rows);
          if (!visible.length) {
            return <EmptyState title="No projects found" message={rows.length ? 'Try changing your filters.' : 'There are no projects to show yet.'} />;
          }
          return (
            <>
              <DataTable columns={columns} rows={visible.slice(offset, offset + PAGE_SIZE)} onRowClick={(p) => navigate(`/projects/${p.id}`)} />
              <Pagination offset={offset} limit={PAGE_SIZE} total={visible.length} onChange={setOffset} />
            </>
          );
        }}
      </Async>

      {creating && <ProjectFormModal isAdmin onClose={(changed) => { setCreating(false); if (changed) projects.reload(); }} />}
      {archiving && (
        <ConfirmDialog
          title="Archive project"
          message={`Archive "${archiving.name}"? It becomes read-only and moves to Archived Projects. History is preserved and you can restore it later.`}
          confirmLabel="Archive"
          onConfirm={() => projectsApi.archive(archiving.id)}
          onClose={(changed) => { setArchiving(null); if (changed) projects.reload(); }}
        />
      )}
    </>
  );
}
