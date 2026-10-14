import PropTypes from 'prop-types';
import { capitalize, fullName, initials } from '../../utils/format';

const TONES = {
  green: 'bg-emerald-100 text-emerald-800',
  blue: 'bg-blue-100 text-blue-800',
  amber: 'bg-amber-100 text-amber-800',
  red: 'bg-red-100 text-red-800',
  gray: 'bg-slate-100 text-slate-700',
  purple: 'bg-purple-100 text-purple-800',
};

const STATUS_TONE = {
  active: 'green',
  completed: 'blue',
  abandoned: 'gray',
  archived: 'gray',
  pending: 'amber',
  scheduled: 'blue',
  cancelled: 'gray',
  on_track: 'green',
  at_risk: 'amber',
  over_budget: 'red',
  admin: 'purple',
  manager: 'blue',
  employee: 'gray',
  inactive: 'red',
};

/** Coloured pill for any status/role string. */
export function StatusBadge({ status, label }) {
  const tone = TONES[STATUS_TONE[status] || 'gray'];
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${tone}`}>
      {label || capitalize(String(status).replace('_', ' '))}
    </span>
  );
}
StatusBadge.propTypes = { status: PropTypes.string.isRequired, label: PropTypes.string };

/** Circle with initials (or the profile picture when one is set). */
export function Avatar({ person, size = 'md' }) {
  const sizes = { sm: 'h-7 w-7 text-xs', md: 'h-9 w-9 text-sm', lg: 'h-14 w-14 text-lg' };
  if (person?.profile_picture_url) {
    return (
      <img
        src={person.profile_picture_url}
        alt={fullName(person)}
        className={`${sizes[size]} rounded-full object-cover`}
      />
    );
  }
  return (
    <span
      className={`${sizes[size]} inline-flex shrink-0 items-center justify-center rounded-full bg-indigo-100 font-semibold text-indigo-700`}
      aria-hidden="true"
    >
      {initials(person)}
    </span>
  );
}
Avatar.propTypes = {
  person: PropTypes.shape({
    first_name: PropTypes.string,
    last_name: PropTypes.string,
    profile_picture_url: PropTypes.string,
  }),
  size: PropTypes.oneOf(['sm', 'md', 'lg']),
};

export function ProgressBar({ percent, tone = 'indigo' }) {
  const colors = { indigo: 'bg-indigo-600', green: 'bg-emerald-500', amber: 'bg-amber-500', red: 'bg-red-500' };
  const value = Math.max(0, Math.min(100, Number(percent) || 0));
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200" role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}>
      <div className={`h-full rounded-full ${colors[tone]}`} style={{ width: `${value}%` }} />
    </div>
  );
}
ProgressBar.propTypes = { percent: PropTypes.number, tone: PropTypes.oneOf(['indigo', 'green', 'amber', 'red']) };

export function MetricCard({ label, value, hint, tone }) {
  const valueColor = tone === 'red' ? 'text-red-600' : tone === 'amber' ? 'text-amber-600' : 'text-slate-900';
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-sm text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${valueColor}`}>{value}</p>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}
MetricCard.propTypes = {
  label: PropTypes.string.isRequired,
  value: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
  hint: PropTypes.string,
  tone: PropTypes.oneOf(['red', 'amber']),
};

/** White card container with an optional title row. */
export function Card({ title, actions, children, className = '' }) {
  return (
    <section className={`rounded-xl border border-slate-200 bg-white shadow-sm ${className}`}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-3">
          <h2 className="font-semibold text-slate-800">{title}</h2>
          {actions}
        </header>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}
Card.propTypes = {
  title: PropTypes.string,
  actions: PropTypes.node,
  children: PropTypes.node,
  className: PropTypes.string,
};

export function PageHeader({ title, subtitle, actions }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex gap-2">{actions}</div>}
    </div>
  );
}
PageHeader.propTypes = { title: PropTypes.string.isRequired, subtitle: PropTypes.string, actions: PropTypes.node };

/** Simple SVG donut for the budget-health split. */
export function DonutChart({ segments }) {
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  const radius = 40;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  return (
    <div className="flex items-center gap-6">
      <svg viewBox="0 0 100 100" className="h-32 w-32 -rotate-90" role="img" aria-label="Budget health distribution">
        <circle cx="50" cy="50" r={radius} fill="none" stroke="#e2e8f0" strokeWidth="14" />
        {total > 0 && segments.map((segment) => {
          const length = (segment.value / total) * circumference;
          const circle = (
            <circle
              key={segment.label}
              cx="50"
              cy="50"
              r={radius}
              fill="none"
              stroke={segment.color}
              strokeWidth="14"
              strokeDasharray={`${length} ${circumference - length}`}
              strokeDashoffset={-offset}
            />
          );
          offset += length;
          return circle;
        })}
      </svg>
      <ul className="space-y-2 text-sm">
        {segments.map((segment) => (
          <li key={segment.label} className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-full" style={{ backgroundColor: segment.color }} />
            <span className="text-slate-600">{segment.label}</span>
            <span className="font-semibold text-slate-900">{segment.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
DonutChart.propTypes = {
  segments: PropTypes.arrayOf(
    PropTypes.shape({ label: PropTypes.string, value: PropTypes.number, color: PropTypes.string }),
  ).isRequired,
};
