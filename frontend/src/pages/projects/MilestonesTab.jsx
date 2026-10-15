import { useState } from 'react';
import PropTypes from 'prop-types';
import { milestonesApi } from '../../services/endpoints';
import useFetch from '../../hooks/useFetch';
import { Async, EmptyState } from '../../components/ui/Feedback';
import { Button, ConfirmDialog, DataTable, Field, FormModal, TextArea, TextInput } from '../../components/ui/Controls';
import { Card, StatusBadge } from '../../components/ui/Display';
import Gantt from '../../components/Gantt';
import { formatDate } from '../../utils/format';
import MilestoneDetailsModal from './MilestoneDetailsModal';

function MilestoneFormModal({ projectId, milestone, onClose }) {
  const [form, setForm] = useState({
    name: milestone?.name || '',
    description: milestone?.description || '',
    deliverables: milestone?.deliverables || '',
    start_date: milestone?.start_date || '',
    end_date: milestone?.end_date || '',
  });
  const set = (key) => (event) => setForm((f) => ({ ...f, [key]: event.target.value }));

  async function submit() {
    const body = {
      name: form.name.trim(),
      description: form.description.trim() || null,
      deliverables: form.deliverables.trim() || null,
      start_date: form.start_date,
      end_date: form.end_date,
    };
    if (milestone) await milestonesApi.update(milestone.id, body);
    else await milestonesApi.create(projectId, body);
  }

  return (
    <FormModal title={milestone ? 'Edit milestone' : 'Add milestone'} onClose={onClose} onSubmit={submit} wide>
      <Field label="Name" htmlFor="m-name"><TextInput id="m-name" required maxLength={200} value={form.name} onChange={set('name')} /></Field>
      <Field label="Description" htmlFor="m-desc"><TextArea id="m-desc" value={form.description} onChange={set('description')} /></Field>
      <Field label="Deliverables" htmlFor="m-deliv"><TextArea id="m-deliv" value={form.deliverables} onChange={set('deliverables')} /></Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Start date" htmlFor="m-start"><TextInput id="m-start" type="date" required value={form.start_date} onChange={set('start_date')} /></Field>
        <Field label="End date" htmlFor="m-end"><TextInput id="m-end" type="date" required value={form.end_date} onChange={set('end_date')} /></Field>
      </div>
    </FormModal>
  );
}
MilestoneFormModal.propTypes = {
  projectId: PropTypes.number.isRequired,
  milestone: PropTypes.object,
  onClose: PropTypes.func.isRequired,
};

/** Milestones tab: Gantt chart, table, add/edit and completion workflow. */
export default function MilestonesTab({ project, canSchedule, canSeeBudget, today, onChanged }) {
  const milestones = useFetch(() => milestonesApi.list(project.id), [project.id, project.updated_at]);
  const [viewing, setViewing] = useState(null);
  const [editing, setEditing] = useState(null); // null | 'new' | milestone
  const [completing, setCompleting] = useState(null);
  const [cancelling, setCancelling] = useState(null);
  const [deleting, setDeleting] = useState(null);

  function refresh(changed) {
    if (changed) {
      milestones.reload();
      onChanged();
    }
  }

  const columns = [
    {
      key: 'name',
      header: 'Milestone',
      render: (m) => (
        <button type="button" onClick={() => setViewing(m)} className="text-left font-medium text-slate-900 hover:text-indigo-700 hover:underline">
          {m.name}
        </button>
      ),
    },
    { key: 'period', header: 'Period', render: (m) => `${formatDate(m.start_date)} – ${formatDate(m.end_date)}` },
    { key: 'status', header: 'Status', render: (m) => <StatusBadge status={m.status} /> },
    { key: 'completed_at', header: 'Completed', render: (m) => formatDate(m.completed_at) },
    ...(canSchedule ? [{
      key: 'actions',
      header: 'Actions',
      render: (m) => (m.status === 'pending' ? (
        // Keep action clicks from also opening the details (the whole row is clickable).
        <div className="flex gap-2" onClick={(event) => event.stopPropagation()}>
          <Button variant="ghost" size="sm" onClick={() => setEditing(m)}>Edit</Button>
          <Button variant="ghost" size="sm" onClick={() => setCompleting(m)}>Complete</Button>
          <Button variant="ghost" size="sm" onClick={() => setCancelling(m)}>Cancel</Button>
          <Button variant="ghost" size="sm" onClick={() => setDeleting(m)}>Delete</Button>
        </div>
      ) : <span className="text-slate-400">—<span className="sr-only">No actions available</span></span>),
    }] : []),
  ];

  return (
    <div className="space-y-6">
      {canSchedule && (
        <div><Button onClick={() => setEditing('new')}>+ Add Milestone</Button></div>
      )}
      <Async state={milestones}>
        {(rows) => (rows.length === 0 ? (
          <EmptyState title="No milestones yet" message={canSchedule ? 'Add the first milestone to start planning.' : undefined} />
        ) : (
          <>
            <Card title="Timeline"><Gantt milestones={rows} today={today} /></Card>
            <div className="space-y-2">
              <p className="text-sm text-slate-500">Click a milestone to see its details and everyone who worked on it.</p>
              <DataTable columns={columns} rows={rows} onRowClick={setViewing} />
            </div>
          </>
        ))}
      </Async>

      {viewing && (
        <MilestoneDetailsModal
          projectId={project.id}
          milestone={viewing}
          canSeeBudget={canSeeBudget}
          onClose={() => setViewing(null)}
        />
      )}

      {editing && (
        <MilestoneFormModal
          projectId={project.id}
          milestone={editing === 'new' ? null : editing}
          onClose={(changed) => { setEditing(null); refresh(changed); }}
        />
      )}
      {completing && (
        <ConfirmDialog
          title="Complete milestone"
          message={`Mark "${completing.name}" as completed? Today counts as the final billable day, assignments end, and this cannot be undone.`}
          confirmLabel="Complete milestone"
          danger={false}
          onConfirm={() => milestonesApi.setStatus(completing.id, 'completed')}
          onClose={(changed) => { setCompleting(null); refresh(changed); }}
        />
      )}
      {cancelling && (
        <ConfirmDialog
          title="Cancel milestone"
          message={`Cancel "${cancelling.name}"? Its assignments end at the start of today, so today is not billed. Work done through yesterday stays on the budget, and this cannot be undone.`}
          confirmLabel="Cancel milestone"
          onConfirm={() => milestonesApi.setStatus(cancelling.id, 'cancelled')}
          onClose={(changed) => { setCancelling(null); refresh(changed); }}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title="Delete milestone"
          message={`Delete "${deleting.name}"? This only works for milestones with no assignments; otherwise cancel it instead.`}
          confirmLabel="Delete milestone"
          onConfirm={() => milestonesApi.remove(deleting.id)}
          onClose={(changed) => { setDeleting(null); refresh(changed); }}
        />
      )}
    </div>
  );
}

MilestonesTab.propTypes = {
  project: PropTypes.object.isRequired,
  canSchedule: PropTypes.bool.isRequired,
  canSeeBudget: PropTypes.bool.isRequired,
  today: PropTypes.string.isRequired,
  onChanged: PropTypes.func.isRequired,
};
