import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { BellRing, Navigation } from 'lucide-react';
import { useLive, useNow } from '../../hooks/useLive.js';
import { ContactActions } from '../../components/RideChat.jsx';
import { EtaPill } from '../../components/RideTracker.jsx';
import { useLiveData } from '../../context/LiveContext.jsx';
import { api } from '../../services/api.js';
import { inr } from '../../lib/format.js';
import { celebrate } from '../../lib/celebrate.js';
import CanvasLayout, { useSheetOffset } from '../../components/CanvasLayout.jsx';
import MapView from '../../components/MapView.jsx';
import SlideToConfirm from '../../components/SlideToConfirm.jsx';
import { Alert, SkeletonCard, StatusBadge } from '../../components/ui.jsx';
import { ContactCard, FareTicket, Route, Timeline } from '../../components/RideParts.jsx';

const firstName = (n = '') => n.replace(/\(.*?\)/g, '').trim().split(/\s+/)[0];
const waitText = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

function copy(ride) {
  const who = firstName(ride.passenger?.name) || 'your passenger';
  switch (ride.status) {
    case 'accepted': return ride.arrived_at
      ? ['Waiting for', who, 'You’ve arrived and the passenger has been notified. Start the trip once they’re in the car.']
      : ['Pick up', who, 'Head to the pickup point. Slide “Arrived” when you get there: the passenger is notified instantly.'];
    case 'in_progress': return ['Drive to', 'drop-off', 'Complete the trip when you arrive.'];
    case 'completed': return ['Trip', 'complete', 'Nicely done. You’re available for new requests.'];
    case 'cancelled': return ['Ride', 'cancelled', `Cancelled by ${ride.cancelled_by === 'driver' ? 'you' : 'the passenger'}. You’re available again.`];
    default: return ['Your', 'trip', ''];
  }
}

export default function DriverRide() {
  const { id } = useParams();
  const shell = useLiveData();
  const offset = useSheetOffset();
  const { data: ride, error, loading, refresh, setData } = useLive(() => api.getRide(id).then((r) => r.ride), {
    intervalMs: 4000, realtime: { table: 'rides', filter: `id=eq.${id}` },
  });
  const [busy, setBusy] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [skipArrive, setSkipArrive] = useState(false);

  async function run(name, fn, confirmText) {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(name);
    setActionError(null);
    try {
      const { ride: next } = await fn(id);
      setData(next);
      shell.refreshRide();
      if (name === 'complete') celebrate();
    } catch (e) {
      setActionError(e.message);
      if (name === 'arrive' && e.code === 'MIGRATION_REQUIRED') setSkipArrive(true); // older database: allow starting anyway
      refresh();
    } finally { setBusy(null); }
  }
  const now = useNow(1000);

  const map = (
    <MapView fill pickup={ride?.pickup} destination={ride?.destination}
      driver={shell.driver?.location} driverLabel="You" approach={ride?.status === 'accepted'} status={ride?.status} pickupLabel="Passenger" fitLeft={offset} />
  );

  if (loading) return <CanvasLayout map={map}><SkeletonCard lines={6} /></CanvasLayout>;
  if (error && !ride) return <CanvasLayout map={map}><Alert>{error.status === 404 ? 'This ride could not be found.' : error.message}</Alert></CanvasLayout>;

  const can = (a) => ride.allowed_actions.includes(a);
  const navTarget = ride.status === 'accepted' ? ride.pickup : ride.destination;
  const finished = ['completed', 'cancelled'].includes(ride.status);
  const [lead, accent, sub] = copy(ride);

  return (
    <CanvasLayout map={map}>
      <div className="space-y-6">
        <div className="space-y-3">
          <StatusBadge status={ride.status} />
          <h1 className="text-[38px] font-semibold leading-[1.04]">{lead} <span className="serif text-live">{accent}</span></h1>
          <p className="text-[15px] text-fg-soft">{sub}</p>
        </div>

        {ride.status === 'completed' && (
          <div className="cta-surface animate-pop rounded-3xl p-5">
            <p className="text-xs font-semibold uppercase tracking-widest">Trip fare</p>
            <p className="num mt-1 text-5xl font-semibold">{inr(ride.estimated_fare)}</p>
          </div>
        )}
        {!finished && <Timeline status={ride.status} arrived={Boolean(ride.arrived_at)} />}
        {actionError && <Alert>{actionError}</Alert>}
        <EtaPill ride={ride} forDriver />
        {ride.arrived_at && ride.status === 'accepted' && (
          <div className="flex items-center gap-3 rounded-2xl bg-success/10 px-4 py-3 text-sm ring-1 ring-success/30" role="status">
            <BellRing className="h-5 w-5 shrink-0 text-success" aria-hidden />
            <p><span className="font-semibold">Passenger notified</span> · waiting {waitText(now - new Date(ride.arrived_at))}</p>
          </div>
        )}
        {!finished && (
          <a className="btn-outline w-full" target="_blank" rel="noreferrer"
            href={`https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=${navTarget.latitude},${navTarget.longitude}`}>
            <Navigation className="h-4 w-4" aria-hidden /> Navigate to {ride.status === 'accepted' ? 'pickup' : 'drop-off'} in Google Maps
          </a>
        )}

        {can('arrive') && !skipArrive && <SlideToConfirm key="arrive" label="Slide when you’ve arrived" tone="volt" busy={busy === 'arrive'} onConfirm={() => run('arrive', api.markArrived)} />}
        {can('start') && (ride.arrived_at || skipArrive) && <SlideToConfirm key="start" label="Slide to start trip" tone="accent" busy={busy === 'start'} onConfirm={() => run('start', api.startRide)} />}
        {can('complete') && <SlideToConfirm key="complete" label="Slide to complete trip" tone="volt" busy={busy === 'complete'} onConfirm={() => run('complete', api.completeRide)} />}
        {finished && <Link to="/driver/dashboard" className="btn-volt btn-lg w-full">Back to the cockpit</Link>}

        {ride.passenger && <ContactCard title="Passenger" person={ride.passenger} />}
        {ride.passenger && !finished && <ContactActions person={ride.passenger} role="driver" />}
        <Route pickup={ride.pickup.address} destination={ride.destination.address} compact />
        <FareTicket fare={ride} compact />

        {can('cancel') && (
          <button className="w-full py-2 text-sm font-semibold text-danger hover:underline" disabled={Boolean(busy)}
            onClick={() => run('cancel', api.cancelRide, 'Cancel this ride? The passenger will be notified.')}>Cancel this ride</button>
        )}
      </div>
    </CanvasLayout>
  );
}
