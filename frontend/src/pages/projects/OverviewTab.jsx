import { useState } from 'react';
import PropTypes from 'prop-types';
import useFetch from '../../hooks/useFetch';
import { projectsApi } from '../../services/endpoints';
import { Async } from '../../components/ui/Feedback';
import { Button, ConfirmDialog } from '../../components/ui/Controls';
import { Card, ProgressBar, StatusBadge } from '../../components/ui/Display';
import ProjectFormModal from './ProjectFormModal';
import Gantt from '../../components/Gantt';
import { formatDate, formatMoney, formatMoneyCents } from '../../utils/format';

/** Overview tab: project info, timeline, quick stats and lifecycle actions. */
export default function OverviewTab({ project, timeline, isAdmin, canManage, canSeeBudget, onChanged }) {
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const budget = useFetch(() => (canSeeBudget ? projectsApi.budget(project.id) : Promise.resolve(null)), [project.id, canSeeBudget, project.updated_at]);

  const milestones = timeline.milestones.filter((m) => m.status !== 'cancelled');
  const done = milestones.filter((m) => m.status === 'completed').length;
  const percent = milestones.length ? Math.round((done / milestones.length) * 100) : 0;
  const editable = canManage && !project.is_archived;

  const lifecycle = {
    complete: { title: 'Complete project', message: 'Mark this project as completed? Scheduling will close and future assignments stop accruing cost.', run: () => projectsApi.setStatus(project.id, 'completed'), label: 'Complete' },
    abandon: { title: 'Abandon project', message: 'Mark this project as abandoned? Scheduling will close and future assignments stop accruing cost. History is kept.', run: () => projectsApi.setStatus(project.id, 'abandoned'), label: 'Abandon' },
    archive: { title: 'Archive project', message: 'Archive this project? It becomes read-only. You can restore it later.', run: () => projectsApi.archive(project.id), label: 'Archive' },
    restore: { title: 'Restore project', message: 'Restore this archived project?', run: () => projectsApi.restore(project.id), label: 'Restore' },
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        {editable && <Button onClick={() => setEditing(true)}>Edit Project</Button>}
        {editable && project.status === 'active' && (
          <>
            <Button variant="secondary" onClick={() => setConfirm('complete')}>Mark completed</Button>
            <Button variant="secondary" onClick={() => setConfirm('abandon')}>Abandon</Button>
          </>
        )}
        {isAdmin && !project.is_archived && <Button variant="secondary" onClick={() => setConfirm('archive')}>Archive</Button>}
        {isAdmin && project.is_archived && <Button onClick={() => setConfirm('restore')}>Restore</Button>}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Project information" className="lg:col-span-2">
          <p className="text-sm text-slate-700">{project.description || 'No description provided.'}</p>
          <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-3">
            <div><dt className="text-slate-500">Start date</dt><dd className="font-medium">{formatDate(project.start_date)}</dd></div>
            <div><dt className="text-slate-500">Estimated end</dt><dd className="font-medium">{formatDate(project.estimated_end_date)}</dd></div>
            <div><dt className="text-slate-500">Status</dt><dd><StatusBadge status={project.is_archived ? 'archived' : project.status} /></dd></div>
          </dl>
        </Card>
        <Card title="Quick stats">
          <div className="space-y-3 text-sm">
            <div>
              <div className="mb-1 flex justify-between"><span className="text-slate-500">Milestones</span><span>{done}/{milestones.length}</span></div>
              <ProgressBar percent={percent} tone="green" />
            </div>
            {canSeeBudget && (
              <Async state={budget}>
                {(b) => b && (
                  <>
                    <div className="flex justify-between"><span className="text-slate-500">Budget</span><span>{formatMoney(b.estimated_budget)}</span></div>
                    <div className="flex justify-between"><span className="text-slate-500">Expected cost</span><span>{formatMoneyCents(b.total_expected_cost)}</span></div>
                    <div className="flex justify-between"><span className="text-slate-500">Health</span><StatusBadge status={b.health} /></div>
                  </>
                )}
              </Async>
            )}
          </div>
        </Card>
      </div>

      <Card title="Timeline">
        {milestones.length ? <Gantt milestones={milestones} today={timeline.today} /> : <p className="text-sm text-slate-500">No milestones yet.</p>}
      </Card>

      {editing && <ProjectFormModal project={project} isAdmin={isAdmin} onClose={(changed) => { setEditing(false); if (changed) onChanged(); }} />}
      {confirm && (
        <ConfirmDialog
          title={lifecycle[confirm].title}
          message={lifecycle[confirm].message}
          confirmLabel={lifecycle[confirm].label}
          danger={confirm !== 'restore'}
          onConfirm={lifecycle[confirm].run}
          onClose={(changed) => { setConfirm(null); if (changed) onChanged(); }}
        />
      )}
    </div>
  );
}

OverviewTab.propTypes = {
  project: PropTypes.object.isRequired,
  timeline: PropTypes.object.isRequired,
  isAdmin: PropTypes.bool.isRequired,
  canManage: PropTypes.bool.isRequired,
  canSeeBudget: PropTypes.bool.isRequired,
  onChanged: PropTypes.func.isRequired,
};
