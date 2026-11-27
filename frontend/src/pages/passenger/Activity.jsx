import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowUpRight, Clock3, RotateCcw } from 'lucide-react';
import { Page } from '../../components/Layout.jsx';
import { LiveRideCard } from '../../components/RideTracker.jsx';
import { Alert, EmptyState, Plate, Segmented, SkeletonCard, Spinner, StatusBadge, useCountUp } from '../../components/ui.jsx';
import { useLiveData } from '../../context/LiveContext.jsx';
import { inr, km } from '../../lib/format.js';
import { api } from '../../services/api.js';

const short = (a) => a.split(',').slice(0, 2).join(',').trim();
const dayLabel = (iso) => {
  const d = new Date(iso); const today = new Date();
  const diff = Math.round((new Date(today.toDateString()) - new Date(d.toDateString())) / 86_400_000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'short' });
};
const time = (iso) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

function Stat({ label, value, format }) {
  const v = useCountUp(value);
  return (
    <div className="rounded-3xl bg-surface p-4 ring-1 ring-line">
      <p className="text-xs text-muted">{label}</p>
      <p className="num mt-1 text-2xl font-semibold">{format(v)}</p>
    </div>
  );
}

function TripRow({ trip, onAgain }) {
  const done = trip.status === 'completed';
  return (
    <li className="group rounded-3xl bg-surface p-4 ring-1 ring-line transition hover:ring-fg/25">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[15px] font-semibold">{short(trip.destination.address)}</p>
          <p className="truncate text-xs text-muted">from {short(trip.pickup.address)} · {time(trip.created_at)}</p>
        </div>
        <p className={`num shrink-0 text-lg font-semibold ${done ? '' : 'text-muted line-through decoration-1'}`}>{inr(trip.estimated_fare)}</p>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <StatusBadge status={trip.status} />
        <span className="chip">{km(trip.distance_km)}</span>
        {trip.counterpart?.vehicle_registration && <Plate className="scale-90">{trip.counterpart.vehicle_registration}</Plate>}
        {trip.counterpart?.name && <span className="text-xs text-muted">with {trip.counterpart.name}</span>}
      </div>
      <div className="mt-3 flex gap-2 border-t border-line pt-3">
        <button onClick={() => onAgain(trip)} className="btn-outline !px-3.5 !py-2 text-xs"><RotateCcw className="h-3.5 w-3.5" aria-hidden /> Book again</button>
        <Link to={`/passenger/trips/${trip.id}`} className="btn-ghost !px-3.5 !py-2 text-xs">Trip details <ArrowUpRight className="h-3.5 w-3.5" aria-hidden /></Link>
      </div>
    </li>
  );
}

/** Activity: your trips, newest first, with quick "book again". */
export default function PassengerActivity() {
  const { activeRide } = useLiveData();
  const navigate = useNavigate();
  const [items, setItems] = useState(null);
  const [next, setNext] = useState(null);
  const [error, setError] = useState(null);
  const [more, setMore] = useState(false);
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    let live = true;
    api.history({ limit: 30 })
      .then((r) => { if (live) { setItems(r.items); setNext(r.next_before); } })
      .catch((e) => live && setError(e.message));
    return () => { live = false; };
  }, []);

  async function loadMore() {
    setMore(true);
    try { const r = await api.history({ limit: 30, before: next }); setItems((x) => [...x, ...r.items]); setNext(r.next_before); }
    catch (e) { setError(e.message); } finally { setMore(false); }
  }

  const finished = useMemo(() => (items ?? []).filter((t) => !['requested', 'searching', 'accepted', 'in_progress'].includes(t.status)), [items]);
  const completed = finished.filter((t) => t.status === 'completed');
  const shown = finished.filter((t) => filter === 'all' || (filter === 'completed' ? t.status === 'completed' : t.status !== 'completed'));
  const groups = shown.reduce((acc, t) => { const k = dayLabel(t.created_at); (acc[k] ??= []).push(t); return acc; }, {});
  const again = (t) => navigate('/passenger/book', { state: { destination: t.destination } });

  return (
    <Page className="max-w-2xl space-y-8">
      <header>
        <p className="text-sm text-muted">Activity</p>
        <h1 className="text-[40px] font-semibold leading-[1.02]">Your <span className="serif text-accent">trips</span></h1>
      </header>

      {activeRide && <LiveRideCard ride={activeRide} />}
      {error && <Alert>{error}</Alert>}

      {items === null ? <SkeletonCard lines={5} /> : (
        <>
          <div className="grid grid-cols-3 gap-3">
            <Stat label="Trips taken" value={completed.length} format={(v) => Math.round(v)} />
            <Stat label="Spent" value={completed.reduce((a, t) => a + t.estimated_fare, 0)} format={(v) => inr(v)} />
            <Stat label="Travelled" value={completed.reduce((a, t) => a + t.distance_km, 0)} format={(v) => km(v)} />
          </div>
          {items.length >= 30 && <p className="-mt-5 text-xs text-muted">Totals cover the trips loaded below.</p>}

          {finished.length === 0 ? (
            <EmptyState icon={Clock3} title="No trips yet" action={<Link to="/passenger/book" className="btn-accent">Book your first ride</Link>}>
              Your trips will appear here, ready to book again in one tap.
            </EmptyState>
          ) : (
            <section className="space-y-6">
              <Segmented label="Filter trips" value={filter} onChange={setFilter}
                options={[['all', `All · ${finished.length}`], ['completed', `Completed · ${completed.length}`], ['other', 'Cancelled']]} />
              {Object.entries(groups).map(([day, trips]) => (
                <div key={day} className="space-y-3">
                  <h2 className="text-sm font-semibold text-fg-soft">{day}</h2>
                  <ul className="space-y-3">{trips.map((t) => <TripRow key={t.id} trip={t} onAgain={again} />)}</ul>
                </div>
              ))}
              {shown.length === 0 && <p className="text-sm text-muted">Nothing in this filter.</p>}
              {next && <button className="btn-outline w-full" onClick={loadMore} disabled={more}>{more && <Spinner />} Load older trips</button>}
            </section>
          )}
        </>
      )}
    </Page>
  );
}
