import { ArrowUpRight, BriefcaseBusiness, Clock, Home, Star } from 'lucide-react';
import { timeAgo } from '../lib/format.js';

const short = (address) => address.split(',').slice(0, 2).join(',').trim();

/** Tap-to-fill chips built from the customer's own booking history. Hidden when there is nothing yet. */
export function RecentChips({ places, onPick, label = 'Recent' }) {
  if (!places?.length) return null;
  return (
    <div>
      <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted"><Clock className="h-3.5 w-3.5" aria-hidden /> {label}</p>
      <ul className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
        {places.map((p) => (
          <li key={p.address} className="shrink-0">
            <button type="button" onClick={() => onPick({ address: p.address, latitude: p.latitude, longitude: p.longitude })} title={p.address}
              className="max-w-[14rem] truncate rounded-full bg-surface px-3.5 py-2 text-left text-[13px] font-medium text-fg-soft ring-1 ring-line transition hover:-translate-y-0.5 hover:text-fg hover:ring-fg/30">
              {short(p.address)}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

const KIND_ICON = { home: Home, work: BriefcaseBusiness, other: Star };

/** Saved places (Home, Work, favourites) as one-tap chips. */
export function SavedChips({ places, onPick }) {
  if (!places?.length) return null;
  return (
    <div>
      <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted"><Star className="h-3.5 w-3.5" aria-hidden /> Saved</p>
      <ul className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
        {places.map((p) => {
          const Icon = KIND_ICON[p.kind] ?? Star;
          return (
            <li key={p.id} className="shrink-0">
              <button type="button" onClick={() => onPick({ address: p.address, latitude: p.latitude, longitude: p.longitude })} title={p.address}
                className="flex max-w-[14rem] items-center gap-1.5 truncate rounded-full bg-fg px-3.5 py-2 text-[13px] font-semibold text-canvas transition hover:-translate-y-0.5">
                <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />{p.label}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Rows on the home sheet: each one books that destination again. */
export function RecentList({ places, onPick }) {
  return (
    <ul className="space-y-1">
      {places.map((p) => (
        <li key={p.address}>
          <button type="button" onClick={() => onPick(p)} className="group flex w-full items-center gap-3.5 rounded-2xl px-2 py-2.5 text-left transition hover:bg-surface-2">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-surface-2 ring-1 ring-line transition group-hover:bg-fg group-hover:text-canvas">
              <Clock className="h-4 w-4" aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15px] font-medium">{short(p.address)}</span>
              <span className="block truncate text-xs text-muted">{p.times_used > 1 ? `${p.times_used} trips · ` : ''}last {timeAgo(p.last_used_at)}</span>
            </span>
            <ArrowUpRight className="h-4 w-4 shrink-0 text-muted transition group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-fg" aria-hidden />
          </button>
        </li>
      ))}
    </ul>
  );
}
