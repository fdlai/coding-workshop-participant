import { useCallback, useState } from 'react';
import PropTypes from 'prop-types';
import { assignmentsApi, milestonesApi } from '../../services/endpoints';
import useFetch from '../../hooks/useFetch';
import { Async, EmptyState } from '../../components/ui/Feedback';
import { Button, ConfirmDialog, DataTable } from '../../components/ui/Controls';
import { Avatar, StatusBadge } from '../../components/ui/Display';
import { AssignModal, EditAssignmentModal, TransferModal } from './AssignmentModals';
import { formatDate, fullName } from '../../utils/format';

/**
 * Employees tab: every assignment in the project (one row per assignment, history
 * included). Managers/admins can assign, edit, end and transfer. Employees see
 * only their own rows (the API filters them).
 */
export default function EmployeesTab({ project, canSchedule, isAdmin, onChanged }) {
  const load = useCallback(async () => {
    const milestones = await milestonesApi.list(project.id);
    const lists = await Promise.all(milestones.map((m) => assignmentsApi.list(m.id)));
    const rows = lists.flatMap((list, i) => list.map((a) => ({ ...a, milestoneName: milestones[i].name })));
    return { milestones, rows };
  }, [project.id]);
  const state = useFetch(load, [project.id, project.updated_at]);
  const [modal, setModal] = useState(null); // {type, assignment?}

  function close(changed) {
    setModal(null);
    if (changed) {
      state.reload();
      onChanged();
    }
  }

  const columns = (milestones) => [
    {
      key: 'employee',
      header: 'Employee',
      render: (a) => (
        <span className="flex items-center gap-2"><Avatar person={a.employee} size="sm" />{fullName(a.employee)}</span>
      ),
    },
    { key: 'milestoneName', header: 'Milestone' },
    { key: 'period', header: 'Period', render: (a) => `${formatDate(a.start_date)} – ${formatDate(a.effective_end_date)}` },
    { key: 'state', header: 'Status', render: (a) => <StatusBadge status={a.state} /> },
    ...(canSchedule ? [{
      key: 'actions',
      header: 'Actions',
      render: (a) => (['scheduled', 'active'].includes(a.state) ? (
        <div className="flex gap-1">
          <Button variant="ghost" size="sm" onClick={() => setModal({ type: 'edit', assignment: a })}>Edit</Button>
          <Button variant="ghost" size="sm" onClick={() => setModal({ type: 'transfer', assignment: a, milestones })}>Transfer</Button>
          <Button variant="ghost" size="sm" onClick={() => setModal({ type: 'end', assignment: a })}>Remove</Button>
        </div>
      ) : <span className="text-xs text-slate-400">History</span>),
    }] : []),
  ];

  return (
    <div className="space-y-4">
      <Async state={state}>
        {({ milestones, rows }) => (
          <>
            {canSchedule && (
              <Button onClick={() => setModal({ type: 'assign', milestones })} disabled={!milestones.some((m) => m.status === 'pending')}>
                + Assign Employee
              </Button>
            )}
            {rows.length === 0 ? (
              <EmptyState title="No employees assigned" message={canSchedule ? 'Use “Assign Employee” to schedule team members on a milestone.' : undefined} />
            ) : (
              <DataTable columns={columns(milestones)} rows={rows} />
            )}
            {modal?.type === 'assign' && <AssignModal project={project} milestones={milestones} isAdmin={isAdmin} onClose={close} />}
            {modal?.type === 'edit' && <EditAssignmentModal assignment={modal.assignment} onClose={close} />}
            {modal?.type === 'transfer' && <TransferModal assignment={modal.assignment} milestones={milestones} onClose={close} />}
            {modal?.type === 'end' && (
              <ConfirmDialog
                title="Remove from milestone"
                message={`Remove ${fullName(modal.assignment.employee)} from this milestone? Cost stops accruing today; the assignment history is kept.`}
                confirmLabel="Remove"
                onConfirm={() => assignmentsApi.end(modal.assignment.id)}
                onClose={close}
              />
            )}
          </>
        )}
      </Async>
    </div>
  );
}

EmployeesTab.propTypes = {
  project: PropTypes.object.isRequired,
  canSchedule: PropTypes.bool.isRequired,
  isAdmin: PropTypes.bool.isRequired,
  onChanged: PropTypes.func.isRequired,
};
