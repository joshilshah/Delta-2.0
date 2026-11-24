import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Wallet } from 'lucide-react';
import { Page } from '../../components/Layout.jsx';
import { Alert, EmptyState, SkeletonCard, useCountUp } from '../../components/ui.jsx';
import { inr, km } from '../../lib/format.js';
import { api } from '../../services/api.js';

const DAY = 86_400_000;
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
const short = (a) => a.split(',').slice(0, 2).join(',').trim();

/** Last 7 local days, oldest first, with totals per day. */
function lastSevenDays(trips) {
  const today = startOfDay(new Date());
  return Array.from({ length: 7 }, (_, i) => {
    const start = today - (6 - i) * DAY;
    const dayTrips = trips.filter((t) => { const ts = new Date(t.completed_at).getTime(); return ts >= start && ts < start + DAY; });
    return {
      start,
      label: i === 6 ? 'Today' : new Date(start).toLocaleDateString([], { weekday: 'short' }),
      total: dayTrips.reduce((a, t) => a + t.fare, 0),
      count: dayTrips.length,
    };
  });
}

function Bars({ days }) {
  const max = Math.max(1, ...days.map((d) => d.total));
  return (
    <div className="flex h-44 items-end gap-2 sm:gap-3" role="img" aria-label={`Earnings for the last 7 days: ${days.map((d) => `${d.label} ${inr(d.total)}`).join(', ')}`}>
      {days.map((d, i) => {
        const today = i === days.length - 1;
        const h = d.total ? Math.max(6, (d.total / max) * 100) : 2;
        return (
          <div key={d.start} className="group flex h-full flex-1 flex-col items-center justify-end gap-2">
            <span className={`num text-[11px] font-medium transition ${d.total ? 'opacity-100' : 'opacity-0'} ${today ? 'text-live' : 'text-muted'}`}>{d.total ? `₹${Math.round(d.total)}` : ''}</span>
            <div className={`w-full origin-bottom animate-[grow_0.7s_cubic-bezier(.2,.8,.2,1)_both] rounded-t-xl ${today ? 'bg-live' : d.total ? 'bg-accent/45' : 'bg-line'}`}
              style={{ height: `${h}%`, animationDelay: `${i * 60}ms` }} title={`${d.count} trip${d.count === 1 ? '' : 's'}`} />
            <span className={`text-[11px] ${today ? 'font-semibold text-fg' : 'text-muted'}`}>{d.label}</span>
          </div>
        );
      })}
    </div>
  );
}

function Tile({ label, value, format, accent }) {
  const v = useCountUp(value);
  return (
    <div className={`rounded-3xl p-4 ring-1 ${accent ? 'cta-surface ring-transparent' : 'bg-surface-2 ring-line'}`}>
      <p className={`text-xs ${accent ? 'opacity-70' : 'text-muted'}`}>{label}</p>
      <p className="num mt-1 text-2xl font-semibold">{format(v)}</p>
    </div>
  );
}

/** Earnings: a weekly snapshot from the driver's own completed trips. */
export default function DriverEarnings() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    let live = true;
    api.earnings().then((r) => live && setData(r)).catch((e) => live && setError(e.message));
    return () => { live = false; };
  }, []);

  const days = useMemo(() => (data ? lastSevenDays(data.trips) : []), [data]);
  const week = days.reduce((a, d) => a + d.total, 0);
  const weekTrips = days.reduce((a, d) => a + d.count, 0);
  const weekKm = data ? data.trips.filter((t) => new Date(t.completed_at).getTime() >= days[0].start).reduce((a, t) => a + t.distance_km, 0) : 0;
  const shownWeek = useCountUp(week);

  return (
    <Page className="max-w-2xl space-y-8">
      <header>
        <p className="text-sm text-muted">Earnings · last 7 days</p>
        <h1 className="num mt-1 text-[64px] font-semibold leading-none">₹{Math.round(shownWeek)}</h1>
        <p className="mt-2 text-sm text-muted">From {weekTrips} completed trip{weekTrips === 1 ? '' : 's'}. Estimated fares: Delta’s demo has no payouts.</p>
      </header>

      {error && <Alert>{error}</Alert>}
      {!data && !error ? <SkeletonCard lines={5} /> : data && (
        <>
          <section className="card"><Bars days={days} /></section>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Tile accent label="Today" value={days[6]?.total ?? 0} format={(v) => inr(v)} />
            <Tile label="Trips this week" value={weekTrips} format={(v) => Math.round(v)} />
            <Tile label="Average fare" value={weekTrips ? week / weekTrips : 0} format={(v) => inr(v)} />
            <Tile label="Distance" value={weekKm} format={(v) => km(v)} />
          </div>

          <section className="space-y-3">
            <div className="flex items-baseline justify-between">
              <h2 className="text-lg font-semibold">Recent trips</h2>
              <span className="text-xs text-muted">All time: {data.all_time.trips} trips · {inr(data.all_time.fare)}</span>
            </div>
            {data.trips.length === 0 ? (
              <EmptyState icon={Wallet} title="No completed trips yet" action={<Link to="/driver/dashboard" className="btn-volt">Go to the cockpit</Link>}>
                Finish a trip and it shows up here with its fare.
              </EmptyState>
            ) : (
              <ul className="divide-y divide-line rounded-3xl bg-surface ring-1 ring-line">
                {data.trips.slice(0, 12).map((t) => (
                  <li key={t.id}>
                    <Link to={`/driver/trips/${t.id}`} className="flex items-center gap-4 px-4 py-3.5 transition hover:bg-surface-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{short(t.pickup_address)} → {short(t.destination_address)}</p>
                        <p className="text-xs text-muted">{new Date(t.completed_at).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })} · {km(t.distance_km)}</p>
                      </div>
                      <p className="num shrink-0 font-semibold">{inr(t.fare)}</p>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </Page>
  );
}
