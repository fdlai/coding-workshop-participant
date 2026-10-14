import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { HOME_BY_ROLE } from '../utils/roles';
import { Alert } from '../components/ui/Feedback';
import { Button, Field, TextInput } from '../components/ui/Controls';

/** Sign-in page. After login, the user is redirected to their role's dashboard. */
export default function LoginPage() {
  const { user, login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to={HOME_BY_ROLE[user.role]} replace />;

  async function handleSubmit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await login(username.trim(), password);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="hidden flex-col justify-center bg-gradient-to-br from-indigo-700 to-indigo-900 p-12 text-white lg:flex">
        <span className="text-3xl font-extrabold tracking-tight">ACME</span>
        <h1 className="mt-8 text-4xl font-bold leading-tight">Resource management, simplified.</h1>
        <p className="mt-4 max-w-md text-indigo-100">
          Plan projects and milestones, schedule your team without conflicts, and keep every
          budget on track.
        </p>
      </div>

      <div className="flex items-center justify-center bg-slate-50 p-6">
        <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-5 rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
          <div>
            <h2 className="text-2xl font-bold text-slate-900">Welcome back</h2>
            <p className="mt-1 text-sm text-slate-500">Sign in to your ACME account</p>
          </div>

          <Field label="Username" htmlFor="username">
            <TextInput id="username" autoComplete="username" required value={username} onChange={(e) => setUsername(e.target.value)} />
          </Field>

          <Field label="Password" htmlFor="password">
            <div className="relative">
              <TextInput id="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
              <button type="button" onClick={() => setShowPassword((s) => !s)} className="absolute inset-y-0 right-3 text-xs font-medium text-indigo-600">
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
          </Field>

          <Alert>{error}</Alert>

          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
      </div>
    </div>
  );
}
