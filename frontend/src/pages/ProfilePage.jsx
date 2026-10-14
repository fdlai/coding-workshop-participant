import { useState } from 'react';
import PropTypes from 'prop-types';
import { useAuth } from '../context/AuthContext';
import { authApi } from '../services/endpoints';
import { Alert } from '../components/ui/Feedback';
import { Avatar, Card, PageHeader, StatusBadge } from '../components/ui/Display';
import { Button, Field, TextInput } from '../components/ui/Controls';
import { fullName } from '../utils/format';

function ProfileForm({ user, setUser }) {
  const [form, setForm] = useState({
    first_name: user.first_name,
    last_name: user.last_name,
    job_title: user.job_title || '',
    profile_picture_url: user.profile_picture_url || '',
  });
  const [message, setMessage] = useState(null);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  async function save(event) {
    event.preventDefault();
    setMessage(null);
    try {
      const updated = await authApi.updateProfile({
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        job_title: form.job_title.trim() || null,
        profile_picture_url: form.profile_picture_url.trim() || null,
      });
      setUser(updated);
      setMessage({ kind: 'success', text: 'Profile updated.' });
    } catch (err) {
      setMessage({ kind: 'error', text: err.message });
    }
  }

  return (
    <form onSubmit={save} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="First name" htmlFor="pf-first"><TextInput id="pf-first" required value={form.first_name} onChange={set('first_name')} /></Field>
        <Field label="Last name" htmlFor="pf-last"><TextInput id="pf-last" required value={form.last_name} onChange={set('last_name')} /></Field>
        <Field label="Job title" htmlFor="pf-title"><TextInput id="pf-title" value={form.job_title} onChange={set('job_title')} /></Field>
        <Field label="Profile picture URL" htmlFor="pf-pic"><TextInput id="pf-pic" type="url" placeholder="https://…" value={form.profile_picture_url} onChange={set('profile_picture_url')} /></Field>
        <Field label="Email" htmlFor="pf-email" hint="Contact an administrator to change your email."><TextInput id="pf-email" value={user.email} disabled readOnly /></Field>
      </div>
      {message && <Alert kind={message.kind}>{message.text}</Alert>}
      <Button type="submit">Save changes</Button>
    </form>
  );
}
ProfileForm.propTypes = { user: PropTypes.object.isRequired, setUser: PropTypes.func.isRequired };

function PasswordForm() {
  const [form, setForm] = useState({ current: '', next: '', confirm: '' });
  const [message, setMessage] = useState(null);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  async function save(event) {
    event.preventDefault();
    if (form.next !== form.confirm) {
      setMessage({ kind: 'error', text: 'New passwords do not match.' });
      return;
    }
    try {
      await authApi.changePassword(form.current, form.next);
      setForm({ current: '', next: '', confirm: '' });
      setMessage({ kind: 'success', text: 'Password changed.' });
    } catch (err) {
      setMessage({ kind: 'error', text: err.message });
    }
  }

  return (
    <form onSubmit={save} className="max-w-md space-y-4">
      <Field label="Current password" htmlFor="pw-cur"><TextInput id="pw-cur" type="password" required autoComplete="current-password" value={form.current} onChange={set('current')} /></Field>
      <Field label="New password" htmlFor="pw-new" hint="At least 8 characters."><TextInput id="pw-new" type="password" required minLength={8} autoComplete="new-password" value={form.next} onChange={set('next')} /></Field>
      <Field label="Confirm new password" htmlFor="pw-conf"><TextInput id="pw-conf" type="password" required minLength={8} autoComplete="new-password" value={form.confirm} onChange={set('confirm')} /></Field>
      {message && <Alert kind={message.kind}>{message.text}</Alert>}
      <Button type="submit">Change password</Button>
    </form>
  );
}

/** Own profile (limited fields) and password change — available to every role. */
export default function ProfilePage() {
  const { user, setUser } = useAuth();
  return (
    <>
      <PageHeader title="My Profile" />
      <div className="space-y-6">
        <Card>
          <div className="flex items-center gap-4">
            <Avatar person={user} size="lg" />
            <div>
              <p className="text-lg font-semibold text-slate-900">{fullName(user)}</p>
              <p className="text-sm text-slate-500">@{user.username}</p>
              <StatusBadge status={user.role} />
            </div>
          </div>
        </Card>
        <Card title="Personal information"><ProfileForm user={user} setUser={setUser} /></Card>
        <Card title="Change password"><PasswordForm /></Card>
      </div>
    </>
  );
}
