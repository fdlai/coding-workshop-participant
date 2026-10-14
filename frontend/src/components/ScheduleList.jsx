import { Link } from 'react-router-dom';
import PropTypes from 'prop-types';
import { StatusBadge } from './ui/Display';
import { EmptyState } from './ui/Feedback';
import { formatDate } from '../utils/format';

/** List of ScheduleItem rows (assignment + project/milestone names). */
export default function ScheduleList({ items, emptyTitle = 'No assignments' }) {
  if (!items.length) return <EmptyState title={emptyTitle} />;
  return (
    <ul className="divide-y divide-slate-100">
      {items.map((item) => (
        <li key={item.assignment.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
          <div>
            <Link to={`/projects/${item.project_id}`} className="font-medium text-indigo-700 hover:underline">{item.project_name}</Link>
            <p className="text-xs text-slate-500">{item.milestone_name}</p>
          </div>
          <div className="flex items-center gap-3 text-slate-600">
            <span>{formatDate(item.assignment.start_date)} – {formatDate(item.assignment.effective_end_date)}</span>
            <StatusBadge status={item.assignment.state} />
          </div>
        </li>
      ))}
    </ul>
  );
}

ScheduleList.propTypes = {
  items: PropTypes.arrayOf(PropTypes.object).isRequired,
  emptyTitle: PropTypes.string,
};
