import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, BellRing, Phone, RotateCcw, ShieldAlert, ShieldCheck } from 'lucide-react';
import { ContactActions } from './RideChat.jsx';
import { AlertBanner, SafetySheet, useRideAlerts } from './Safety.jsx';
import { api } from '../services/api.js';
import { useCountdown, useLive, useNow } from '../hooks/useLive.js';
import { inr } from '../lib/format.js';
import { Alert, Avatar, Plate, SkeletonCard, Spinner, StatusBadge } from './ui.jsx';
import { ContactCard, FareTicket, Route, Timeline, TripStats } from './RideParts.jsx';
import CanvasLayout, { useSheetOffset } from './CanvasLayout.jsx';
import MapView from './MapView.jsx';

const firstName = (n = '') => n.replace(/\(.*?\)/g, '').trim().split(/\s+/)[0];

/** Live state of one ride (realtime + polling), shared by the map and the sheet. */
export function useRide(rideId) {
  // Ride row changes (status, arrival) AND every new driver position push an immediate refresh.
  return useLive(() => api.getRide(rideId).then((r) => r.ride), {
    intervalMs: 4000,
    realtime: [{ table: 'rides', filter: `id=eq.${rideId}` }, { table: 'ride_tracking_events', filter: `ride_id=eq.${rideId}` }],
  });
}

/** "4 min away" style line from the server's live ETA (estimate from the driver's last position). */
export function EtaPill({ ride, forDriver = false }) {
  const now = useNow(5000);
  if (!ride.eta || (ride.arrived_at && ride.status === 'accepted')) return null;
  const age = ride.eta.from_updated_at ? Math.round((now - new Date(ride.eta.from_updated_at)) / 1000) : null;
  const toPickup = ride.eta.target === 'pickup';
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl bg-surface-2 px-4 py-3 ring-1 ring-line" aria-live="polite">
      <div>
        <p className="text-xs text-muted">{toPickup ? (forDriver ? 'Pickup in' : 'Driver arrives in') : 'Drop-off in'} <span className="opacity-70">(estimate)</span></p>
        <p className="num text-2xl font-semibold">~{ride.eta.minutes} min</p>
      </div>
      <div className="text-right text-xs text-muted">
        <p>{ride.eta.distance_km} km away</p>
        {age != null && <p className="inline-flex items-center gap-1"><span className={`h-1.5 w-1.5 rounded-full ${age < 60 ? 'animate-pulse bg-success' : 'bg-amber-400'}`} />{age < 60 ? 'Live location' : `Updated ${Math.round(age / 60)} min ago`}</p>}
      </div>
    </div>
  );
}

/** Headline and supporting line for each state. Returns [lead, accent, rest, sub]. */
function copyFor(ride) {
  const m = ride.matching;
  const name = firstName(ride.driver?.name) || 'Your driver';
  switch (ride.status) {
    case 'requested':
    case 'searching':
      return ['Finding your', 'driver', '', m?.attempt ? `Asking the nearest driver${m.attempt > 1 ? ` (#${m.attempt})` : ''}. If they pass, we move on automatically.` : 'Looking for the closest available driver.'];
    case 'accepted': return ride.arrived_at
      ? ['', name, ' has arrived', `Meet them at the pickup point. Look for ${ride.driver?.vehicle_registration ?? 'your car'}.`]
      : ['', name, ' is on the way', 'Heading to your pickup point now.'];
    case 'in_progress': return ['You’re', 'on your way', '', 'Sit back. The map follows your driver.'];
    case 'completed': return ['You’ve', 'arrived', '', `Estimated fare ${inr(ride.estimated_fare)}. Thanks for riding with Delta.`];
    case 'cancelled': return ['Ride', 'cancelled', '', `Cancelled by ${ride.cancelled_by === 'driver' ? 'the driver' : 'you'}. Nothing was charged.`];
    case 'unmatched': return ['No drivers', 'nearby', '', 'No eligible driver accepted within 10 km. Nothing was charged.'];
    default: return ['Your', 'ride', '', ''];
  }
}

function Headline({ ride, big = true }) {
  const [lead, accent, rest] = copyFor(ride);
  return (
    <h1 className={`${big ? 'text-[34px] sm:text-[40px]' : 'text-[28px]'} font-semibold leading-[1.05]`}>
      {lead && <>{lead} </>}<span className="serif text-accent">{accent}</span>{rest}
    </h1>
  );
}

/** Animated "matching" block: concentric pulses around a Δ, with the offer countdown. */
function Matching({ ride }) {
  const left = useCountdown(ride.matching?.offer_seconds_left ?? null, ride.matching?.attempt);
  const attempts = Math.max(1, ride.matching?.attempt ?? 1);
  return (
    <div className="flex items-center gap-5 rounded-3xl bg-surface-2 p-5 ring-1 ring-line" aria-live="polite">
      <div className="relative grid h-16 w-16 shrink-0 place-items-center">
        <span className="absolute inset-0 animate-radar rounded-full border-2 border-accent/60" />
        <span className="absolute inset-0 animate-radar rounded-full border-2 border-accent/40 [animation-delay:0.8s]" />
        <svg viewBox="0 0 28 26" className="relative h-7 w-8"><path d="M14 2 26.5 23.5h-25Z" fill="#2F5BFF" /></svg>
      </div>
      <div className="min-w-0">
        <p className="text-sm font-semibold">{left > 0 ? `Waiting for a reply · ${left}s` : 'Contacting drivers…'}</p>
        <div className="mt-2 flex items-center gap-1.5" aria-label={`${attempts} driver${attempts > 1 ? 's' : ''} asked`}>
          {Array.from({ length: Math.min(attempts, 6) }, (_, i) => (
            <span key={i} className={`h-1.5 rounded-full ${i === attempts - 1 ? 'w-6 bg-accent' : 'w-1.5 bg-muted/50'}`} />
          ))}
          <span className="ml-1 text-xs text-muted">one driver at a time, nearest first</span>
        </div>
      </div>
    </div>
  );
}

function useCancel(ride, onDone) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  async function cancel() {
    if (!window.confirm('Cancel this ride?')) return;
    setBusy(true);
    setError(null);
    try { onDone((await api.cancelRide(ride.id)).ride); } catch (e) { setError(e.message); onDone(null); } finally { setBusy(false); }
  }
  return { busy, error, cancel };
}

/** Sheet content for a ride (booking page after "Find driver", and /passenger/ride/:id). */
export function RideSheet({ ride, onChanged, onRetry }) {
  const { busy, error, cancel } = useCancel(ride, onChanged);
  const [, , , sub] = copyFor(ride);
  const { status } = ride;
  const searching = status === 'requested' || status === 'searching';
  const live = searching || status === 'accepted' || status === 'in_progress';
  const [safety, setSafety] = useState(false);
  const alerts = useRideAlerts(ride.id, status === 'in_progress' || status === 'accepted');

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <StatusBadge status={status} />
        <Headline ride={ride} />
        <p className="text-[15px] text-fg-soft">{sub}</p>
      </div>
      {live && <Timeline status={status} arrived={Boolean(ride.arrived_at)} />}
      {searching && <Matching ride={ride} />}
      {ride.arrived_at && status === 'accepted' && (
        <div className="cta-surface animate-pop flex items-center gap-3 rounded-3xl p-4" role="status">
          <BellRing className="h-6 w-6 shrink-0" aria-hidden />
          <p className="text-sm font-semibold">Your driver is waiting at the pickup point. We’ve sent you a message too.</p>
        </div>
      )}
      <AlertBanner alerts={alerts.data} onReview={() => setSafety(true)} />
      <EtaPill ride={ride} />
      {error && <Alert>{error}</Alert>}

      {['unmatched', 'cancelled', 'completed'].includes(status) && (
        <div className="flex flex-wrap gap-3">
          {status === 'unmatched'
            ? (onRetry
              ? <button className="btn-primary btn-lg flex-1" onClick={onRetry}><RotateCcw className="h-4 w-4" aria-hidden /> Try again</button>
              : <Link to="/passenger/book" className="btn-primary btn-lg flex-1"><RotateCcw className="h-4 w-4" aria-hidden /> Book again</Link>)
            : <Link to="/passenger/book" className="btn-primary btn-lg flex-1">Book another ride</Link>}
          <Link to="/passenger/dashboard" className="btn-outline btn-lg">Home</Link>
        </div>
      )}

      {ride.driver && <ContactCard title="Your driver" person={ride.driver} vehicle={ride.driver} verified={ride.driver.is_verified} />}
      {ride.driver && (status === 'accepted' || status === 'in_progress') && <ContactActions person={ride.driver} role="passenger" />}
      {(status === 'accepted' || status === 'in_progress') && (
        <div className="grid grid-cols-2 gap-3">
          <button className="btn-outline" onClick={() => setSafety(true)}><ShieldCheck className="h-4 w-4" aria-hidden /> Safety & share</button>
          <a href="tel:112" className="btn-danger"><ShieldAlert className="h-4 w-4" aria-hidden /> Emergency 112</a>
        </div>
      )}
      {safety && <SafetySheet ride={ride} alerts={alerts.data} onAlertsChanged={alerts.refresh} onClose={() => setSafety(false)} />}

      <div className="space-y-4">
        <Route pickup={ride.pickup.address} destination={ride.destination.address} compact />
        <FareTicket fare={ride} compact />
      </div>

      {ride.allowed_actions.includes('cancel') && (
        <button className="btn-danger w-full" onClick={cancel} disabled={busy}>{busy && <Spinner />} Cancel ride</button>
      )}
    </div>
  );
}

/** Map-first page for one ride: the map follows the trip, the sheet tells the story. */
export function RideCanvas({ rideId, onRetry, notice }) {
  const { data: ride, error, loading, setData, refresh } = useRide(rideId);
  const offset = useSheetOffset();
  // The live journey: the path driven so far, refreshed whenever a new position arrives (ride refetch).
  const onTrip = ride?.status === 'in_progress' || ride?.status === 'completed';
  const pathLive = useLive(() => api.ridePath(rideId).then((r) => r.points.filter((p) => p.status === 'in_progress')), { intervalMs: 8000, enabled: onTrip });
  const map = (
    <MapView fill pickup={ride?.pickup} destination={ride?.destination} driver={ride?.driver?.location} status={ride?.status} path={onTrip ? pathLive.data : null}
      searching={ride && (ride.status === 'searching' || ride.status === 'requested')} approach={ride?.status === 'accepted'} fitLeft={offset} />
  );
  return (
    <CanvasLayout map={map}>
      {notice}
      {loading ? <SkeletonCard lines={6} />
        : error && !ride ? <Alert>{error.status === 404 ? 'This ride could not be found.' : error.message}</Alert>
          : ride && (
            <>
              {error && <div className="mb-4"><Alert tone="warn">Connection problem, retrying… ({error.message})</Alert></div>}
              <RideSheet ride={ride} onRetry={onRetry} onChanged={(r) => (r ? setData(r) : refresh())} />
            </>
          )}
    </CanvasLayout>
  );
}

/** Compact live ride block for the passenger home sheet. */
export function LiveRideCard({ ride }) {
  const [, , , sub] = copyFor(ride);
  return (
    <section className="animate-rise space-y-4 rounded-3xl bg-ink p-5 text-white shadow-xl" aria-live="polite">
      <div className="flex items-center justify-between">
        <span className="inline-flex items-center gap-2 text-xs font-semibold text-volt">
          <span className="h-2 w-2 animate-pulse rounded-full bg-volt" /> Live ride
        </span>
        <span className="num text-xl font-semibold">{inr(ride.estimated_fare)}</span>
      </div>
      <div className="theme-night !bg-transparent"><Headline ride={ride} big={false} /></div>
      <p className="text-sm text-white/70">{sub}</p>
      {ride.driver && (
        <div className="flex items-center gap-3 rounded-2xl bg-white/5 p-3 ring-1 ring-white/10">
          <Avatar name={ride.driver.name} size="h-10 w-10 text-sm" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{ride.driver.name}</p>
            <Plate className="mt-1 scale-90 origin-left">{ride.driver.vehicle_registration}</Plate>
          </div>
          {ride.driver.phone && <a href={`tel:${ride.driver.phone.replace(/[^\d+]/g, '')}`} className="btn-volt btn-icon" aria-label="Call driver"><Phone className="h-4 w-4" aria-hidden /></a>}
        </div>
      )}
      <Link to={`/passenger/ride/${ride.id}`} className="flex items-center justify-between rounded-full bg-white px-5 py-3 text-sm font-semibold text-ink transition hover:bg-white/90">
        Track your ride <ArrowRight className="h-4 w-4" aria-hidden />
      </Link>
    </section>
  );
}
