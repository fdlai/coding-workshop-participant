import { useState } from 'react';
import PropTypes from 'prop-types';
import useFetch from '../../hooks/useFetch';
import { assignmentsApi, scheduleApi } from '../../services/endpoints';
import { Alert, LoadingState } from '../../components/ui/Feedback';
import { Field, FormModal, SelectInput, TextInput } from '../../components/ui/Controls';
import { Avatar } from '../../components/ui/Display';
import { formatDate, fullName } from '../../utils/format';

/** Assign an employee to a milestone, showing who is free for the chosen dates. */
export function AssignModal({ project, milestones, isAdmin, initialMilestoneId, onClose }) {
  const open = milestones.filter((m) => m.status === 'pending');
  const first = open.find((m) => m.id === initialMilestoneId) || open[0];
  const [milestoneId, setMilestoneId] = useState(first ? String(first.id) : '');
  const milestone = open.find((m) => m.id === Number(milestoneId));
  const [start, setStart] = useState(first?.start_date || '');
  const [end, setEnd] = useState(first?.end_date || '');
  const [employeeId, setEmployeeId] = useState(null);
  const validRange = Boolean(start && end && end >= start);
  const availability = useFetch(
    () => (validRange
      ? scheduleApi.availability({ start, end, project_id: project.id, manager_id: isAdmin ? project.manager_id : undefined })
      : Promise.resolve([])),
    [start, end, project.id, project.manager_id, isAdmin],
  );
  const people = availability.loading ? null : availability.data;
  const loadError = availability.error?.message || '';

  function pickMilestone(event) {
    const chosen = open.find((m) => m.id === Number(event.target.value));
    setMilestoneId(event.target.value);
    if (chosen) {
      setStart(chosen.start_date);
      setEnd(chosen.end_date);
    }
  }

  async function submit() {
    if (!employeeId) throw new Error('Select an employee to assign');
    await assignmentsApi.create(Number(milestoneId), { employee_id: employeeId, start_date: start, planned_end_date: end });
  }

  return (
    <FormModal title="Assign employee" onClose={onClose} onSubmit={submit} submitLabel="Assign" wide>
      <Field label="Milestone" htmlFor="a-ms">
        <SelectInput id="a-ms" value={milestoneId} onChange={pickMilestone} required>
          {open.map((m) => <option key={m.id} value={m.id}>{m.name} ({formatDate(m.start_date)} – {formatDate(m.end_date)})</option>)}
        </SelectInput>
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Start date" htmlFor="a-start"><TextInput id="a-start" type="date" required min={milestone?.start_date} max={milestone?.end_date} value={start} onChange={(e) => setStart(e.target.value)} /></Field>
        <Field label="End date" htmlFor="a-end"><TextInput id="a-end" type="date" required min={start} max={milestone?.end_date} value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
      </div>
      <fieldset>
        <legend className="mb-1 text-sm font-medium text-slate-700">Employees on this team</legend>
        <Alert>{loadError}</Alert>
        {!people && !loadError && <LoadingState label="Checking availability…" />}
        {people && people.length === 0 && <p className="text-sm text-slate-500">No team members found for this project&apos;s manager.</p>}
        {people && (
          <ul className="max-h-60 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
            {people.map(({ employee, is_available: available, busy }) => (
              <li key={employee.id}>
                <label className={`flex items-center gap-3 px-3 py-2 text-sm ${available ? 'cursor-pointer hover:bg-slate-50' : 'cursor-not-allowed bg-slate-50 text-slate-400'}`}>
                  <input type="radio" name="employee" disabled={!available} checked={employeeId === employee.id} onChange={() => setEmployeeId(employee.id)} />
                  <Avatar person={employee} size="sm" />
                  <span className="flex-1">{fullName(employee)}</span>
                  <span className="text-xs">
                    {available ? 'Available' : `Busy: ${busy.map((b) => `${formatDate(b.start_date)}–${formatDate(b.end_date)}`).join(', ')}`}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </fieldset>
    </FormModal>
  );
}
AssignModal.propTypes = {
  project: PropTypes.object.isRequired,
  milestones: PropTypes.arrayOf(PropTypes.object).isRequired,
  isAdmin: PropTypes.bool.isRequired,
  initialMilestoneId: PropTypes.number,
  onClose: PropTypes.func.isRequired,
};

/** Change an assignment's start/planned end date. */
export function EditAssignmentModal({ assignment, onClose }) {
  const [start, setStart] = useState(assignment.start_date);
  const [end, setEnd] = useState(assignment.planned_end_date);
  const submit = () => assignmentsApi.update(assignment.id, { start_date: start, planned_end_date: end });
  return (
    <FormModal title={`Edit assignment – ${fullName(assignment.employee)}`} onClose={onClose} onSubmit={submit}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Start date" htmlFor="e-start"><TextInput id="e-start" type="date" required value={start} onChange={(e) => setStart(e.target.value)} /></Field>
        <Field label="Planned end" htmlFor="e-end"><TextInput id="e-end" type="date" required min={start} value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
      </div>
    </FormModal>
  );
}
EditAssignmentModal.propTypes = {
  assignment: PropTypes.object.isRequired,
  onClose: PropTypes.func.isRequired,
};

/** Atomically move an assignment to another milestone (old one ends today, new one begins). */
export function TransferModal({ assignment, milestones, onClose }) {
  const targets = milestones.filter((m) => m.status === 'pending' && m.id !== assignment.milestone_id);
  const [target, setTarget] = useState(targets[0] ? String(targets[0].id) : '');
  const submit = () => {
    if (!target) throw new Error('Select a destination milestone');
    return assignmentsApi.transfer(assignment.id, { target_milestone_id: Number(target) });
  };
  return (
    <FormModal title={`Transfer ${fullName(assignment.employee)}`} onClose={onClose} onSubmit={submit} submitLabel="Transfer">
      {targets.length === 0 ? (
        <p className="text-sm text-slate-500">There is no other open milestone to transfer to.</p>
      ) : (
        <Field label="Destination milestone" htmlFor="t-ms" hint="The current assignment ends today and a new one is created on the destination milestone in one step.">
          <SelectInput id="t-ms" value={target} onChange={(e) => setTarget(e.target.value)}>
            {targets.map((m) => <option key={m.id} value={m.id}>{m.name} ({formatDate(m.start_date)} – {formatDate(m.end_date)})</option>)}
          </SelectInput>
        </Field>
      )}
    </FormModal>
  );
}
TransferModal.propTypes = {
  assignment: PropTypes.object.isRequired,
  milestones: PropTypes.arrayOf(PropTypes.object).isRequired,
  onClose: PropTypes.func.isRequired,
};
