import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import AuthFrame from '../components/AuthFrame.jsx';
import GoogleButton, { OrDivider } from '../components/GoogleButton.jsx';
import RolePicker from '../components/RolePicker.jsx';
import { Alert, PasswordInput, Spinner } from '../components/ui.jsx';
import { useAuth } from '../context/AuthContext.jsx';

export default function Signup() {
  const { signUp, configured } = useAuth();
  const [params] = useSearchParams();
  const [form, setForm] = useState({
    role: params.get('role') === 'driver' ? 'driver' : 'passenger',
    full_name: '', email: '', password: '', phone: '', vehicle_model: '', vehicle_registration: '',
  });
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const isDriver = form.role === 'driver';

  function validate() {
    if (form.full_name.trim().length < 2) return 'Please enter your full name.';
    if (form.password.length < 8) return 'Password must be at least 8 characters.';
    if (!/^\+?[\d\s()-]{7,20}$/.test(form.phone.trim())) return 'Enter a valid phone number (7–20 digits).';
    if (isDriver && (!form.vehicle_model.trim() || !form.vehicle_registration.trim())) {
      return 'Vehicle model and registration number are required for drivers.';
    }
    return null;
  }

  async function submit(e) {
    e.preventDefault();
    const problem = validate();
    if (problem) return setError(problem);
    setBusy(true);
    setError(null);
    const { data, error: err } = await signUp({
      ...form, email: form.email.trim(), full_name: form.full_name.trim(), phone: form.phone.trim(),
      vehicle_model: form.vehicle_model.trim(), vehicle_registration: form.vehicle_registration.trim().toUpperCase(),
    });
    setBusy(false);
    if (err) return setError(err.message);
    if (!data.session) setNotice('Account created. Check your email to confirm your address, then log in.');
  }

  return (
    <AuthFrame title="Ride it, or" accent="drive it." sub="One account, one role. Passengers book and track trips; drivers go online and accept requests nearby.">
      <form onSubmit={submit} className="space-y-5">
        <div><h1 className="text-[40px] font-semibold leading-tight">Join <span className="serif text-accent">Delta</span></h1><p className="mt-2 text-sm text-muted">Your role is fixed once the account is created.</p></div>
        {!configured && <Alert tone="warn">Supabase is not configured. See the README.</Alert>}
        {error && <Alert>{error}</Alert>}
        {notice && <Alert tone="success">{notice} <Link to="/login" className="font-semibold underline">Log in</Link></Alert>}

        <RolePicker value={form.role} onChange={(role) => setForm({ ...form, role })} />

        <GoogleButton label="Sign up with Google" rememberRole={form.role} />
        <OrDivider />
        <div><label className="label" htmlFor="name">Full name</label><input id="name" required className="input" autoComplete="name" value={form.full_name} onChange={set('full_name')} /></div>
        <div className="grid gap-5 sm:grid-cols-2">
          <div><label className="label" htmlFor="email">Email</label><input id="email" type="email" required className="input" autoComplete="email" value={form.email} onChange={set('email')} /></div>
          <div><label className="label" htmlFor="phone">Phone</label><input id="phone" type="tel" required className="input" autoComplete="tel" placeholder="+91 …" value={form.phone} onChange={set('phone')} /></div>
        </div>
        <div><label className="label" htmlFor="password">Password</label><PasswordInput id="password" required minLength={8} autoComplete="new-password" value={form.password} onChange={set('password')} />
          <p className="mt-1 text-xs text-muted">At least 8 characters.</p></div>

        {isDriver && (
          <div className="animate-rise space-y-5 rounded-3xl bg-surface-2 p-4 ring-1 ring-line">
            <Alert tone="warn">Demo only: drivers are <strong>not verified</strong>. There is no licence or vehicle checking.</Alert>
            <div><label className="label" htmlFor="vm">Vehicle model</label><input id="vm" className="input" placeholder="e.g. Maruti Swift Dzire" value={form.vehicle_model} onChange={set('vehicle_model')} /></div>
            <div><label className="label" htmlFor="vr">Registration number</label><input id="vr" className="input mono" placeholder="KA01 AB 1234" value={form.vehicle_registration} onChange={set('vehicle_registration')} /></div>
          </div>
        )}

        <button className="btn-primary btn-lg w-full" disabled={busy || !configured}>{busy && <Spinner />} Create account</button>
        <p className="text-sm text-muted">Already registered? <Link to="/login" className="font-semibold text-fg underline underline-offset-4">Log in</Link></p>
      </form>
    </AuthFrame>
  );
}
