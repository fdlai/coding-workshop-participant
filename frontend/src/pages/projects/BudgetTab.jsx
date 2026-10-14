import PropTypes from 'prop-types';
import useFetch from '../../hooks/useFetch';
import { projectsApi } from '../../services/endpoints';
import { Async, PermissionDenied } from '../../components/ui/Feedback';
import { Card, MetricCard, ProgressBar, StatusBadge } from '../../components/ui/Display';
import { DataTable } from '../../components/ui/Controls';
import { formatDate, formatMoneyCents } from '../../utils/format';

const TONE = { on_track: 'green', at_risk: 'amber', over_budget: 'red' };

/** Budget tab: aggregated cost only. Employees get a permission-denied state. */
export default function BudgetTab({ project, canSeeBudget }) {
  const state = useFetch(() => (canSeeBudget ? projectsApi.budget(project.id) : Promise.resolve(null)), [project.id, canSeeBudget, project.updated_at]);
  if (!canSeeBudget) return <PermissionDenied message="Budget details are only available to administrators and the project manager." />;

  return (
    <Async state={state}>
      {(b) => b && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <MetricCard label="Estimated budget" value={formatMoneyCents(b.estimated_budget)} />
            <MetricCard label="Accrued to date" value={formatMoneyCents(b.accrued_cost)} hint={`through ${formatDate(b.accrued_through)}`} />
            <MetricCard label="Projected remaining" value={formatMoneyCents(b.projected_cost)} />
            <MetricCard
              label="Budget remaining"
              value={formatMoneyCents(b.budget_remaining)}
              tone={b.health === 'over_budget' ? 'red' : b.health === 'at_risk' ? 'amber' : undefined}
            />
          </div>

          <Card title="Budget utilization" actions={<StatusBadge status={b.health} />}>
            <div className="mb-2 flex justify-between text-sm text-slate-600">
              <span>Total expected cost {formatMoneyCents(b.total_expected_cost)}</span>
              <span>{b.budget_utilization_percent === null ? 'No budget set' : `${Number(b.budget_utilization_percent).toFixed(1)}% of budget`}</span>
            </div>
            <ProgressBar percent={Number(b.budget_utilization_percent) || 0} tone={TONE[b.health]} />
            {b.unpriced_days > 0 && (
              <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
                {b.unpriced_days} scheduled day(s) have no work terms in effect and are not included in these costs.
              </p>
            )}
            {b.note && <p className="mt-3 text-xs text-slate-500">{b.note}</p>}
          </Card>

          <Card title="Cost by milestone">
            <DataTable
              rowKey="milestone_id"
              rows={b.milestones}
              columns={[
                { key: 'name', header: 'Milestone' },
                { key: 'status', header: 'Status', render: (m) => <StatusBadge status={m.status} /> },
                { key: 'accrued_cost', header: 'Accrued', render: (m) => formatMoneyCents(m.accrued_cost) },
                { key: 'projected_cost', header: 'Projected', render: (m) => formatMoneyCents(m.projected_cost) },
                { key: 'total_expected_cost', header: 'Total', render: (m) => formatMoneyCents(m.total_expected_cost) },
              ]}
            />
          </Card>
        </div>
      )}
    </Async>
  );
}

BudgetTab.propTypes = {
  project: PropTypes.object.isRequired,
  canSeeBudget: PropTypes.bool.isRequired,
};
