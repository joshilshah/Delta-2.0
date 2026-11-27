import { useParams } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';
import { Logo } from '../components/Layout.jsx';
import LiveMap from '../components/LiveMap.jsx';
import { Route } from '../components/RideParts.jsx';
import { Alert, Plate, SkeletonCard, StatusBadge, UnverifiedBadge } from '../components/ui.jsx';
import { useLive } from '../hooks/useLive.js';
import { timeAgo } from '../lib/format.js';
import { getSharedTrip } from '../services/api.js';

const HEAD = {
  accepted: (t) => (t.arrived_at ? `${t.driver?.first_name} has arrived at the pickup` : `${t.driver?.first_name} is on the way to pick up ${t.passenger_first_name}`),
  in_progress: (t) => `${t.passenger_first_name} is on the way`,
  completed: (t) => `${t.passenger_first_name} has arrived`,
  cancelled: () => 'This trip was cancelled',
};

/**
 * Public trip-follow page, opened from a share link. No sign-in: the unguessable token is the only key.
 * Shows only what a trusted contact needs; the link dies when the trip ends, expires, or is turned off.
 */
export default function SharedTrip() {
  const { token } = useParams();
  const { data, error, loading } = useLive(() => getSharedTrip(token), { intervalMs: 8000 });
  // Once the link is revoked or expired (404), drop everything already on screen: nothing stale may linger.
  const gone = error?.status === 404;
  const trip = gone ? null : data;
  const live = trip && ['accepted', 'in_progress'].includes(trip.status);

  return (
    <div className="min-h-screen bg-canvas">
      <header className="flex h-16 items-center justify-between border-b border-line px-4 sm:px-6">
        <Logo />
        <span className="chip"><ShieldCheck className="h-3.5 w-3.5" aria-hidden />Shared trip</span>
      </header>
      <main className="mx-auto grid max-w-5xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[1fr_380px]">
        <div className="h-[46vh] overflow-hidden rounded-3xl ring-1 ring-line lg:h-[70vh]">
          {trip && <LiveMap fill pickup={trip.pickup} destination={trip.destination} driver={trip.driver?.location} approach={trip.status === 'accepted'} />}
        </div>
        <section className="space-y-5">
          {loading ? <SkeletonCard lines={6} /> : error && !trip ? (
            <Alert>{gone ? 'This trip link has expired or was turned off.' : error.message}</Alert>
          ) : trip && (
            <>
              <div className="space-y-2">
                <StatusBadge status={trip.status} />
                <h1 className="text-[28px] font-semibold leading-tight">{(HEAD[trip.status] ?? (() => 'Trip update'))(trip)}</h1>
                {trip.eta && live && <p className="text-fg-soft">About {trip.eta.minutes} min to {trip.eta.target === 'pickup' ? 'pickup' : 'drop-off'} (estimate)</p>}
                {trip.driver?.location && live && <p className="text-xs text-muted">Location updated {timeAgo(trip.driver.location.updated_at)} · refreshes automatically</p>}
              </div>
              {trip.driver && (
                <div className="card space-y-3">
                  <p className="eyebrow">Driver</p>
                  <p className="text-lg font-semibold">{trip.driver.first_name} · {trip.driver.vehicle_model}</p>
                  <div className="flex flex-wrap items-center gap-2"><Plate>{trip.driver.vehicle_registration}</Plate>{!trip.driver.is_verified && <UnverifiedBadge />}</div>
                </div>
              )}
              <div className="card"><Route pickup={trip.pickup.address} destination={trip.destination.address} compact /></div>
              <p className="text-xs text-muted">Shared by {trip.passenger_first_name} with Delta. This page never shows phone numbers. It stops showing the live location when the trip ends and expires at {new Date(trip.link_expires_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}. If you believe someone is in danger, call 112.</p>
            </>
          )}
        </section>
      </main>
    </div>
  );
}
