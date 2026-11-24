import { Check, X } from 'lucide-react';
import { useCountdown } from '../hooks/useLive.js';
import { useLiveData } from '../context/LiveContext.jsx';
import { inr, km, mins } from '../lib/format.js';
import { Route } from './RideParts.jsx';
import { Alert, Spinner } from './ui.jsx';
import LiveMap from './LiveMap.jsx';

const TTL = 30;

function Ring({ left }) {
  const r = 26, c = 2 * Math.PI * r;
  const urgent = left <= 8;
  return (
    <div className="relative grid h-16 w-16 shrink-0 place-items-center" aria-label={`${left} seconds left`}>
      <svg viewBox="0 0 60 60" className="absolute inset-0 -rotate-90">
        <circle cx="30" cy="30" r={r} fill="none" stroke="currentColor" className="text-line" strokeWidth="5" />
        <circle cx="30" cy="30" r={r} fill="none" stroke={urgent ? '#E5484D' : '#D7FF3C'} strokeWidth="5" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - Math.min(1, left / TTL))} style={{ transition: 'stroke-dashoffset 0.3s linear' }} />
      </svg>
      <span className={`num text-xl font-semibold ${urgent ? 'text-danger' : ''}`}>{left}</span>
    </div>
  );
}

const coords = (lat, lng) => (lat != null && lng != null ? { latitude: lat, longitude: lng } : null);

/** An incoming request. The fare and the two actions are the loudest things on screen. */
export function OfferCard({ offer, onAccept, onReject, busy, withMap = true }) {
  const left = useCountdown(offer.seconds_left, offer.id) ?? 0;
  const expired = left === 0;
  const { driver } = useLiveData();
  const pickup = coords(offer.pickup_latitude, offer.pickup_longitude);
  const destination = coords(offer.destination_latitude, offer.destination_longitude);
  return (
    <section className="sheet animate-pop overflow-hidden" aria-label="Incoming ride request">
      {withMap && pickup && (
        <div className="relative h-44">
          <LiveMap fill interactive={false} pickup={pickup} destination={destination} you={driver?.location} pickupLabel="Pickup" />
          <span className="chip absolute left-3 top-3 z-[500] !bg-ink/80 !text-white !ring-white/10 backdrop-blur">New request</span>
        </div>
      )}
      <div className="space-y-5 p-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="num text-[44px] font-semibold leading-none">{inr(offer.estimated_fare)}</p>
            <p className="mt-2 text-sm text-fg-soft">
              {offer.pickup_distance_km != null && <><span className="font-semibold text-fg">{km(offer.pickup_distance_km)}</span> to pickup · </>}
              {km(offer.distance_km)} · {mins(offer.duration_minutes)} trip
            </p>
          </div>
          <Ring left={left} />
        </div>
        <Route pickup={offer.pickup_address} destination={offer.destination_address} compact />
        {expired && <p className="text-sm font-medium text-danger">This request expired and moved to the next driver.</p>}
        <div className="grid grid-cols-[1fr_2fr] gap-3">
          <button className="btn-outline btn-lg" disabled={busy || expired} onClick={() => onReject(offer)}><X className="h-5 w-5" aria-hidden /> Pass</button>
          <button className="btn-volt btn-lg" disabled={busy || expired} onClick={() => onAccept(offer)}>
            {busy ? <Spinner /> : <Check className="h-5 w-5" aria-hidden />} Accept
          </button>
        </div>
      </div>
    </section>
  );
}

/** Full-screen takeover so a driver never misses a request, whichever page they're on. */
export function OfferTakeover({ offer }) {
  const live = useLiveData();
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-3 backdrop-blur-sm sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-label="Incoming ride request">
      <div className="w-full max-w-md space-y-3">
        {live.offerError && <Alert>{live.offerError}</Alert>}
        <OfferCard offer={offer} busy={live.busyOfferId === offer.id} onAccept={live.acceptOffer} onReject={live.rejectOffer} />
      </div>
    </div>
  );
}

export default OfferCard;
