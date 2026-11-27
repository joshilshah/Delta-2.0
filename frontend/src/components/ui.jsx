import { useEffect, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Eye, EyeOff, Info, Loader2 } from 'lucide-react';
import { STATUS_LABEL } from '../lib/format.js';

export function Spinner({ className = '' }) {
  return <Loader2 className={`h-4 w-4 animate-spin ${className}`} aria-hidden />;
}

export function Alert({ tone = 'error', children }) {
  const styles = {
    error: 'bg-danger/10 text-danger ring-danger/20',
    success: 'bg-success/10 text-success ring-success/20',
    info: 'bg-accent/10 text-accent ring-accent/20',
    warn: 'bg-amber-500/10 text-amber-700 ring-amber-500/25 [.theme-night_&]:text-amber-300',
  }[tone];
  const Icon = tone === 'success' ? CheckCircle2 : tone === 'info' ? Info : AlertCircle;
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={`flex items-start gap-3 rounded-2xl px-4 py-3 text-sm ring-1 ${styles}`}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div className="min-w-0 text-fg-soft [&_strong]:text-fg">{children}</div>
    </div>
  );
}

const DOT = {
  requested: 'bg-muted', searching: 'bg-accent', accepted: 'bg-success', in_progress: 'bg-live',
  completed: 'bg-fg', cancelled: 'bg-danger', unmatched: 'bg-amber-500',
};
const LIVE = new Set(['searching', 'requested', 'accepted', 'in_progress']);

/** Status as a live dot + label. Active states pulse. */
export function StatusBadge({ status, className = '' }) {
  return (
    <span className={`inline-flex items-center gap-2 rounded-full bg-surface-2 py-1 pl-2 pr-3 text-xs font-semibold ring-1 ring-line ${className}`}>
      <span className="relative flex h-2 w-2">
        {LIVE.has(status) && <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 ${DOT[status]}`} />}
        <span className={`relative h-2 w-2 rounded-full ${DOT[status] ?? 'bg-muted'}`} />
      </span>
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

export function UnverifiedBadge() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-400/15 px-2.5 py-1 text-[11px] font-semibold text-amber-700 ring-1 ring-amber-500/25 [.theme-night_&]:text-amber-300">
      Unverified demo driver
    </span>
  );
}

/** Indian-style number plate: the blue IND strip is a small nod to the real thing. */
export function Plate({ children, className = '' }) {
  return (
    <span className={`inline-flex shrink-0 items-stretch overflow-hidden rounded-[6px] border-2 border-ink bg-white font-mono text-ink shadow-sm ${className}`}>
      <span className="flex flex-col items-center justify-center bg-[#1E44E0] px-1 text-[7px] font-bold leading-none text-white">IND</span>
      <span className="px-2 py-0.5 text-[13px] font-semibold tracking-[0.12em]">{children}</span>
    </span>
  );
}

// Avatar tones stay inside the palette (no extra hues): blue, ink, soft blue, slate.
const AVATAR_TONES = ['bg-accent text-white', 'bg-ink text-white ring-1 ring-white/15', 'bg-[#8FA8FF] text-ink', 'bg-[#C9CED8] text-ink'];
export function Avatar({ name = '', size = 'h-12 w-12 text-base' }) {
  const initials = name.replace(/\(.*?\)/g, '').trim().split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase() || '?';
  const tone = AVATAR_TONES[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR_TONES.length];
  return <span className={`grid shrink-0 place-items-center rounded-full font-semibold ${size} ${tone}`} aria-hidden>{initials}</span>;
}

export function SkeletonCard({ lines = 3 }) {
  return (
    <div className="space-y-3" aria-busy="true">
      <div className="skeleton h-6 w-2/5" />
      {Array.from({ length: lines }, (_, i) => <div key={i} className="skeleton h-4" style={{ width: `${92 - i * 9}%` }} />)}
    </div>
  );
}

export function EmptyState({ title, children, action, icon: Icon }) {
  return (
    <div className="rounded-3xl border border-dashed border-line px-6 py-10 text-center">
      {Icon && <Icon className="mx-auto mb-3 h-6 w-6 text-muted" aria-hidden />}
      <h3 className="text-base font-semibold">{title}</h3>
      {children && <p className="mx-auto mt-1 max-w-sm text-sm text-muted">{children}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function FullPageSpinner() {
  return (
    <div className="grid min-h-screen place-items-center" role="status" aria-label="Loading">
      <span aria-hidden className="h-11 w-12 animate-pulse bg-fg"
        style={{ mask: 'url(/brand/delta-mark.png) center / contain no-repeat', WebkitMask: 'url(/brand/delta-mark.png) center / contain no-repeat' }} />
    </div>
  );
}

/** Password field with a show/hide toggle. Takes the same props as <input>; `type` is managed here. */
export function PasswordInput({ id, className = 'input', ...props }) {
  const [shown, setShown] = useState(false);
  return (
    <div className="relative">
      <input id={id} {...props} type={shown ? 'text' : 'password'} className={`${className} pr-12`} />
      <button type="button" onClick={() => setShown((s) => !s)} aria-pressed={shown} aria-controls={id}
        aria-label={shown ? 'Hide password' : 'Show password'} title={shown ? 'Hide password' : 'Show password'}
        className="absolute inset-y-0 right-1.5 my-auto grid h-10 w-10 place-items-center rounded-full text-muted transition hover:bg-surface-2 hover:text-fg">
        {shown ? <EyeOff className="h-5 w-5" aria-hidden /> : <Eye className="h-5 w-5" aria-hidden />}
      </button>
    </div>
  );
}

export function Switch({ checked, onChange, disabled, label }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} onClick={onChange} disabled={disabled}
      className={`relative h-7 w-12 shrink-0 rounded-full transition-colors disabled:opacity-50 ${checked ? 'bg-accent' : 'bg-line'}`}>
      <span className={`absolute left-1 top-1 h-5 w-5 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-5' : ''}`} />
    </button>
  );
}

/** Segmented control for 2-3 mutually exclusive options. */
export function Segmented({ value, options, onChange, label, className = '' }) {
  return (
    <div className={`inline-flex rounded-full bg-surface-2 p-1 ring-1 ring-line ${className}`} role="group" aria-label={label}>
      {options.map(([v, text]) => (
        <button key={v} type="button" onClick={() => onChange(v)} aria-pressed={value === v}
          className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${value === v ? 'bg-surface text-fg shadow-sm ring-1 ring-line' : 'text-muted hover:text-fg'}`}>
          {text}
        </button>
      ))}
    </div>
  );
}

/** Animate a number towards its new value (fares, countdowns). */
export function useCountUp(value, ms = 650) {
  const [shown, setShown] = useState(value ?? 0);
  const from = useRef(value ?? 0);
  useEffect(() => {
    if (value == null) return undefined;
    const start = performance.now();
    const a = from.current;
    let raf;
    const step = (t) => {
      const k = Math.min(1, (t - start) / ms);
      const eased = 1 - (1 - k) ** 3;
      const v = a + (value - a) * eased;
      setShown(v);
      if (k < 1) raf = requestAnimationFrame(step);
      else from.current = value;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, ms]);
  return shown;
}
