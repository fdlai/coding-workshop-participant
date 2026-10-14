import PropTypes from 'prop-types';
import { addDays, coversDay, startOfWeek } from '../utils/format';

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/**
 * Calendar of `weeks` weeks (Mon–Sun rows) for one employee's schedule items.
 * Each day shows the projects the employee is assigned to.
 */
export default function WeekCalendar({ items, startDate, weeks, today }) {
  const first = startOfWeek(startDate);
  const rows = Array.from({ length: weeks }, (_, w) => addDays(first, w * 7));

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[640px] space-y-1">
        <div className="grid grid-cols-7 gap-1 text-center text-xs font-medium text-slate-500">
          {DAY_NAMES.map((name) => <div key={name}>{name}</div>)}
        </div>
        {rows.map((weekStart) => (
          <div key={weekStart} className="grid grid-cols-7 gap-1">
            {DAY_NAMES.map((name, index) => {
              const day = addDays(weekStart, index);
              const todays = items.filter((item) => coversDay(item.assignment, day));
              const weekend = index >= 5;
              return (
                <div
                  key={day}
                  className={`min-h-16 rounded-lg border p-1.5 text-xs ${
                    day === today ? 'border-indigo-400 bg-indigo-50' : weekend ? 'border-slate-100 bg-slate-50' : 'border-slate-200 bg-white'
                  }`}
                >
                  <div className="text-slate-400">{day.slice(5)}</div>
                  {todays.map((item) => (
                    <div key={item.assignment.id} className="mt-0.5 truncate rounded bg-indigo-100 px-1 py-0.5 text-indigo-800" title={`${item.project_name} – ${item.milestone_name}`}>
                      {item.project_name}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

WeekCalendar.propTypes = {
  items: PropTypes.arrayOf(PropTypes.object).isRequired,
  startDate: PropTypes.string.isRequired,
  weeks: PropTypes.number.isRequired,
  today: PropTypes.string.isRequired,
};
