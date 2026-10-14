import { Link } from 'react-router-dom';
import useFetch from '../hooks/useFetch';
import { dashboardApi } from '../services/endpoints';
import { Async, EmptyState } from '../components/ui/Feedback';
import ProjectHealthList from '../components/ProjectHealthList';
import { Card, DonutChart, MetricCard, PageHeader, Avatar } from '../components/ui/Display';
import { formatDateTime, fullName } from '../utils/format';

/** Admin landing page: company-wide counts, budget health, recent audit activity. */
export default function AdminDashboard() {
  const state = useFetch(dashboardApi.admin);
  return (
    <>
      <PageHeader title="Admin Dashboard" subtitle="Company-wide overview" />
      <Async state={state}>
        {(d) => (
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <MetricCard label="Active projects" value={d.active_projects} />
              <MetricCard label="Employees" value={d.employees} />
              <MetricCard label="Managers" value={d.managers} />
              <MetricCard label="Projects at risk" value={d.projects_at_risk} tone={d.projects_at_risk ? 'amber' : undefined} />
            </div>
            <div className="grid gap-6 lg:grid-cols-3">
              <Card title="Budget health" className="lg:col-span-1">
                <DonutChart
                  segments={[
                    { label: 'On track', value: d.health_counts.on_track, color: '#10b981' },
                    { label: 'At risk', value: d.health_counts.at_risk, color: '#f59e0b' },
                    { label: 'Over budget', value: d.health_counts.over_budget, color: '#ef4444' },
                  ]}
                />
              </Card>
              <Card title="Recent activity" className="lg:col-span-2" actions={<Link to="/admin/audit" className="text-sm text-indigo-600 hover:underline">View all</Link>}>
                {d.recent_activity.length === 0 ? (
                  <EmptyState title="No activity yet" />
                ) : (
                  <ul className="space-y-3">
                    {d.recent_activity.map((entry) => (
                      <li key={entry.id} className="flex items-start gap-3 text-sm">
                        <Avatar person={entry.actor} size="sm" />
                        <div>
                          <p className="text-slate-800">{entry.description}</p>
                          <p className="text-xs text-slate-500">{fullName(entry.actor)} · {formatDateTime(entry.created_at)}</p>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>
            <Card title="Active projects">
              <ProjectHealthList projects={d.projects} />
            </Card>
          </div>
        )}
      </Async>
    </>
  );
}
