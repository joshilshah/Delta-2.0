import { Car, MapPin } from 'lucide-react';

const ROLES = [
  ['passenger', 'Ride', 'Book trips and track your driver', MapPin],
  ['driver', 'Drive', 'Go online and accept requests', Car],
];

/** Two big, tappable choices instead of a radio list. */
export default function RolePicker({ value, onChange, name = 'role' }) {
  return (
    <fieldset>
      <legend className="label">I want to</legend>
      <div className="grid grid-cols-2 gap-3">
        {ROLES.map(([v, title, text, Icon]) => {
          const on = value === v;
          return (
            <label key={v} className={`group relative cursor-pointer rounded-3xl p-4 ring-1 transition focus-within:ring-2 focus-within:ring-accent ${on ? 'bg-fg text-canvas ring-fg' : 'bg-surface-2 ring-line hover:ring-fg/30'}`}>
              <input type="radio" name={name} value={v} className="sr-only" checked={on} onChange={() => onChange(v)} />
              <span className={`grid h-10 w-10 place-items-center rounded-full transition ${on ? (v === 'driver' ? 'bg-volt text-ink' : 'bg-accent text-white') : 'bg-surface text-fg ring-1 ring-line'}`}>
                <Icon className="h-5 w-5" aria-hidden />
              </span>
              <span className="mt-3 block text-lg font-semibold">{title}</span>
              <span className={`mt-0.5 block text-xs ${on ? 'opacity-70' : 'text-muted'}`}>{text}</span>
              {on && <svg viewBox="0 0 28 26" className="absolute right-4 top-4 h-4 w-5 animate-pop" aria-hidden><path d="M14 2 26.5 23.5h-25Z" fill={v === 'driver' ? '#D7FF3C' : '#2F5BFF'} /></svg>}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
