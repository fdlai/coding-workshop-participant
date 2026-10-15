import { useState } from 'react';
import { Link } from 'react-router-dom';
import PropTypes from 'prop-types';
import { EmptyState } from './ui/Feedback';
import { ProgressBar, StatusBadge } from './ui/Display';
import { formatDate, formatMoney, fullName } from '../utils/format';

const HEALTH_TONE = { on_track: 'green', at_risk: 'amber', over_budget: 'red' };
const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];
const selectClass = 'rounded-md border border-slate-300 bg-white px-2 py-1 text-sm text-slate-700';

/** Projects with budget health and utilization bars (dashboard payload shape). */
export default function ProjectHealthList({ projects, showBudget = true }) {
  const [filter, setFilter] = useState('all');
  const [pageSize, setPageSize] = useState(25);
  const [page, setPage] = useState(1);

  if (!projects.length) return <EmptyState title="No active projects" />;

  const countOf = (health) => projects.filter((p) => p.health === health).length;
  const filtered = filter === 'all' ? projects : projects.filter((p) => p.health === filter);
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const visible = filtered.slice((page - 1) * pageSize, page * pageSize);

  const changeFilter = (event) => {
    setFilter(event.target.value);
    setPage(1);
  };

  const changePageSize = (event) => {
    setPageSize(Number(event.target.value));
    setPage(1);
  };

  return (
    <div>
      <div className="flex flex-wrap justify-end gap-2 pb-2">
        <select
          value={pageSize}
          onChange={changePageSize}
          aria-label="Projects per page"
          className={selectClass}
        >
          {PAGE_SIZE_OPTIONS.map((size) => (
            <option key={size} value={size}>{size} per page</option>
          ))}
        </select>
        <select
          value={filter}
          onChange={changeFilter}
          aria-label="Filter projects by budget health"
          className={selectClass}
        >
          <option value="all">All projects ({projects.length})</option>
          <option value="on_track">On track ({countOf('on_track')})</option>
          <option value="at_risk">At risk ({countOf('at_risk')})</option>
          <option value="over_budget">Over budget ({countOf('over_budget')})</option>
        </select>
      </div>

      {visible.length === 0 ? (
        <EmptyState title="No projects match this filter" />
      ) : (
        <ul className="divide-y divide-slate-100">
          {visible.map((project) => (
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
      )}

      {pageCount > 1 && (
        <div className="flex items-center justify-between border-t border-slate-100 pt-3 text-sm text-slate-600">
          <button
            type="button"
            onClick={() => setPage(page - 1)}
            disabled={page === 1}
            className="rounded-md border border-slate-300 px-3 py-1 disabled:opacity-40"
          >
            Previous
          </button>
          <span>Page {page} of {pageCount}</span>
          <button
            type="button"
            onClick={() => setPage(page + 1)}
            disabled={page === pageCount}
            className="rounded-md border border-slate-300 px-3 py-1 disabled:opacity-40"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}

ProjectHealthList.propTypes = {
  projects: PropTypes.arrayOf(PropTypes.object).isRequired,
  showBudget: PropTypes.bool,
};
