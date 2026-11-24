import { useEffect, useState } from 'react';
import { BriefcaseBusiness, Home, Star, Trash2 } from 'lucide-react';
import PlaceInput from './PlaceInput.jsx';
import { Alert, Segmented, Spinner, useCountUp } from './ui.jsx';
import { inr, km } from '../lib/format.js';
import { api } from '../services/api.js';

const KIND = { home: ['Home', Home], work: ['Work', BriefcaseBusiness], other: ['Favourite', Star] };

function Num({ label, value, format = (v) => Math.round(v) }) {
  const v = useCountUp(Number(value) || 0);
  return (
    <div className="rounded-2xl bg-surface-2 px-4 py-3 ring-1 ring-line">
      <p className="text-xs text-muted">{label}</p>
      <p className="num mt-0.5 text-xl font-semibold">{format(v)}</p>
    </div>
  );
}

/** Ride activity and account numbers for the signed-in user (from /me/overview). */
export function Overview({ role }) {
  const [o, setO] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => { api.overview().then(setO).catch((e) => setError(e.message)); }, []);
  if (error) return <Alert tone="warn">{error}</Alert>;
  if (!o) return <div className="skeleton h-20" />;
  const driver = role === 'driver';
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <Num label={driver ? 'Completed trips' : 'Trips taken'} value={o.completed} />
      <Num label={driver ? 'Earned' : 'Spent'} value={driver ? o.earned : o.spent} format={inr} />
      <Num label="Distance" value={o.distance_km} format={km} />
      <Num label="Cancelled" value={o.cancelled} />
    </div>
  );
}

/** Saved pickup / destination places: Home, Work and favourites. Shown as one-tap chips when booking. */
export function SavedPlaces() {
  const [places, setPlaces] = useState(null);
  const [adding, setAdding] = useState(null); // { kind, label, place }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const load = () => api.savedPlaces().then((r) => setPlaces(r.places)).catch((e) => { setError(e.message); setPlaces([]); });
  useEffect(() => { load(); }, []);

  const has = (k) => places?.some((p) => p.kind === k);
  const start = (kind) => setAdding({ kind, label: kind === 'other' ? '' : KIND[kind][0], place: null });

  async function save(e) {
    e.preventDefault();
    if (!adding.place) { setError('Search for the address first.'); return; }
    setBusy(true); setError(null);
    try {
      await api.savePlace({ kind: adding.kind, label: adding.label.trim() || KIND[adding.kind][0], ...adding.place });
      setAdding(null); await load();
    } catch (err) { setError(err.details?.[0]?.message ?? err.message); } finally { setBusy(false); }
  }
  async function remove(p) {
    try { await api.deletePlace(p.id); await load(); } catch (err) { setError(err.message); }
  }

  return (
    <div className="space-y-3">
      {places === null ? <Spinner /> : (
        <ul className="space-y-2">
          {places.map((p) => {
            const Icon = KIND[p.kind]?.[1] ?? Star;
            return (
              <li key={p.id} className="flex items-center gap-3 rounded-2xl bg-surface-2 px-3 py-2.5 ring-1 ring-line">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-surface ring-1 ring-line"><Icon className="h-4 w-4" aria-hidden /></span>
                <span className="min-w-0 flex-1"><span className="block text-sm font-semibold">{p.label}</span><span className="block truncate text-xs text-muted">{p.address}</span></span>
                <button className="btn-ghost btn-icon !h-8 !w-8 text-danger" onClick={() => remove(p)} aria-label={`Remove ${p.label}`}><Trash2 className="h-4 w-4" aria-hidden /></button>
              </li>
            );
          })}
          {!places.length && !adding && <p className="text-sm text-muted">Save Home and Work to book them in one tap.</p>}
        </ul>
      )}
      {adding ? (
        <form onSubmit={save} className="animate-rise space-y-3 rounded-3xl bg-surface-2 p-4 ring-1 ring-line">
          <Segmented label="Place type" value={adding.kind} onChange={(k) => setAdding({ ...adding, kind: k, label: k === 'other' ? adding.label : KIND[k][0] })}
            options={[['home', 'Home'], ['work', 'Work'], ['other', 'Other']]} />
          {adding.kind === 'other' && <div><label className="label" htmlFor="sp-label">Name</label><input id="sp-label" className="input !bg-surface" value={adding.label} onChange={(e) => setAdding({ ...adding, label: e.target.value })} maxLength={40} placeholder="Gym, Mum’s place…" required /></div>}
          <PlaceInput label="Address" value={adding.place} onChange={(place) => setAdding((a) => ({ ...a, place }))} placeholder="Search an address" variant="destination" />
          {has(adding.kind) && adding.kind !== 'other' && <p className="text-xs text-muted">This replaces your current {KIND[adding.kind][0]}.</p>}
          {error && <Alert>{error}</Alert>}
          <div className="flex gap-2">
            <button className="btn-primary flex-1" disabled={busy}>{busy && <Spinner />} Save place</button>
            <button type="button" className="btn-outline" onClick={() => { setAdding(null); setError(null); }}>Cancel</button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap gap-2">
          {!has('home') && <button className="btn-outline !py-2 text-sm" onClick={() => start('home')}><Home className="h-4 w-4" aria-hidden /> Add Home</button>}
          {!has('work') && <button className="btn-outline !py-2 text-sm" onClick={() => start('work')}><BriefcaseBusiness className="h-4 w-4" aria-hidden /> Add Work</button>}
          <button className="btn-outline !py-2 text-sm" onClick={() => start('other')}><Star className="h-4 w-4" aria-hidden /> Add a place</button>
        </div>
      )}
      {!adding && error && <Alert>{error}</Alert>}
    </div>
  );
}
