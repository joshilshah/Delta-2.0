import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { supabase, supabaseConfigured } from '../lib/supabase.js';
import { api } from '../services/api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [me, setMe] = useState(null); // { user, profile, driver, active_ride_id }
  const [loading, setLoading] = useState(supabaseConfigured);
  const [error, setError] = useState(null);

  const loadMe = useCallback(async () => {
    try {
      setMe(await api.me());
      setError(null);
    } catch (e) {
      setMe(null);
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    if (!supabase) return undefined;
    let active = true;
    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return;
      setSession(data.session);
      if (data.session) await loadMe();
      if (active) setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, next) => {
      setSession(next);
      if (!next) setMe(null);
      // Defer: never await Supabase calls inside this callback.
      else if (event === 'SIGNED_IN') setTimeout(loadMe, 0);
    });
    return () => { active = false; sub.subscription.unsubscribe(); };
  }, [loadMe]);

  const signIn = (email, password) => supabase.auth.signInWithPassword({ email, password });

  const signUp = ({ email, password, full_name, phone, role, vehicle_model, vehicle_registration }) =>
    supabase.auth.signUp({
      email, password,
      options: { data: { full_name, phone, role, ...(role === 'driver' ? { vehicle_model, vehicle_registration } : {}) } },
    });

  // Google sign-in via Supabase OAuth (the provider must be enabled in the Supabase dashboard).
  // We return to /login, which forwards a signed-in user to their dashboard (or to account setup).
  const signInWithGoogle = () => supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: `${window.location.origin}/login` },
  });

  const signOut = async () => { await supabase.auth.signOut(); setMe(null); };

  const value = useMemo(
    () => ({ session, me, role: me?.user.role ?? null, loading, error, configured: supabaseConfigured,
             signIn, signUp, signInWithGoogle, signOut, refresh: loadMe }),
    [session, me, loading, error, loadMe],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
