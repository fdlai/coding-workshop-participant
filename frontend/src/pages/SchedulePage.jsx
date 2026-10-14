import { useState } from 'react';
import PropTypes from 'prop-types';
import { useAuth } from '../context/AuthContext';
import useFetch from '../hooks/useFetch';
import { relationshipsApi, scheduleApi } from '../services/endpoints';
import { Async, EmptyState } from '../components/ui/Feedback';
import { Card, PageHeader } from '../components/ui/Display';
import { Button } from '../components/ui/Controls';
import ScheduleList from '../components/ScheduleList';
import WeekCalendar from '../components/WeekCalendar';
import { addDays, coversDay, formatDate, fullName, startOfWeek, todayIso } from '../utils/format';

function EmployeeSchedule({ user }) {
  const [weekStart, setWeekStart] = useState(startOfWeek(todayIso()));
  const end = addDays(weekStart, 6);
  const state = useFetch(() => scheduleApi.forEmployee(user.id, weekStart, end), [weekStart]);
  return (
    <>
      <PageHeader title="My Schedule" subtitle={`${formatDate(weekStart)} – ${formatDate(end)}`} actions={(
        <>
          <Button variant="secondary" onClick={() => setWeekStart(addDays(weekStart, -7))}>← Previous</Button>
          <Button variant="secondary" onClick={() => setWeekStart(startOfWeek(todayIso()))}>Today</Button>
          <Button variant="secondary" onClick={() => setWeekStart(addDays(weekStart, 7))}>Next →</Button>
        </>
      )}
      />
      <Async state={state}>
        {(items) => (
          <div className="space-y-6">
            <Card><WeekCalendar items={items} startDate={weekStart} weeks={1} today={todayIso()} /></Card>
            <Card title="Assignments this week"><ScheduleList items={items} emptyTitle="Nothing scheduled this week" /></Card>
          </div>
        )}
      </Async>
    </>
  );
}
EmployeeSchedule.propTypes = { user: PropTypes.shape({ id: PropTypes.number }).isRequired };

/** Rows = team members, columns = days. Week or 4-week (Month) view. */
function TeamSchedule({ user }) {
  const [view, setView] = useState('week');
  const [anchor, setAnchor] = useState(startOfWeek(todayIso()));
  const days = view === 'week' ? 7 : 28;
  const end = addDays(anchor, days - 1);
  const today = todayIso();
  const state = useFetch(async () => {
    const team = await relationshipsApi.employeesOf(user.id);
    const schedules = await Promise.all(team.map((e) => scheduleApi.forEmployee(e.id, anchor, end)));
    return team.map((e, i) => ({ employee: e, items: schedules[i] }));
  }, [anchor, view]);
  const dayList = Array.from({ length: days }, (_, i) => addDays(anchor, i));

  return (
    <>
      <PageHeader
        title="Team Schedule"
        subtitle={`${formatDate(anchor)} – ${formatDate(end)}`}
        actions={(
          <>
            <Button variant={view === 'week' ? 'primary' : 'secondary'} onClick={() => setView('week')}>Week</Button>
            <Button variant={view === 'month' ? 'primary' : 'secondary'} onClick={() => setView('month')}>Month</Button>
            <Button variant="secondary" onClick={() => setAnchor(addDays(anchor, -days))}>←</Button>
            <Button variant="secondary" onClick={() => setAnchor(startOfWeek(today))}>Today</Button>
            <Button variant="secondary" onClick={() => setAnchor(addDays(anchor, days))}>→</Button>
          </>
        )}
      />
      <Async state={state}>
        {(rows) => (rows.length === 0 ? (
          <EmptyState title="No team members" message="An administrator assigns employees to managers." />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="min-w-full text-xs">
              <thead className="bg-slate-50">
                <tr>
                  <th className="sticky left-0 bg-slate-50 px-3 py-2 text-left font-medium text-slate-500">Employee</th>
                  {dayList.map((d) => (
                    <th key={d} className={`px-1 py-2 font-medium ${d === today ? 'text-indigo-700' : 'text-slate-500'}`}>{d.slice(5)}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map(({ employee, items }) => (
                  <tr key={employee.id}>
                    <td className="sticky left-0 whitespace-nowrap bg-white px-3 py-2 font-medium text-slate-800">{fullName(employee)}</td>
                    {dayList.map((d) => {
                      const hit = items.find((it) => coversDay(it.assignment, d));
                      return (
                        <td key={d} className={`h-9 min-w-8 border-l border-slate-100 ${hit ? 'bg-indigo-200' : d === today ? 'bg-indigo-50' : ''}`} title={hit ? `${hit.project_name} – ${hit.milestone_name}` : 'Free'}>
                          <span className="sr-only">{hit ? hit.project_name : 'Free'}</span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </Async>
    </>
  );
}
TeamSchedule.propTypes = { user: PropTypes.shape({ id: PropTypes.number }).isRequired };

/** Employees see their own calendar; managers see their team's grid. */
export default function SchedulePage() {
  const { user } = useAuth();
  return user.role === 'manager' ? <TeamSchedule user={user} /> : <EmployeeSchedule user={user} />;
}
