import { Phone } from 'lucide-react';
import { inr, km, mins } from '../lib/format.js';
import { Avatar, Plate, UnverifiedBadge, useCountUp } from './ui.jsx';

/** Pickup → drop-off, with the Δ as the destination marker (matching the map). */
export function Route({ pickup, destination, compact = false }) {
  const text = compact ? 'text-sm' : 'text-[15px]';
  return (
    <ol className="relative space-y-4 pl-8">
      <span className="absolute bottom-5 left-[8px] top-5 w-0 border-l-2 border-dotted border-line" aria-hidden />
      <li className="relative">
        <span className="absolute -left-8 top-1 h-[18px] w-[18px] rounded-full bg-surface ring-[5px] ring-fg" aria-hidden />
        <p className="eyebrow">Pickup</p>
        <p className={`mt-0.5 font-medium leading-snug ${text}`}>{pickup}</p>
      </li>
      <li className="relative">
        <svg viewBox="0 0 28 26" className="absolute -left-[33px] top-0.5 h-[22px] w-[24px]" aria-hidden><path d="M14 2 26.5 23.5h-25Z" fill="#2F5BFF" stroke="var(--c-surface)" strokeWidth="2.6" strokeLinejoin="round" /></svg>
        <p className="eyebrow">Drop-off</p>
        <p className={`mt-0.5 font-medium leading-snug ${text}`}>{destination}</p>
      </li>
    </ol>
  );
}

export function TripStats({ distance_km, duration_minutes, estimated_fare, pickup_distance_km }) {
  const items = [
    ...(pickup_distance_km != null ? [['To pickup', km(pickup_distance_km)]] : []),
    ['Distance', km(distance_km)],
    ['Time', mins(duration_minutes)],
    ...(estimated_fare != null ? [['Fare', inr(estimated_fare)]] : []),
  ];
  return (
    <dl className="grid rounded-2xl bg-surface-2 ring-1 ring-line" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0,1fr))` }}>
      {items.map(([k, v], i) => (
        <div key={k} className={`px-3 py-3 text-center ${i ? 'border-l border-line' : ''}`}>
          <dt className="text-[11px] font-medium text-muted">{k}</dt>
          <dd className="num mt-0.5 text-[17px] font-semibold">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** The fare as a ticket: total first, the working shown below the perforation. */
export function FareTicket({ fare, compact = false }) {
  const b = fare.breakdown ?? fare.fare_breakdown;
  const total = useCountUp(Number(fare.estimated_fare));
  if (!b) return null;
  const rows = [
    ['Base fare', null, b.base_fare],
    ['Distance', `${Number(fare.distance_km).toFixed(1)} km × ₹${b.per_km_rate}`, b.distance_charge],
    ['Time', `${Math.round(fare.duration_minutes)} min × ₹${b.per_minute_rate}`, b.time_charge],
  ];
  const mock = fare.route_source === 'mock' || b.route_source === 'mock';
  return (
    <div className="relative overflow-hidden rounded-3xl bg-surface-2 ring-1 ring-line">
      <div className={`flex items-end justify-between gap-4 ${compact ? 'px-5 pb-4 pt-4' : 'px-5 pb-5 pt-5'}`}>
        <div>
          <p className="eyebrow">Estimated fare</p>
          <p className="mt-1 text-xs text-muted">{km(fare.distance_km)} · {mins(fare.duration_minutes)}</p>
        </div>
        <p className="num text-[44px] font-semibold leading-none">₹{Math.round(total)}</p>
      </div>
      {/* perforation */}
      <div className="relative h-0 border-t-2 border-dashed border-line">
        <span className="absolute -left-3 -top-3 h-6 w-6 rounded-full bg-surface" />
        <span className="absolute -right-3 -top-3 h-6 w-6 rounded-full bg-surface" />
      </div>
      <dl className="space-y-2 px-5 py-4 text-sm">
        {rows.map(([k, detail, v]) => (
          <div key={k} className="flex items-baseline justify-between gap-4">
            <dt className="text-fg-soft">{k}{detail && <span className="mono ml-2 text-muted">{detail}</span>}</dt>
            <dd className="num font-medium">{inr(v)}</dd>
          </div>
        ))}
        {mock && <p className="pt-1 text-xs text-amber-700 [.theme-night_&]:text-amber-300">Demo estimate: straight-line distance, not Google Routes.</p>}
      </dl>
    </div>
  );
}
export const FareBreakdown = FareTicket;

const STEPS = [['searching', 'Matching'], ['accepted', 'On the way'], ['arrived', 'At pickup'], ['in_progress', 'On trip'], ['completed', 'Done']];

/** Progress as five Δ steps joined by a filling line. `arrived` marks the driver at the pickup. */
export function Timeline({ status, arrived = false }) {
  const stepKey = status === 'requested' ? 'searching' : status === 'accepted' && arrived ? 'arrived' : status;
  const idx = STEPS.findIndex(([s]) => s === stepKey);
  const pct = status === 'completed' ? 100 : Math.max(0, idx) * (100 / (STEPS.length - 1));
  return (
    <div className="relative px-2 pt-1" aria-label={`Ride progress: ${STEPS[Math.max(0, idx)]?.[1] ?? status}`}>
      <div className="absolute left-5 right-5 top-[13px] h-[3px] rounded-full bg-line" aria-hidden />
      <div className="absolute left-5 top-[13px] h-[3px] rounded-full bg-accent transition-[width] duration-700" style={{ width: `calc((100% - 2.5rem) * ${pct / 100})` }} aria-hidden />
      <ol className="relative flex justify-between">
        {STEPS.map(([key, label], i) => {
          const done = idx > i || status === 'completed';
          const current = idx === i && status !== 'completed';
          return (
            <li key={key} className="flex w-14 flex-col items-center gap-1.5 text-center">
              <svg viewBox="0 0 28 26" className={`h-[22px] w-6 ${current ? 'animate-pulse' : ''}`} aria-hidden>
                <path d="M14 2 26.5 23.5h-25Z" strokeWidth="2.6" strokeLinejoin="round"
                  fill={done ? '#2F5BFF' : current ? '#D7FF3C' : 'var(--c-surface)'} stroke={done || current ? (current ? '#0E1116' : '#2F5BFF') : 'var(--c-line)'} />
              </svg>
              <span className={`text-[11px] ${done || current ? 'font-semibold text-fg' : 'text-muted'}`}>{label}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** A person you're riding with: avatar, plate, one-tap call. */
export function ContactCard({ title, person, vehicle, verified }) {
  return (
    <div className="rounded-3xl bg-surface-2 p-4 ring-1 ring-line">
      <div className="flex items-center gap-3.5">
        <Avatar name={person.name} />
        <div className="min-w-0 flex-1">
          <p className="eyebrow">{title}</p>
          <p className="truncate text-lg font-semibold leading-tight">{person.name}</p>
          {vehicle && <p className="truncate text-[13px] text-muted">{vehicle.vehicle_model}</p>}
        </div>
        {person.phone && (
          <a href={`tel:${person.phone.replace(/[^\d+]/g, '')}`} className="btn-accent btn-icon !h-12 !w-12" aria-label={`Call ${person.name} on ${person.phone}`} title={`Call ${person.phone}`}>
            <Phone className="h-5 w-5" aria-hidden />
          </a>
        )}
      </div>
      {(vehicle || verified === false) && (
        <div className="mt-3.5 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3.5">
          {vehicle && <Plate>{vehicle.vehicle_registration}</Plate>}
          {verified === false && <UnverifiedBadge />}
        </div>
      )}
      {!person.phone && <p className="mt-3 text-xs text-muted">Phone numbers are shared only while the ride is active.</p>}
    </div>
  );
}
