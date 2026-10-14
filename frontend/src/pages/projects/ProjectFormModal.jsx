import { useState } from 'react';
import PropTypes from 'prop-types';
import { projectsApi, usersApi } from '../../services/endpoints';
import useFetch from '../../hooks/useFetch';
import { Field, FormModal, SelectInput, TextArea, TextInput } from '../../components/ui/Controls';
import { fullName } from '../../utils/format';

/**
 * Create (no `project`) or edit (with `project`) a project.
 * Only admins can pick the manager, so the manager list is loaded for admins only.
 */
export default function ProjectFormModal({ project, isAdmin, onClose }) {
  const editing = Boolean(project);
  const managers = useFetch(() => (isAdmin ? usersApi.list({ role: 'manager', is_active: true }) : Promise.resolve([])), [isAdmin]);
  const [form, setForm] = useState({
    name: project?.name || '',
    description: project?.description || '',
    manager_id: project?.manager_id || '',
    start_date: project?.start_date || '',
    estimated_end_date: project?.estimated_end_date || '',
    estimated_budget: project?.estimated_budget ?? '',
  });
  const set = (key) => (event) => setForm((f) => ({ ...f, [key]: event.target.value }));

  async function submit() {
    const body = {
      name: form.name.trim(),
      description: form.description.trim() || null,
      start_date: form.start_date,
      estimated_end_date: form.estimated_end_date,
      estimated_budget: String(form.estimated_budget),
    };
    if (isAdmin) body.manager_id = Number(form.manager_id);
    if (editing) {
      await projectsApi.update(project.id, body);
    } else {
      await projectsApi.create(body);
    }
  }

  return (
    <FormModal title={editing ? 'Edit project' : 'New project'} onClose={onClose} onSubmit={submit} submitLabel={editing ? 'Save changes' : 'Create project'} wide>
      <Field label="Name" htmlFor="p-name"><TextInput id="p-name" required maxLength={200} value={form.name} onChange={set('name')} /></Field>
      <Field label="Description" htmlFor="p-desc"><TextArea id="p-desc" value={form.description} onChange={set('description')} /></Field>
      {isAdmin && (
        <Field label="Project manager" htmlFor="p-mgr">
          <SelectInput id="p-mgr" required value={form.manager_id} onChange={set('manager_id')}>
            <option value="">Select a manager…</option>
            {(managers.data || []).map((m) => <option key={m.id} value={m.id}>{fullName(m)}</option>)}
          </SelectInput>
        </Field>
      )}
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Start date" htmlFor="p-start"><TextInput id="p-start" type="date" required value={form.start_date} onChange={set('start_date')} /></Field>
        <Field label="Estimated end" htmlFor="p-end"><TextInput id="p-end" type="date" required value={form.estimated_end_date} onChange={set('estimated_end_date')} /></Field>
        <Field label="Budget (USD)" htmlFor="p-budget"><TextInput id="p-budget" type="number" min="0" step="0.01" required value={form.estimated_budget} onChange={set('estimated_budget')} /></Field>
      </div>
    </FormModal>
  );
}

ProjectFormModal.propTypes = {
  project: PropTypes.object,
  isAdmin: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
};
