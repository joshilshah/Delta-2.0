import { useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { Alert, Spinner } from './ui.jsx';

const G = (
  <svg viewBox="0 0 48 48" className="h-5 w-5" aria-hidden>
    <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.5 17.7 9.5 24 9.5z" />
    <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v8.5h12.7c-.6 3-2.3 5.5-4.8 7.2l7.6 5.9c4.5-4.2 7-10.3 7-17.1z" />
    <path fill="#FBBC05" d="M10.5 28.7a14.5 14.5 0 0 1 0-9.4l-7.9-6.1a24 24 0 0 0 0 21.6l7.9-6.1z" />
    <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.6-5.9c-2.1 1.4-4.9 2.3-8.3 2.3-6.3 0-11.6-4-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z" />
  </svg>
);

/** "Continue with Google" for both login and signup (new Google users finish setup after returning). */
export default function GoogleButton({ label = 'Continue with Google', rememberRole }) {
  const { signInWithGoogle, configured } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function go() {
    setBusy(true);
    setError(null);
    try { if (rememberRole) localStorage.setItem('delta.onboard.role', rememberRole); } catch { /* storage unavailable */ }
    const { error: err } = await signInWithGoogle();
    if (err) {
      setBusy(false);
      setError(/provider is not enabled|Unsupported provider/i.test(err.message)
        ? 'Google sign-in isn’t switched on for this project yet. Enable the Google provider in Supabase (see README, “Google sign-in”).'
        : err.message);
    }
    // On success the browser is redirected to Google, so there is nothing more to do here.
  }

  return (
    <div className="space-y-3">
      <button type="button" onClick={go} disabled={busy || !configured}
        className="inline-flex w-full items-center justify-center gap-3 rounded-full bg-surface px-5 py-3.5 text-sm font-semibold text-fg ring-1 ring-line transition hover:bg-surface-2 active:scale-[0.98] disabled:opacity-60">
        {busy ? <Spinner /> : G} {label}
      </button>
      {error && <Alert tone="warn">{error}</Alert>}
    </div>
  );
}

export function OrDivider() {
  return (
    <div className="flex items-center gap-3 text-xs font-semibold uppercase tracking-wider text-muted" role="separator">
      <span className="h-px flex-1 bg-line" />or<span className="h-px flex-1 bg-line" />
    </div>
  );
}
