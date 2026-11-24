import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useAuth } from './AuthContext.jsx';
import { useMediaQuery } from '../components/CanvasLayout.jsx';

const ThemeContext = createContext(null);

// Passengers start by following the system; drivers start dark (the night cockpit).
const defaults = (role) => ({ mode: role === 'driver' ? 'dark' : 'system', darkStyle: null });
const keyFor = (role) => `delta.theme.${role}`;
function read(role) {
  try { return { ...defaults(role), ...JSON.parse(localStorage.getItem(keyFor(role)) ?? '{}') }; } catch { return defaults(role); }
}
function write(role, prefs) { try { localStorage.setItem(keyFor(role), JSON.stringify(prefs)); } catch { /* storage unavailable */ } }

/**
 * Appearance: light / dark / system, plus the dark style (grey or AMOLED black).
 * Stored per role on this device, applied as classes on <html> so every page, overlay and map follows.
 */
export function ThemeProvider({ children }) {
  const { me } = useAuth();
  const role = me?.user.role ?? 'guest';
  const [state, setState] = useState(() => ({ role, prefs: read(role) }));
  // Switching account (or signing out) loads that role's preferences.
  if (state.role !== role) setState({ role, prefs: read(role) });
  const { prefs } = state;

  const systemDark = useMediaQuery('(prefers-color-scheme: dark)');
  const dark = prefs.mode === 'dark' || (prefs.mode === 'system' && systemDark);
  const amoled = dark && prefs.darkStyle === 'amoled';

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('theme-night', dark);
    root.classList.toggle('theme-amoled', amoled);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', amoled ? '#000000' : dark ? '#0B0E13' : '#F3F1EA');
  }, [dark, amoled]);

  const value = useMemo(() => {
    const save = (next) => { setState((s) => ({ ...s, prefs: next })); write(role, next); };
    return {
      mode: prefs.mode,
      darkStyle: prefs.darkStyle ?? 'grey',
      styleChosen: prefs.darkStyle != null,
      dark,
      amoled,
      setMode: (mode) => save({ ...prefs, mode }),
      setDarkStyle: (darkStyle) => save({ ...prefs, darkStyle }),
    };
  }, [prefs, dark, amoled, role]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

const FALLBACK = { mode: 'light', darkStyle: 'grey', styleChosen: true, dark: false, amoled: false, setMode() {}, setDarkStyle() {} };
export const useTheme = () => useContext(ThemeContext) ?? FALLBACK;
