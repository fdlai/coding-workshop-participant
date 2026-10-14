import { Link } from 'react-router-dom';
import useFetch from '../hooks/useFetch';
import { dashboardApi } from '../services/endpoints';
import { Async, EmptyState } from '../components/ui/Feedback';
import ProjectHealthList from '../components/ProjectHealthList';
import { Avatar, Card, MetricCard, PageHeader } from '../components/ui/Display';
import { formatDate, fullName } from '../utils/format';

/** Manager landing page: own projects, upcoming milestones, team availability. */
export default function ManagerDashboard() {
  const state = useFetch(dashboardApi.manager);
  return (
    <>
      <PageHeader title="Manager Dashboard" subtitle="Your projects and team" />
      <Async state={state}>
        {(d) => (
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <MetricCard label="Active projects" value={d.projects.length} />
              <MetricCard label="Team size" value={d.team_size} />
              <MetricCard label="Scheduled now" value={d.employees_scheduled_now} />
              <MetricCard label="Budgets at risk" value={d.budget_at_risk} tone={d.budget_at_risk ? 'amber' : undefined} />
            </div>
            <div className="grid gap-6 lg:grid-cols-3">
              <Card title="My active projects" className="lg:col-span-2" actions={<Link to="/projects" className="text-sm text-indigo-600 hover:underline">All projects</Link>}>
                <ProjectHealthList projects={d.projects} showBudget />
              </Card>
              <div className="space-y-6">
                <Card title="Upcoming milestones">
                  {d.upcoming_milestones.length === 0 ? (
                    <EmptyState title="Nothing upcoming" />
                  ) : (
                    <ul className="space-y-3 text-sm">
                      {d.upcoming_milestones.map((m) => (
                        <li key={m.id}>
                          <Link to={`/projects/${m.project_id}`} className="font-medium text-indigo-700 hover:underline">{m.name}</Link>
                          <p className="text-xs text-slate-500">{m.project_name} · ends {formatDate(m.end_date)} ({m.days_remaining} days)</p>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
                <Card title="Not scheduled right now">
                  {d.unscheduled_team_members.length === 0 ? (
                    <p className="text-sm text-slate-500">Everyone on your team is scheduled.</p>
                  ) : (
                    <ul className="space-y-2">
                      {d.unscheduled_team_members.map((p) => (
                        <li key={p.id} className="flex items-center gap-2 text-sm text-slate-700">
                          <Avatar person={p} size="sm" />
                          {fullName(p)}
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              </div>
            </div>
          </div>
        )}
      </Async>
    </>
  );
}
