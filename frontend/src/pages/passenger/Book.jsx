import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ArrowUpDown, MousePointerClick, Search } from 'lucide-react';
import PlaceInput from '../../components/PlaceInput.jsx';
import { RideCanvas } from '../../components/RideTracker.jsx';
import CanvasLayout, { useSheetOffset } from '../../components/CanvasLayout.jsx';
import MapView from '../../components/MapView.jsx';
import { RecentChips, SavedChips } from '../../components/RecentPlaces.jsx';
import { FareTicket } from '../../components/RideParts.jsx';
import { Alert, SkeletonCard, Spinner } from '../../components/ui.jsx';
import { useLiveData } from '../../context/LiveContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { locateMe, reverseGeocode } from '../../lib/geo.js';
import { inr } from '../../lib/format.js';
import { api } from '../../services/api.js';

const newKey = () => `bk-${crypto.randomUUID()}`;
const firstName = (n = '') => n.replace(/\(.*?\)/g, '').trim().split(/\s+/)[0];
const greeting = () => {
  const h = new Date().getHours();
  return h < 5 ? 'Up late' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
};

function Steps({ step }) {
  const steps = ['Route', 'Fare', 'Driver'];
  return (
    <ol className="flex items-center gap-2 text-xs font-medium" aria-label="Booking steps">
      {steps.map((s, i) => (
        <li key={s} className="flex items-center gap-2">
          <span className={`grid h-6 w-6 place-items-center rounded-full text-[11px] font-semibold transition ${i < step ? 'bg-accent text-white' : i === step ? 'bg-fg text-canvas' : 'bg-surface-2 text-muted ring-1 ring-line'}`}>{i + 1}</span>
          <span className={i <= step ? 'text-fg' : 'text-muted'}>{s}</span>
          {i < steps.length - 1 && <span className={`h-px w-5 ${i < step ? 'bg-accent' : 'bg-line'}`} />}
        </li>
      ))}
    </ol>
  );
}

export default function PassengerBook() {
  const { activeRide, rideLoading, refreshRide } = useLiveData();
  const { me } = useAuth();
  const routeState = useLocation().state; // the home sheet can hand over a destination to book again
  const offset = useSheetOffset();
  const [pickup, setPickup] = useState(null);
  const [destination, setDestination] = useState(() => routeState?.destination ?? null);
  const [saved, setSaved] = useState([]);
  const [recent, setRecent] = useState({ destinations: [], pickups: [] });
  const [fare, setFare] = useState(null);
  const [fareError, setFareError] = useState(null);
  const [estimating, setEstimating] = useState(false);
  const [rideId, setRideId] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [locating, setLocating] = useState(false);
  const [locateError, setLocateError] = useState(null);
  const [dropping, setDropping] = useState(false);
  const key = useRef(newKey()); // one idempotency key per booking attempt

  // Use the customer's own location as the pickup (permission-based; they can still type another one).
  const useMyLocation = useCallback(async () => {
    setLocating(true);
    setLocateError(null);
    try {
      const here = await locateMe();
      setPickup(here);
      setFare(null);
      setFareError(null);
    } catch (e) {
      setLocateError(e.message);
    } finally {
      setLocating(false);
    }
  }, []);

  useEffect(() => {
    let live = true;
    api.recentPlaces().then((r) => live && setRecent(r)).catch(() => {}); // a convenience: never block booking
    api.savedPlaces().then((r) => live && setSaved(r.places)).catch(() => {});
    return () => { live = false; };
  }, []);

  // Ask once on arrival (useMyLocation is stable, so this does not re-run on re-renders).
  useEffect(() => {
    const t = setTimeout(useMyLocation, 0);
    return () => clearTimeout(t);
  }, [useMyLocation]);

  // Price the trip on the server whenever both locations are confirmed.
  useEffect(() => {
    if (!pickup || !destination) return undefined;
    let cancelled = false;
    const t = setTimeout(() => {
      setFare(null);
      setFareError(null);
      setEstimating(true);
      api.estimateFare(pickup, destination)
        .then((f) => !cancelled && setFare(f))
        .catch((e) => !cancelled && setFareError(e.message))
        .finally(() => !cancelled && setEstimating(false));
    }, 300);
    return () => { cancelled = true; clearTimeout(t); };
  }, [pickup, destination]);

  function changePickup(p) { setPickup(p); setFare(null); setFareError(null); if (p) setLocateError(null); }
  function changeDestination(d) { setDestination(d); setFare(null); setFareError(null); }
  function swap() { const p = pickup; changePickup(destination); changeDestination(p); }

  // Tap the map: sets the drop-off (or the pickup, if there isn't one yet).
  async function onMapClick(pt) {
    if (dropping) return;
    setDropping(true);
    const place = { ...pt, address: await reverseGeocode(pt.latitude, pt.longitude) };
    setDropping(false);
    if (!pickup) changePickup(place); else changeDestination(place);
  }

  async function findDriver() {
    if (submitting || !pickup || !destination || !fare) return; // guards repeated clicks
    setSubmitting(true);
    setSubmitError(null);
    try {
      const { ride } = await api.createRide(pickup, destination, key.current);
      setRideId(ride.id);
      refreshRide(); // home, nav and banners switch to this booking immediately
    } catch (e) {
      if (e.code === 'ACTIVE_RIDE_EXISTS' && e.details?.ride_id) setRideId(e.details.ride_id);
      else setSubmitError(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  function retry() {
    key.current = newKey();
    setRideId(null);
    refreshRide();
  }

  const trackedId = rideId ?? activeRide?.id;
  if (trackedId) {
    return (
      <RideCanvas rideId={trackedId} onRetry={retry} notice={!rideId && !submitting ? (
        <div className="mb-5"><Alert tone="info">You already have a ride in progress, so a new booking is paused. <Link to={`/passenger/ride/${trackedId}`} className="font-semibold underline">Open it</Link></Alert></div>
      ) : null} />
    );
  }

  const ready = pickup && destination && fare && !estimating;
  const step = !pickup || !destination ? 0 : 1;
  const hint = !pickup ? 'Tap the map to set your pickup' : !destination ? 'Tap the map to drop your destination' : null;

  const map = (
    <MapView fill pickup={pickup} destination={destination} pickupLabel={destination ? 'Pickup' : 'You are here'}
      places={!destination ? recent.destinations.slice(0, 6) : []} onPlaceClick={changeDestination}
      onMapClick={onMapClick} fitLeft={offset}
      overlay={hint ? (
        <span className="chip pointer-events-auto bg-fg! text-canvas! shadow-lg ring-0!">
          {dropping ? <Spinner className="h-3.5 w-3.5" /> : <MousePointerClick className="h-3.5 w-3.5" aria-hidden />} {hint}
        </span>
      ) : null} />
  );

  if (rideLoading && !activeRide) return <CanvasLayout map={map}><SkeletonCard lines={5} /></CanvasLayout>;

  return (
    <CanvasLayout map={map}>
      <div className="space-y-6">
        <header className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted">{greeting()}</p>
            <Steps step={step} />
          </div>
          <h1 className="text-[40px] font-semibold leading-[1.02]">Where to, <span className="serif text-accent">{firstName(me.profile.full_name)}</span>?</h1>
        </header>

        <div className="rounded-3xl bg-surface-2 p-4 ring-1 ring-line">
          <PlaceInput label="Pickup" placeholder="Where should we pick you up?" value={pickup} onChange={changePickup}
            variant="pickup" onLocate={useMyLocation} locating={locating} near={pickup ?? destination} />
          <div className="relative my-3 flex items-center" aria-hidden={!(pickup && destination)}>
            <span className="h-px flex-1 border-t border-dashed border-line" />
            <button type="button" onClick={swap} disabled={!(pickup && destination)}
              className="mx-3 grid h-9 w-9 place-items-center rounded-full bg-surface text-fg shadow-sm ring-1 ring-line transition duration-300 hover:rotate-180 disabled:opacity-35" aria-label="Swap pickup and drop-off" title="Swap pickup and drop-off">
              <ArrowUpDown className="h-4 w-4" aria-hidden />
            </button>
            <span className="h-px w-6 border-t border-dashed border-line" />
          </div>
          <PlaceInput label="Drop-off" placeholder="Search a hostel, mall, station…" value={destination} onChange={changeDestination}
            variant="destination" near={pickup} />
        </div>
        {locateError && <Alert tone="warn">{locateError}</Alert>}

        {!destination && <SavedChips places={saved} onPick={changeDestination} />}
        {!pickup && <RecentChips places={recent.pickups.slice(0, 4)} onPick={changePickup} label="Recent pickups" />}
        {!destination && <RecentChips places={recent.destinations.slice(0, 6)} onPick={changeDestination} label="Recent destinations" />}

        {estimating && <div className="rounded-3xl bg-surface-2 p-5 ring-1 ring-line"><SkeletonCard lines={3} /></div>}
        {fareError && <Alert>{fareError}</Alert>}
        {fare && !estimating && <div className="animate-rise"><FareTicket fare={fare} /></div>}
        {submitError && <Alert>{submitError}</Alert>}

        {/* Phones: pinned above the tab bar only once the trip can be booked, so it never covers the form while filling it in. */}
        <div className={`${ready ? 'sticky bottom-20 z-10 -mx-5 bg-gradient-to-t from-surface via-surface to-transparent px-5 pb-4 pt-8' : ''} lg:sticky lg:bottom-0 lg:z-10 lg:-mx-6 lg:-mb-6 lg:bg-gradient-to-t lg:from-surface lg:via-surface lg:to-transparent lg:px-6 lg:pb-6 lg:pt-6`}>
          <button className="btn-accent btn-lg w-full justify-between !pl-6" disabled={!ready || submitting} onClick={findDriver}>
            <span className="flex items-center gap-2">{submitting ? <Spinner /> : <Search className="h-5 w-5" aria-hidden />} {submitting ? 'Finding your driver…' : 'Find driver'}</span>
            {fare && <span className="num rounded-full bg-white/15 px-3 py-1 text-sm">{inr(fare.estimated_fare)}</span>}
          </button>
        </div>
      </div>
    </CanvasLayout>
  );
}
