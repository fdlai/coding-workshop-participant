import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import useFetch from '../../hooks/useFetch';
import { projectsApi } from '../../services/endpoints';
import { Async } from '../../components/ui/Feedback';
import { StatusBadge } from '../../components/ui/Display';
import OverviewTab from './OverviewTab';
import MilestonesTab from './MilestonesTab';
import EmployeesTab from './EmployeesTab';
import BudgetTab from './BudgetTab';

const TABS = ['Overview', 'Milestones', 'Employees', 'Budget'];

/** Project detail with four tabs. Permissions are derived from role + ownership + project state. */
export default function ProjectDetailPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const [tab, setTab] = useState('Overview');
  const state = useFetch(async () => {
    const [project, timeline] = await Promise.all([projectsApi.get(id), projectsApi.timeline(id)]);
    return { project, timeline };
  }, [id]);

  return (
    <Async state={state}>
      {({ project, timeline }) => {
        const isAdmin = user.role === 'admin';
        const owns = user.role === 'manager' && project.manager_id === user.id;
        const canManage = isAdmin || owns;
        const canSchedule = canManage && !project.is_archived && project.status === 'active';
        const canSeeBudget = canManage;
        const props = { project, isAdmin, onChanged: state.reload };

        return (
          <>
            <Link to="/projects" className="text-sm text-indigo-600 hover:underline">← Back to projects</Link>
            <div className="mb-4 mt-2 flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-bold text-slate-900">{project.name}</h1>
              <StatusBadge status={project.is_archived ? 'archived' : project.status} />
            </div>
            {project.is_archived && (
              <p className="mb-4 rounded-lg bg-slate-100 px-4 py-2 text-sm text-slate-600">This project is archived and read-only.</p>
            )}

            <div className="mb-6 flex gap-1 overflow-x-auto border-b border-slate-200" role="tablist">
              {TABS.map((name) => (
                <button
                  key={name}
                  type="button"
                  role="tab"
                  aria-selected={tab === name}
                  onClick={() => setTab(name)}
                  className={`whitespace-nowrap border-b-2 px-4 py-2 text-sm font-medium ${tab === name ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}
                >
                  {name}
                </button>
              ))}
            </div>

            {tab === 'Overview' && <OverviewTab {...props} timeline={timeline} canManage={canManage} canSeeBudget={canSeeBudget} />}
            {tab === 'Milestones' && <MilestonesTab {...props} canSchedule={canSchedule} canSeeBudget={canSeeBudget} today={timeline.today} />}
            {tab === 'Employees' && <EmployeesTab {...props} canSchedule={canSchedule} />}
            {tab === 'Budget' && <BudgetTab project={project} canSeeBudget={canSeeBudget} />}
          </>
        );
      }}
    </Async>
  );
}
