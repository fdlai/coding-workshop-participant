import useFetch from '../hooks/useFetch';
import { useAuth } from '../context/AuthContext';
import { relationshipsApi, scheduleApi } from '../services/endpoints';
import { Async, EmptyState } from '../components/ui/Feedback';
import { Avatar, PageHeader, StatusBadge } from '../components/ui/Display';
import { DataTable } from '../components/ui/Controls';
import { formatDate, fullName, todayIso } from '../utils/format';

/** Manager's team: members with today's availability. */
export default function TeamPage() {
  const { user } = useAuth();
  const state = useFetch(async () => {
    const today = todayIso();
    const [team, availability] = await Promise.all([
      relationshipsApi.employeesOf(user.id),
      scheduleApi.availability({ start: today, end: today }),
    ]);
    const busyById = new Map(availability.map((a) => [a.employee.id, a]));
    return team.map((e) => ({ ...e, availability: busyById.get(e.id) }));
  });

  return (
    <>
      <PageHeader title="My Team" subtitle="Employees assigned to you" />
      <Async state={state}>
        {(rows) => (rows.length === 0 ? (
          <EmptyState title="No employees assigned" message="An administrator assigns employees to managers." />
        ) : (
          <DataTable
            rows={rows}
            columns={[
              { key: 'name', header: 'Name', render: (e) => <span className="flex items-center gap-2"><Avatar person={e} size="sm" /><span className="font-medium text-slate-900">{fullName(e)}</span></span> },
              { key: 'job_title', header: 'Job title', render: (e) => e.job_title || '—' },
              {
                key: 'today',
                header: 'Today',
                render: (e) => {
                  if (!e.is_active) return <StatusBadge status="inactive" />;
                  if (!e.availability) return <span className="text-slate-400">Unknown</span>;
                  return e.availability.is_available ? <StatusBadge status="active" label="Available" /> : <StatusBadge status="scheduled" label="Scheduled" />;
                },
              },
              {
                key: 'busy',
                header: 'Current booking',
                render: (e) => (e.availability && !e.availability.is_available
                  ? e.availability.busy.map((b) => `${formatDate(b.start_date)} – ${formatDate(b.end_date)}`).join(', ')
                  : '—'),
              },
            ]}
          />
        ))}
      </Async>
    </>
  );
}
