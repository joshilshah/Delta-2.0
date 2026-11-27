import { useState } from 'react';
import { Link } from 'react-router-dom';
import AuthFrame from '../components/AuthFrame.jsx';
import GoogleButton, { OrDivider } from '../components/GoogleButton.jsx';
import { Alert, PasswordInput, Spinner } from '../components/ui.jsx';
import { useAuth } from '../context/AuthContext.jsx';

export default function Login() {
  const { signIn, configured } = useAuth();
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error: err } = await signIn(form.email.trim(), form.password);
    if (err) { setError(err.message); setBusy(false); }
    // On success the auth listener loads the account and PublicOnly redirects to the right dashboard.
  }

  return (
    <AuthFrame>
      <form onSubmit={submit} className="space-y-5">
        <div><h1 className="text-[40px] font-semibold leading-tight">Welcome <span className="serif text-accent">back</span></h1><p className="mt-2 text-sm text-muted">Log in to book a ride or go online.</p></div>
        {!configured && <Alert tone="warn">Supabase is not configured. See the README.</Alert>}
        {error && <Alert>{error}</Alert>}
        <GoogleButton label="Log in with Google" />
        <OrDivider />
        <div><label className="label" htmlFor="email">Email</label>
          <input id="email" type="email" required autoComplete="email" className="input" value={form.email} onChange={set('email')} /></div>
        <div><label className="label" htmlFor="password">Password</label>
          <PasswordInput id="password" required autoComplete="current-password" value={form.password} onChange={set('password')} /></div>
        <button className="btn-primary btn-lg w-full" disabled={busy || !configured}>{busy && <Spinner />} Log in</button>
        <p className="text-sm text-muted">New to Delta? <Link to="/signup" className="font-semibold text-fg underline underline-offset-4">Create an account</Link></p>
      </form>
    </AuthFrame>
  );
}

