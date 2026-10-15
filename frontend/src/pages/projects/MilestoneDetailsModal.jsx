import { useCallback } from 'react';
import PropTypes from 'prop-types';
import { assignmentsApi, projectsApi } from '../../services/endpoints';
import useFetch from '../../hooks/useFetch';
import { Async } from '../../components/ui/Feedback';
import { DataTable, Modal } from '../../components/ui/Controls';
import { Avatar, MetricCard, StatusBadge } from '../../components/ui/Display';
import { assignmentDisplayState, formatDate, formatMoneyCents, fullName } from '../../utils/format';

function Detail({ label, children }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-1 text-sm text-slate-800">{children}</dd>
    </div>
  );
}
Detail.propTypes = { label: PropTypes.string.isRequired, children: PropTypes.node };

/**
 * Read-only milestone details: dates, description, cost (admins and the project's
 * manager only) and everyone ever assigned, including people removed or transferred.
 */
export default function MilestoneDetailsModal({ projectId, milestone, canSeeBudget, onClose }) {
  const load = useCallback(async () => {
    const [assignments, budget] = await Promise.all([
      assignmentsApi.list(milestone.id),
      canSeeBudget ? projectsApi.budget(projectId) : Promise.resolve(null),
    ]);
    const cost = budget?.milestones.find((m) => m.milestone_id === milestone.id) || null;
    return { assignments, cost };
  }, [projectId, milestone.id, canSeeBudget]);
  const state = useFetch(load, [milestone.id, canSeeBudget]);

  const columns = [
    {
      key: 'employee',
      header: 'Employee',
      render: (a) => (
        <span className="flex items-center gap-2">
          <Avatar person={a.employee} size="sm" />
          {fullName(a.employee)}
          {a.employee?.is_active === false && <StatusBadge status="inactive" />}
        </span>
      ),
    },
    {
      key: 'period',
      header: 'Worked',
      render: (a) => (a.state === 'cancelled' ? '—' : `${formatDate(a.start_date)} – ${formatDate(a.effective_end_date)}`),
    },
    { key: 'planned', header: 'Planned end', render: (a) => formatDate(a.planned_end_date) },
    { key: 'state', header: 'Status', render: (a) => <StatusBadge status={assignmentDisplayState(a, milestone.status)} /> },
  ];

  return (
    <Modal title={milestone.name} onClose={onClose} wide>
      <div className="space-y-6">
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <Detail label="Status"><StatusBadge status={milestone.status} /></Detail>
          <Detail label="Period">{formatDate(milestone.start_date)} – {formatDate(milestone.end_date)}</Detail>
          {milestone.completed_at && <Detail label="Completed">{formatDate(milestone.completed_at)}</Detail>}
        </dl>
        {milestone.description && <Detail label="Description">{milestone.description}</Detail>}
        {milestone.deliverables && <Detail label="Deliverables">{milestone.deliverables}</Detail>}

        <Async state={state}>
          {({ assignments, cost }) => (
            <div className="space-y-6">
              {cost && (
                <div className="grid gap-3 sm:grid-cols-3">
                  <MetricCard label="Accrued" value={formatMoneyCents(cost.accrued_cost)} />
                  <MetricCard label="Projected" value={formatMoneyCents(cost.projected_cost)} />
                  <MetricCard label="Total" value={formatMoneyCents(cost.total_expected_cost)} />
                </div>
              )}
              <div>
                <h3 className="mb-2 text-sm font-semibold text-slate-900">People</h3>
                {assignments.length === 0 ? (
                  <p className="text-sm text-slate-500">No one has been assigned to this milestone.</p>
                ) : (
                  <DataTable columns={columns} rows={assignments} />
                )}
              </div>
            </div>
          )}
        </Async>
      </div>
    </Modal>
  );
}

MilestoneDetailsModal.propTypes = {
  projectId: PropTypes.number.isRequired,
  milestone: PropTypes.object.isRequired,
  canSeeBudget: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
};
