import { useState } from 'react';
import PropTypes from 'prop-types';
import useFetch from '../../hooks/useFetch';
import { relationshipsApi, usersApi } from '../../services/endpoints';
import { Async, EmptyState } from '../../components/ui/Feedback';
import { Avatar, Card, PageHeader } from '../../components/ui/Display';
import { Button, ConfirmDialog, Field, FormModal, SelectInput } from '../../components/ui/Controls';
import { fullName } from '../../utils/format';

function AddEmployeeModal({ managerId, team, onClose }) {
  const employees = useFetch(() => usersApi.list({ role: 'employee', is_active: true }));
  const [employeeId, setEmployeeId] = useState('');
  const inTeam = new Set(team.map((e) => e.id));
  const choices = (employees.data || []).filter((e) => !inTeam.has(e.id));

  const submit = () => {
    if (!employeeId) throw new Error('Select an employee');
    return relationshipsApi.add(managerId, Number(employeeId));
  };

  return (
    <FormModal title="Add employee to team" onClose={onClose} onSubmit={submit} submitLabel="Add">
      <Field label="Employee" htmlFor="o-emp" hint="Employees can report to more than one manager.">
        <SelectInput id="o-emp" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
          <option value="">Select an employee…</option>
          {choices.map((e) => <option key={e.id} value={e.id}>{fullName(e)}</option>)}
        </SelectInput>
      </Field>
    </FormModal>
  );
}
AddEmployeeModal.propTypes = {
  managerId: PropTypes.number.isRequired,
  team: PropTypes.arrayOf(PropTypes.object).isRequired,
  onClose: PropTypes.func.isRequired,
};

/** Admin view of manager ↔ employee relationships. */
export default function OrganizationPage() {
  const managers = useFetch(() => usersApi.list({ role: 'manager' }));
  const [selected, setSelected] = useState(null);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState(null);
  const managerId = selected ?? managers.data?.[0]?.id ?? null;
  const team = useFetch(() => (managerId ? relationshipsApi.employeesOf(managerId) : Promise.resolve([])), [managerId]);

  return (
    <>
      <PageHeader title="Organization" subtitle="Manager and employee relationships" />
      <Async state={managers}>
        {(list) => (list.length === 0 ? (
          <EmptyState title="No managers yet" message="Create a user with the manager role first." />
        ) : (
          <div className="grid gap-6 lg:grid-cols-3">
            <Card title="Managers">
              <ul className="space-y-1">
                {list.map((m) => (
                  <li key={m.id}>
                    <button
                      type="button"
                      onClick={() => setSelected(m.id)}
                      className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm ${m.id === managerId ? 'bg-indigo-50 text-indigo-800' : 'hover:bg-slate-50'}`}
                    >
                      <Avatar person={m} size="sm" />
                      <span>{fullName(m)}{!m.is_active && ' (inactive)'}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
            <Card
              title={`Team of ${fullName(list.find((m) => m.id === managerId))}`}
              className="lg:col-span-2"
              actions={<Button size="sm" onClick={() => setAdding(true)}>+ Add Employee</Button>}
            >
              <Async state={team}>
                {(members) => (members.length === 0 ? (
                  <EmptyState title="No employees assigned to this manager" />
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {members.map((e) => (
                      <li key={e.id} className="flex items-center justify-between gap-3 py-3 text-sm">
                        <span className="flex items-center gap-3">
                          <Avatar person={e} />
                          <span>
                            <span className="block font-medium text-slate-800">{fullName(e)}</span>
                            <span className="text-xs text-slate-500">{e.job_title || 'Employee'}</span>
                          </span>
                        </span>
                        <Button variant="ghost" size="sm" onClick={() => setRemoving(e)}>Remove</Button>
                      </li>
                    ))}
                  </ul>
                ))}
              </Async>
            </Card>
          </div>
        ))}
      </Async>

      {adding && <AddEmployeeModal managerId={managerId} team={team.data || []} onClose={(changed) => { setAdding(false); if (changed) team.reload(); }} />}
      {removing && (
        <ConfirmDialog
          title="Remove from team"
          message={`Remove ${fullName(removing)} from this manager's team? Their current and future assignments on this manager's projects will be ended; past history is preserved.`}
          confirmLabel="Remove"
          onConfirm={() => relationshipsApi.remove(managerId, removing.id)}
          onClose={(changed) => { setRemoving(null); if (changed) team.reload(); }}
        />
      )}
    </>
  );
}
