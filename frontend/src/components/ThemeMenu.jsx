import { useEffect, useRef, useState } from 'react';
import { Check, Monitor, Moon, Sun } from 'lucide-react';
import { useTheme } from '../context/ThemeContext.jsx';

const MODES = [['light', 'Light', Sun], ['dark', 'Dark', Moon], ['system', 'System', Monitor]];
const STYLES = [
  ['grey', 'Grey', 'Soft charcoal, easy on the eyes', ['#0B0E13', '#191E27', '#D7FF3C']],
  ['amoled', 'AMOLED black', 'True black, saves battery on OLED', ['#000000', '#141417', '#D7FF3C']],
];

/** The dark-style question: grey or AMOLED black. */
export function DarkStylePicker({ prompt = false }) {
  const t = useTheme();
  return (
    <div className={`space-y-2 ${prompt ? 'animate-rise rounded-2xl p-3 ring-2 ring-accent' : ''}`}>
      <p className="text-xs font-semibold text-fg">{prompt ? 'Which dark do you prefer?' : 'Dark style'}</p>
      <div className="grid grid-cols-2 gap-2">
        {STYLES.map(([v, label, hint, sw]) => {
          const on = t.styleChosen && t.darkStyle === v;
          return (
            <button key={v} type="button" onClick={() => t.setDarkStyle(v)} aria-pressed={on}
              className={`rounded-2xl p-2.5 text-left ring-1 transition hover:ring-fg/40 ${on ? 'ring-2 ring-accent' : 'ring-line'}`}>
              <span className="relative block h-12 overflow-hidden rounded-xl" style={{ background: sw[0] }} aria-hidden>
                <span className="absolute inset-x-2 bottom-2 h-4 rounded-md" style={{ background: sw[1] }} />
                <span className="absolute right-2 top-2 h-2 w-2 rounded-full" style={{ background: sw[2] }} />
                {on && <Check className="absolute left-2 top-2 h-3.5 w-3.5 text-white" />}
              </span>
              <span className="mt-2 block text-xs font-semibold">{label}</span>
              <span className="block text-[11px] leading-snug text-muted">{hint}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Appearance button + popover: Light / Dark / System, then (when dark) Grey or AMOLED black. */
export default function ThemeMenu({ className = '' }) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (!box.current?.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);

  const Icon = t.mode === 'system' ? Monitor : t.dark ? Moon : Sun;
  return (
    <div ref={box} className={`relative ${className}`}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-haspopup="dialog" aria-expanded={open}
        className="btn-ghost btn-icon" aria-label="Appearance" title="Appearance">
        <Icon className="h-4 w-4" aria-hidden />
      </button>
      {open && (
        <div className="sheet absolute right-0 top-12 z-[70] w-72 animate-pop space-y-4 p-4 text-fg" role="dialog" aria-label="Appearance">
          <div>
            <p className="mb-2 text-xs font-semibold">Appearance</p>
            <div className="grid grid-cols-3 gap-1 rounded-2xl bg-surface-2 p-1 ring-1 ring-line">
              {MODES.map(([v, label, I]) => (
                <button key={v} type="button" onClick={() => t.setMode(v)} aria-pressed={t.mode === v}
                  className={`flex flex-col items-center gap-1 rounded-xl py-2 text-[11px] font-semibold transition ${t.mode === v ? 'bg-surface text-fg shadow-sm ring-1 ring-line' : 'text-muted hover:text-fg'}`}>
                  <I className="h-4 w-4" aria-hidden />{label}
                </button>
              ))}
            </div>
            {t.mode === 'system' && <p className="mt-2 text-[11px] text-muted">Following your device: currently {t.dark ? 'dark' : 'light'}.</p>}
          </div>
          {t.dark && <DarkStylePicker prompt={!t.styleChosen} />}
        </div>
      )}
    </div>
  );
}
