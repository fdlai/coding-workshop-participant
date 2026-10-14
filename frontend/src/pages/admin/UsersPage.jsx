import { useState } from 'react';
import PropTypes from 'prop-types';
import useFetch from '../../hooks/useFetch';
import { usersApi } from '../../services/endpoints';
import { Async, EmptyState } from '../../components/ui/Feedback';
import { Avatar, PageHeader, StatusBadge } from '../../components/ui/Display';
import { Button, ConfirmDialog, DataTable, Field, FilterBar, FormModal, Pagination, SelectInput, TextInput } from '../../components/ui/Controls';
import { fullName } from '../../utils/format';

const PAGE_SIZE = 10;

function UserFormModal({ user, onClose }) {
  const editing = Boolean(user);
  const [form, setForm] = useState({
    username: user?.username || '',
    email: user?.email || '',
    first_name: user?.first_name || '',
    last_name: user?.last_name || '',
    job_title: user?.job_title || '',
    role: user?.role || 'employee',
    password: '',
  });
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  async function submit() {
    const common = {
      email: form.email.trim(),
      first_name: form.first_name.trim(),
      last_name: form.last_name.trim(),
      job_title: form.job_title.trim() || null,
    };
    if (editing) await usersApi.update(user.id, common);
    else await usersApi.create({ ...common, username: form.username.trim(), role: form.role, password: form.password });
  }

  return (
    <FormModal title={editing ? `Edit ${fullName(user)}` : 'Add user'} onClose={onClose} onSubmit={submit} wide>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="First name" htmlFor="u-first"><TextInput id="u-first" required maxLength={100} value={form.first_name} onChange={set('first_name')} /></Field>
        <Field label="Last name" htmlFor="u-last"><TextInput id="u-last" required maxLength={100} value={form.last_name} onChange={set('last_name')} /></Field>
        {!editing && <Field label="Username" htmlFor="u-user"><TextInput id="u-user" required autoComplete="off" value={form.username} onChange={set('username')} /></Field>}
        <Field label="Email" htmlFor="u-email"><TextInput id="u-email" type="email" required value={form.email} onChange={set('email')} /></Field>
        <Field label="Job title" htmlFor="u-title"><TextInput id="u-title" maxLength={150} value={form.job_title} onChange={set('job_title')} /></Field>
        {!editing && (
          <Field label="Role" htmlFor="u-role">
            <SelectInput id="u-role" value={form.role} onChange={set('role')}>
              <option value="employee">Employee</option>
              <option value="manager">Manager</option>
              <option value="admin">Admin</option>
            </SelectInput>
          </Field>
        )}
        {!editing && (
          <Field label="Initial password" htmlFor="u-pass" hint="At least 8 characters.">
            <TextInput id="u-pass" type="password" required minLength={8} autoComplete="new-password" value={form.password} onChange={set('password')} />
          </Field>
        )}
      </div>
    </FormModal>
  );
}
UserFormModal.propTypes = { user: PropTypes.object, onClose: PropTypes.func.isRequired };

function RoleModal({ user, onClose }) {
  const [role, setRole] = useState(user.role);
  return (
    <FormModal title={`Change role – ${fullName(user)}`} onClose={onClose} onSubmit={() => usersApi.setRole(user.id, role)}>
      <Field label="Role" htmlFor="r-role" hint="Role changes are blocked if they would orphan existing reporting relationships or projects.">
        <SelectInput id="r-role" value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="employee">Employee</option>
          <option value="manager">Manager</option>
          <option value="admin">Admin</option>
        </SelectInput>
      </Field>
    </FormModal>
  );
}
RoleModal.propTypes = { user: PropTypes.object.isRequired, onClose: PropTypes.func.isRequired };

function ResetPasswordModal({ user, onClose }) {
  const [password, setPassword] = useState('');
  return (
    <FormModal title={`Reset password – ${fullName(user)}`} onClose={onClose} onSubmit={() => usersApi.resetPassword(user.id, password)} submitLabel="Reset password">
      <Field label="New password" htmlFor="rp-pass" hint="At least 8 characters. Share it with the user securely.">
        <TextInput id="rp-pass" type="password" required minLength={8} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
    </FormModal>
  );
}
ResetPasswordModal.propTypes = { user: PropTypes.object.isRequired, onClose: PropTypes.func.isRequired };

/** Admin user management: filter, create, edit, change role, (de)activate, reset password. */
export default function UsersPage() {
  const [role, setRole] = useState('');
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const [modal, setModal] = useState(null); // {type, user?}
  const users = useFetch(() => usersApi.list({ role, is_active: status, search }), [role, status, search]);

  function close(changed) {
    setModal(null);
    if (changed) users.reload();
  }

  const columns = [
    { key: 'name', header: 'Name', render: (u) => <span className="flex items-center gap-2"><Avatar person={u} size="sm" /><span className="font-medium text-slate-900">{fullName(u)}</span></span> },
    { key: 'username', header: 'Username' },
    { key: 'email', header: 'Email' },
    { key: 'role', header: 'Role', render: (u) => <StatusBadge status={u.role} /> },
    { key: 'is_active', header: 'Status', render: (u) => <StatusBadge status={u.is_active ? 'active' : 'inactive'} /> },
    {
      key: 'actions',
      header: 'Actions',
      render: (u) => (
        <div className="flex flex-wrap gap-1">
          <Button variant="ghost" size="sm" onClick={() => setModal({ type: 'edit', user: u })}>Edit</Button>
          <Button variant="ghost" size="sm" onClick={() => setModal({ type: 'role', user: u })}>Role</Button>
          <Button variant="ghost" size="sm" onClick={() => setModal({ type: 'status', user: u })}>{u.is_active ? 'Deactivate' : 'Activate'}</Button>
          <Button variant="ghost" size="sm" onClick={() => setModal({ type: 'reset', user: u })}>Reset password</Button>
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader title="People" subtitle="Manage accounts, roles and access" actions={<Button onClick={() => setModal({ type: 'create' })}>+ Add User</Button>} />
      <FilterBar>
        <div className="w-full sm:w-64"><TextInput placeholder="Search name, username or email…" aria-label="Search users" value={search} onChange={(e) => { setSearch(e.target.value); setOffset(0); }} /></div>
        <div className="w-40">
          <SelectInput aria-label="Filter by role" value={role} onChange={(e) => { setRole(e.target.value); setOffset(0); }}>
            <option value="">All roles</option>
            <option value="admin">Admins</option>
            <option value="manager">Managers</option>
            <option value="employee">Employees</option>
          </SelectInput>
        </div>
        <div className="w-40">
          <SelectInput aria-label="Filter by status" value={status} onChange={(e) => { setStatus(e.target.value); setOffset(0); }}>
            <option value="">Any status</option>
            <option value="true">Active</option>
            <option value="false">Inactive</option>
          </SelectInput>
        </div>
      </FilterBar>

      <Async state={users}>
        {(rows) => (rows.length === 0 ? (
          <EmptyState title="No users match these filters" />
        ) : (
          <>
            <DataTable columns={columns} rows={rows.slice(offset, offset + PAGE_SIZE)} />
            <Pagination offset={offset} limit={PAGE_SIZE} total={rows.length} onChange={setOffset} />
          </>
        ))}
      </Async>

      {modal?.type === 'create' && <UserFormModal onClose={close} />}
      {modal?.type === 'edit' && <UserFormModal user={modal.user} onClose={close} />}
      {modal?.type === 'role' && <RoleModal user={modal.user} onClose={close} />}
      {modal?.type === 'reset' && <ResetPasswordModal user={modal.user} onClose={close} />}
      {modal?.type === 'status' && (
        <ConfirmDialog
          title={modal.user.is_active ? 'Deactivate user' : 'Activate user'}
          message={modal.user.is_active
            ? `Deactivate ${fullName(modal.user)}? They can no longer sign in or receive new assignments. Existing history is preserved.`
            : `Reactivate ${fullName(modal.user)}?`}
          confirmLabel={modal.user.is_active ? 'Deactivate' : 'Activate'}
          danger={modal.user.is_active}
          onConfirm={() => usersApi.setStatus(modal.user.id, !modal.user.is_active)}
          onClose={close}
        />
      )}
    </>
  );
}
