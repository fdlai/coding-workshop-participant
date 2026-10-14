import { useState } from 'react';
import PropTypes from 'prop-types';
import useFetch from '../../hooks/useFetch';
import { usersApi, workTermsApi } from '../../services/endpoints';
import { Async, EmptyState } from '../../components/ui/Feedback';
import { Card, PageHeader } from '../../components/ui/Display';
import { Button, DataTable, Field, FormModal, SelectInput, TextInput } from '../../components/ui/Controls';
import { formatDate, formatMoneyCents, fullName, todayIso } from '../../utils/format';

/** Bars showing the hourly rate at each effective date (oldest → newest). */
function RateHistory({ terms }) {
  const ordered = [...terms].sort((a, b) => a.effective_from.localeCompare(b.effective_from));
  const max = Math.max(...ordered.map((t) => Number(t.hourly_rate)), 1);
  return (
    <div className="flex h-40 items-end gap-3" role="img" aria-label="Hourly rate history">
      {ordered.map((t) => (
        <div key={t.id} className="flex flex-1 flex-col items-center justify-end gap-1">
          <span className="text-xs font-medium text-slate-700">{formatMoneyCents(t.hourly_rate)}</span>
          <div className="w-full max-w-16 rounded-t bg-indigo-500" style={{ height: `${(Number(t.hourly_rate) / max) * 100}px` }} />
          <span className="text-xs text-slate-500">{formatDate(t.effective_from)}</span>
        </div>
      ))}
    </div>
  );
}
RateHistory.propTypes = { terms: PropTypes.arrayOf(PropTypes.object).isRequired };

function AddTermsModal({ employee, onClose }) {
  const [form, setForm] = useState({ hourly_rate: '', weekly_hours: '40', effective_from: todayIso() });
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const submit = () => workTermsApi.create(employee.id, {
    hourly_rate: String(form.hourly_rate),
    weekly_hours: String(form.weekly_hours),
    effective_from: form.effective_from,
  });
  return (
    <FormModal title={`Add work terms – ${fullName(employee)}`} onClose={onClose} onSubmit={submit}>
      <p className="text-sm text-slate-500">Terms are append-only history. A new record applies from its effective date forward. Dates in the past are rejected if they would change costs already accrued.</p>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Hourly rate" htmlFor="w-rate"><TextInput id="w-rate" type="number" min="0" step="0.01" required value={form.hourly_rate} onChange={set('hourly_rate')} /></Field>
        <Field label="Weekly hours" htmlFor="w-hours"><TextInput id="w-hours" type="number" min="0" max="168" step="0.5" required value={form.weekly_hours} onChange={set('weekly_hours')} /></Field>
        <Field label="Effective from" htmlFor="w-date"><TextInput id="w-date" type="date" required value={form.effective_from} onChange={set('effective_from')} /></Field>
      </div>
    </FormModal>
  );
}
AddTermsModal.propTypes = { employee: PropTypes.object.isRequired, onClose: PropTypes.func.isRequired };

/** Admin-only compensation management for one employee at a time. */
export default function CompensationPage() {
  const employees = useFetch(() => usersApi.list({ role: 'employee' }));
  const [employeeId, setEmployeeId] = useState('');
  const [adding, setAdding] = useState(false);
  const employee = (employees.data || []).find((e) => e.id === Number(employeeId));
  const terms = useFetch(() => (employee ? workTermsApi.list(employee.id) : Promise.resolve(null)), [employeeId]);

  return (
    <>
      <PageHeader title="Compensation" subtitle="Effective-dated hourly rates and weekly hours" />
      <Async state={employees}>
        {(list) => (
          <>
            <div className="mb-4 max-w-sm">
              <Field label="Employee" htmlFor="c-emp">
                <SelectInput id="c-emp" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
                  <option value="">Select an employee…</option>
                  {list.map((e) => <option key={e.id} value={e.id}>{fullName(e)}</option>)}
                </SelectInput>
              </Field>
            </div>
            {!employee ? (
              <EmptyState title="Select an employee" message="Choose an employee to view and manage their work terms." />
            ) : (
              <Async state={terms}>
                {(rows) => (
                  <div className="space-y-6">
                    <Card title="Work terms" actions={<Button size="sm" onClick={() => setAdding(true)}>+ Add Work Term</Button>}>
                      {rows.length === 0 ? (
                        <EmptyState title="No work terms yet" message="This employee cannot be scheduled until work terms exist." />
                      ) : (
                        <DataTable
                          rows={rows}
                          columns={[
                            { key: 'effective_from', header: 'Effective from', render: (t) => formatDate(t.effective_from) },
                            { key: 'hourly_rate', header: 'Hourly rate', render: (t) => formatMoneyCents(t.hourly_rate) },
                            { key: 'weekly_hours', header: 'Weekly hours' },
                            { key: 'daily_cost', header: 'Daily cost', render: (t) => formatMoneyCents(t.daily_cost) },
                          ]}
                        />
                      )}
                    </Card>
                    {rows.length > 0 && <Card title="Rate history"><RateHistory terms={rows} /></Card>}
                  </div>
                )}
              </Async>
            )}
          </>
        )}
      </Async>
      {adding && employee && <AddTermsModal employee={employee} onClose={(changed) => { setAdding(false); if (changed) terms.reload(); }} />}
    </>
  );
}
