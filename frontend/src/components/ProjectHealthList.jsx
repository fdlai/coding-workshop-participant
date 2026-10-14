import { Link } from 'react-router-dom';
import PropTypes from 'prop-types';
import { EmptyState } from './ui/Feedback';
import { ProgressBar, StatusBadge } from './ui/Display';
import { formatDate, formatMoney, fullName } from '../utils/format';

const HEALTH_TONE = { on_track: 'green', at_risk: 'amber', over_budget: 'red' };

/** Projects with budget health and utilization bars (dashboard payload shape). */
export default function ProjectHealthList({ projects, showBudget = true }) {
  if (!projects.length) return <EmptyState title="No active projects" />;
  return (
    <ul className="divide-y divide-slate-100">
      {projects.map((project) => (
        <li key={project.id} className="py-3">
          <div className="flex items-center justify-between gap-3">
            <Link to={`/projects/${project.id}`} className="font-medium text-indigo-700 hover:underline">{project.name}</Link>
            <StatusBadge status={project.health} />
          </div>
          <p className="mt-0.5 text-xs text-slate-500">
            {showBudget && `${fullName(project.manager)} · `}
            {project.milestones_completed}/{project.milestones_total} milestones · {project.assigned_employee_count} assigned · due {formatDate(project.estimated_end_date)}
          </p>
          {showBudget && (
            <div className="mt-2 flex items-center gap-3">
              <div className="flex-1"><ProgressBar percent={project.budget_utilization_percent ?? 0} tone={HEALTH_TONE[project.health]} /></div>
              <span className="w-32 text-right text-xs text-slate-600">{formatMoney(project.total_expected_cost)} / {formatMoney(project.estimated_budget)}</span>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

ProjectHealthList.propTypes = {
  projects: PropTypes.arrayOf(PropTypes.object).isRequired,
  showBudget: PropTypes.bool,
};
