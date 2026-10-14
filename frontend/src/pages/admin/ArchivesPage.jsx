import { useState } from 'react';
import { Link } from 'react-router-dom';
import useFetch from '../../hooks/useFetch';
import { projectsApi } from '../../services/endpoints';
import { Async, EmptyState } from '../../components/ui/Feedback';
import { PageHeader, StatusBadge } from '../../components/ui/Display';
import { Button, ConfirmDialog, DataTable } from '../../components/ui/Controls';
import { formatDate, formatMoney, formatDateTime } from '../../utils/format';

/** Archived projects: read-only list with restore. */
export default function ArchivesPage() {
  const state = useFetch(async () => (await projectsApi.list({ include_archived: true })).filter((p) => p.is_archived));
  const [restoring, setRestoring] = useState(null);

  return (
    <>
      <PageHeader title="Archived Projects" subtitle="Read-only. Restore a project to resume work." />
      <Async state={state}>
        {(rows) => (rows.length === 0 ? (
          <EmptyState title="No archived projects" />
        ) : (
          <DataTable
            rows={rows}
            columns={[
              { key: 'name', header: 'Name', render: (p) => <Link to={`/projects/${p.id}`} className="font-medium text-indigo-700 hover:underline">{p.name}</Link> },
              { key: 'period', header: 'Period', render: (p) => `${formatDate(p.start_date)} – ${formatDate(p.estimated_end_date)}` },
              { key: 'estimated_budget', header: 'Budget', render: (p) => formatMoney(p.estimated_budget) },
              { key: 'status', header: 'Status', render: (p) => <StatusBadge status={p.status} /> },
              { key: 'archived_at', header: 'Archived', render: (p) => formatDateTime(p.archived_at) },
              { key: 'actions', header: 'Actions', render: (p) => <Button size="sm" variant="secondary" onClick={() => setRestoring(p)}>Restore</Button> },
            ]}
          />
        ))}
      </Async>
      {restoring && (
        <ConfirmDialog
          title="Restore project"
          message={`Restore "${restoring.name}"? It returns to the active project list with its previous status.`}
          confirmLabel="Restore"
          danger={false}
          onConfirm={() => projectsApi.restore(restoring.id)}
          onClose={(changed) => { setRestoring(null); if (changed) state.reload(); }}
        />
      )}
    </>
  );
}
