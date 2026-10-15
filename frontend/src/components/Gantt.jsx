import PropTypes from 'prop-types';
import { daysBetween, formatDate } from '../utils/format';

const BAR_COLOR = { completed: 'bg-emerald-500', pending: 'bg-indigo-500', cancelled: 'bg-slate-400' };

/**
 * Minimal Gantt chart: one bar per milestone positioned by percentage of the
 * overall date range. Pure CSS — no chart library.
 */
export default function Gantt({ milestones, today }) {
  if (!milestones.length) return null;
  const rangeStart = milestones.reduce((min, m) => (m.start_date < min ? m.start_date : min), milestones[0].start_date);
  const rangeEnd = milestones.reduce((max, m) => (m.end_date > max ? m.end_date : max), milestones[0].end_date);
  const span = Math.max(1, daysBetween(rangeStart, rangeEnd) + 1);
  const todayOffset = (daysBetween(rangeStart, today) / span) * 100;

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[560px]">
        <div className="mb-1 flex justify-between text-xs text-slate-500">
          <span>{formatDate(rangeStart)}</span>
          <span>{formatDate(rangeEnd)}</span>
        </div>
        <div className="relative space-y-2">
          {todayOffset >= 0 && todayOffset <= 100 && (
            <div className="absolute inset-y-0 z-10 w-px bg-red-400" style={{ left: `${todayOffset}%` }} title="Today" />
          )}
          {milestones.map((m) => {
            const left = (daysBetween(rangeStart, m.start_date) / span) * 100;
            const width = ((daysBetween(m.start_date, m.end_date) + 1) / span) * 100;
            return (
              <div key={m.id} className="relative h-7 rounded bg-slate-100">
                <div
                  className={`absolute top-0 flex h-7 items-center overflow-hidden rounded px-2 text-xs font-medium text-white ${BAR_COLOR[m.status] || BAR_COLOR.pending}`}
                  style={{ left: `${left}%`, width: `${Math.max(width, 2)}%` }}
                  title={`${m.name}: ${formatDate(m.start_date)} – ${formatDate(m.end_date)}`}
                >
                  <span className="truncate">{m.name}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

Gantt.propTypes = {
  milestones: PropTypes.arrayOf(
    PropTypes.shape({
      id: PropTypes.number,
      name: PropTypes.string,
      start_date: PropTypes.string,
      end_date: PropTypes.string,
      status: PropTypes.string,
    }),
  ).isRequired,
  today: PropTypes.string.isRequired,
};
