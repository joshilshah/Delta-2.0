import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, BellRing, LifeBuoy, MessageCircle, RotateCcw } from 'lucide-react';
import { Page } from '../components/Layout.jsx';
import MapView from '../components/MapView.jsx';
import { FareTicket, Route } from '../components/RideParts.jsx';
import { Alert, Avatar, Plate, SkeletonCard, StatusBadge, UnverifiedBadge } from '../components/ui.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { inr, km, mins } from '../lib/format.js';
import { api } from '../services/api.js';

const when = (iso) => new Date(iso).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const clock = (iso) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

function Fact({ label, value, hint }) {
  return (
    <div className="rounded-2xl bg-surface-2 px-4 py-3 ring-1 ring-line">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="num mt-0.5 text-lg font-semibold">{value}</dd>
      {hint && <p className="text-[11px] text-muted">{hint}</p>}
    </div>
  );
}

/** Full record of one past (or current) trip, for passengers and drivers alike. */
export default function TripDetail() {
  const { id } = useParams();
  const { role } = useAuth();
  const navigate = useNavigate();
  const [ride, setRide] = useState(null);
  const [path, setPath] = useState([]);
  const [messages, setMessages] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    let live = true;
    api.getRide(id).then((r) => live && setRide(r.ride)).catch((e) => live && setError(e));
    // Extras are best-effort: the trip still shows without them.
    api.ridePath(id).then((r) => live && setPath(r.points)).catch(() => {});
    api.messages(id).then((r) => live && setMessages(r.messages)).catch(() => {});
    return () => { live = false; };
  }, [id]);

  const back = role === 'driver' ? '/driver/earnings' : '/passenger/activity';
  if (error) return <Page><Alert>{error.status === 404 ? 'This trip could not be found.' : error.message}</Alert></Page>;
  if (!ride) return <Page><SkeletonCard lines={8} /></Page>;

  const active = ['requested', 'searching', 'accepted', 'in_progress'].includes(ride.status);
  const other = role === 'driver' ? ride.passenger : ride.driver;
  const steps = [
    ['Booked', ride.created_at], ['Driver accepted', ride.accepted_at], ['Driver arrived', ride.arrived_at],
    ['Trip started', ride.started_at], ['Completed', ride.completed_at],
    [`Cancelled${ride.cancelled_by ? ` by ${ride.cancelled_by === role ? 'you' : ride.cancelled_by}` : ''}`, ride.cancelled_at],
  ].filter(([, t]) => t);

  return (
    <Page className="max-w-3xl space-y-6">
      <Link to={back} className="btn-ghost -ml-3 !px-3 !py-2 text-sm"><ArrowLeft className="h-4 w-4" aria-hidden /> {role === 'driver' ? 'Earnings' : 'Activity'}</Link>

      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <StatusBadge status={ride.status} />
          <h1 className="mt-2 text-[34px] font-semibold leading-tight">{ride.destination.address.split(',')[0]}</h1>
          <p className="text-sm text-muted">{when(ride.created_at)}</p>
        </div>
        <p className={`num text-4xl font-semibold ${ride.status === 'completed' ? '' : 'text-muted line-through decoration-2'}`}>{inr(ride.estimated_fare)}</p>
      </header>

      {active && (
        <Link to={`/${role}/ride/${ride.id}`} className="cta-surface flex items-center justify-between rounded-3xl px-5 py-4 font-semibold">
          This trip is live. Open the live view <ArrowRight className="h-4 w-4" aria-hidden />
        </Link>
      )}

      <div className="overflow-hidden rounded-3xl">
        <MapView pickup={ride.pickup} destination={ride.destination} path={path} status={ride.status} approach={false} interactive={false} />
      </div>
      {path.length > 1 && <p className="-mt-4 text-xs text-muted">Solid blue line: the path the car actually drove ({path.length} location updates).</p>}

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Fact label={ride.status === 'completed' ? 'Final fare' : 'Quoted fare'} value={inr(ride.estimated_fare)} hint="Fixed at booking" />
        <Fact label="Ride time" value={ride.actual_duration_minutes ? mins(ride.actual_duration_minutes) : '—'} hint={`Estimated ${mins(ride.duration_minutes)}`} />
        <Fact label="Distance" value={km(ride.distance_km)} />
        <Fact label="Date" value={new Date(ride.created_at).toLocaleDateString([], { day: 'numeric', month: 'short' })} hint={clock(ride.created_at)} />
      </dl>

      <section className="card space-y-5">
        <Route pickup={ride.pickup.address} destination={ride.destination.address} />
        {other ? (
          <div className="flex items-center gap-3 border-t border-line pt-5">
            <Avatar name={other.name} />
            <div className="min-w-0 flex-1">
              <p className="eyebrow">{role === 'driver' ? 'Passenger' : 'Driver'}</p>
              <p className="truncate font-semibold">{other.name}</p>
              {other.vehicle_model && <p className="truncate text-sm text-muted">{other.vehicle_model}</p>}
            </div>
            {other.vehicle_registration && <Plate>{other.vehicle_registration}</Plate>}
          </div>
        ) : <p className="border-t border-line pt-5 text-sm text-muted">No driver was assigned to this trip.</p>}
        {role === 'passenger' && ride.driver?.is_verified === false && <UnverifiedBadge />}
      </section>

      <section className="card">
        <h2 className="mb-4 text-base font-semibold">Timeline</h2>
        <ol className="space-y-3">
          {steps.map(([label, t]) => (
            <li key={label} className="flex items-center justify-between gap-3 text-sm">
              <span className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-accent" />{label}</span>
              <span className="mono text-muted">{clock(t)}</span>
            </li>
          ))}
        </ol>
      </section>

      {messages.length > 0 && (
        <details className="card group">
          <summary className="flex cursor-pointer list-none items-center justify-between font-semibold">
            <span className="flex items-center gap-2"><MessageCircle className="h-4 w-4 text-muted" aria-hidden />Messages · {messages.length}</span>
            <span className="text-xs text-muted group-open:hidden">Show</span>
          </summary>
          <ul className="mt-4 space-y-2">
            {messages.map((m) => (
              <li key={m.id} className="flex gap-2 text-sm">
                {m.sender_role === 'system' ? <BellRing className="mt-0.5 h-4 w-4 shrink-0 text-muted" aria-hidden /> : <span className="w-16 shrink-0 text-xs font-semibold text-muted">{m.mine ? 'You' : m.sender_role}</span>}
                <span className="flex-1">{m.body}</span>
                <span className="mono shrink-0 text-xs text-muted">{clock(m.created_at)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      <FareTicket fare={ride} />

      <div className="flex flex-wrap gap-3">
        <Link to={`/${role}/support?ride=${ride.id}`} className="btn-outline flex-1"><LifeBuoy className="h-4 w-4" aria-hidden /> Get help with this trip</Link>
        {role === 'passenger' && !active && (
          <button className="btn-primary flex-1" onClick={() => navigate('/passenger/book', { state: { destination: ride.destination } })}>
            <RotateCcw className="h-4 w-4" aria-hidden /> Book again
          </button>
        )}
      </div>
    </Page>
  );
}
