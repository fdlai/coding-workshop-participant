import useFetch from '../hooks/useFetch';
import { dashboardApi } from '../services/endpoints';
import { Async } from '../components/ui/Feedback';
import ScheduleList from '../components/ScheduleList';
import WeekCalendar from '../components/WeekCalendar';
import { Avatar, Card, PageHeader } from '../components/ui/Display';
import { formatDate, fullName } from '../utils/format';

/** Employee landing page: current/upcoming assignments and managers. No budget data. */
export default function EmployeeDashboard() {
  const state = useFetch(dashboardApi.employee);
  return (
    <>
      <Async state={state}>
        {(d) => (
          <>
            <PageHeader title="My Dashboard" subtitle={`Today is ${formatDate(d.today)}`} />
            <div className="grid gap-6 lg:grid-cols-3">
              <div className="space-y-6 lg:col-span-2">
                <Card title="Current assignments">
                  <ScheduleList items={d.current_assignments} emptyTitle="You have no assignment today" />
                </Card>
                <Card title="Upcoming assignments">
                  <ScheduleList items={d.upcoming_assignments} emptyTitle="No upcoming assignments" />
                </Card>
                <Card title="My schedule (next 4 weeks)">
                  <WeekCalendar
                    items={[...d.current_assignments, ...d.upcoming_assignments]}
                    startDate={d.today}
                    weeks={4}
                    today={d.today}
                  />
                </Card>
              </div>
              <Card title="My managers">
                {d.managers.length === 0 ? (
                  <p className="text-sm text-slate-500">No managers assigned yet.</p>
                ) : (
                  <ul className="space-y-3">
                    {d.managers.map((m) => (
                      <li key={m.id} className="flex items-center gap-3 text-sm">
                        <Avatar person={m} />
                        <div>
                          <p className="font-medium text-slate-800">{fullName(m)}</p>
                          <p className="text-xs text-slate-500">{m.job_title || 'Manager'}</p>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>
          </>
        )}
      </Async>
    </>
  );
}
