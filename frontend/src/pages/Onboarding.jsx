import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import AuthFrame from '../components/AuthFrame.jsx';
import RolePicker from '../components/RolePicker.jsx';
import { Alert, FullPageSpinner, Spinner } from '../components/ui.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { api } from '../services/api.js';

const savedRole = () => { try { return localStorage.getItem('delta.onboard.role') === 'driver' ? 'driver' : 'passenger'; } catch { return 'passenger'; } };

/** One-time setup after signing in with Google: pick a role, add a phone number (and vehicle for drivers). */
export default function Onboarding() {
  const { session, me, loading, refresh, signOut } = useAuth();
  const [form, setForm] = useState({ role: savedRole(), phone: '', vehicle_model: '', vehicle_registration: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  if (loading) return <FullPageSpinner />;
  if (!session) return <Navigate to="/login" replace />;
  if (me && !me.profile.needs_onboarding) return <Navigate to={`/${me.user.role}/dashboard`} replace />;
  if (!me) return <FullPageSpinner />;

  const isDriver = form.role === 'driver';

  async function submit(e) {
    e.preventDefault();
    if (!/^\+?[\d\s()-]{7,20}$/.test(form.phone.trim())) return setError('Enter a valid phone number (7–20 digits).');
    if (isDriver && (!form.vehicle_model.trim() || !form.vehicle_registration.trim())) {
      return setError('Vehicle model and registration number are required for drivers.');
    }
    setBusy(true);
    setError(null);
    try {
      await api.completeOnboarding({
        role: form.role, phone: form.phone.trim(),
        ...(isDriver ? { vehicle_model: form.vehicle_model.trim(), vehicle_registration: form.vehicle_registration.trim().toUpperCase() } : {}),
      });
      await refresh(); // the redirect above then sends them to the right dashboard
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <AuthFrame title="One last" accent="step." sub="Google told us who you are. Tell us how you’ll use Delta and how your driver or passenger can reach you.">
      <form onSubmit={submit} className="space-y-5">
        <div>
          <h1 className="text-[40px] font-semibold leading-tight">Almost <span className="serif text-accent">there</span></h1>
          <p className="mt-2 text-sm text-muted">Signed in as <strong className="text-fg">{me.profile.email}</strong>. Your role is fixed once you continue.</p>
        </div>
        {error && <Alert>{error}</Alert>}

        <RolePicker value={form.role} onChange={(role) => setForm({ ...form, role })} />

        <div><label className="label" htmlFor="phone">Phone number</label>
          <input id="phone" type="tel" required className="input" autoComplete="tel" placeholder="+91 …" value={form.phone} onChange={set('phone')} />
          <p className="mt-1 text-xs text-muted">Shared only with your matched driver or passenger while a ride is active.</p></div>

        {isDriver && (
          <div className="animate-rise space-y-5 rounded-3xl bg-surface-2 p-4 ring-1 ring-line">
            <Alert tone="warn">Demo only: drivers are <strong>not verified</strong>. There is no licence or vehicle checking.</Alert>
            <div><label className="label" htmlFor="vm">Vehicle model</label><input id="vm" className="input" placeholder="e.g. Maruti Swift Dzire" value={form.vehicle_model} onChange={set('vehicle_model')} /></div>
            <div><label className="label" htmlFor="vr">Registration number</label><input id="vr" className="input mono" placeholder="KA01 AB 1234" value={form.vehicle_registration} onChange={set('vehicle_registration')} /></div>
          </div>
        )}

        <button className="btn-primary btn-lg w-full" disabled={busy}>{busy && <Spinner />} Continue</button>
        <button type="button" onClick={signOut} className="text-sm text-muted underline underline-offset-4 hover:text-fg">Use a different account</button>
      </form>
    </AuthFrame>
  );
}
