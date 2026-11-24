import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, ChevronDown, Crosshair, Power } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.jsx';
import { useLiveData } from '../../context/LiveContext.jsx';
import { useNow } from '../../hooks/useLive.js';
import { api } from '../../services/api.js';
import { setSoundEnabled, soundEnabled, chime } from '../../lib/chime.js';
import CanvasLayout, { useSheetOffset } from '../../components/CanvasLayout.jsx';
import MapView from '../../components/MapView.jsx';
import SlideToConfirm from '../../components/SlideToConfirm.jsx';
import { Route } from '../../components/RideParts.jsx';
import { Alert, Plate, Segmented, SkeletonCard, Spinner, StatusBadge, Switch, UnverifiedBadge } from '../../components/ui.jsx';

const STALE_AFTER_S = 120; // matches the backend's LOCATION_STALE_SECONDS default
const firstName = (n = '') => n.replace(/\(.*?\)/g, '').trim().split(/\s+/)[0];
const greeting = () => { const h = new Date().getHours(); return h < 5 ? 'Late shift' : h < 12 ? 'Morning' : h < 17 ? 'Afternoon' : 'Evening'; };
const ago = (s) => (s < 5 ? 'just now' : s < 60 ? `${s}s ago` : `${Math.floor(s / 60)}m ago`);

function LocationRow({ driver, loc }) {
  const now = useNow(1000);
  const updated = driver?.location ? new Date(driver.location.updated_at).getTime() : null;
  const age = updated ? Math.max(0, Math.round((now - updated) / 1000)) : null;
  const fresh = age != null && age < STALE_AFTER_S;
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-full ${fresh ? 'bg-live/15 text-live' : 'bg-amber-400/15 text-amber-300'}`}>
          <Crosshair className="h-4 w-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{fresh ? 'Location live' : age != null ? 'Location is stale' : 'Waiting for your location'}</p>
          <p className="text-xs text-muted">{age != null ? `Updated ${ago(age)}${loc.source === 'demo' ? ' · demo point' : ''}` : 'Riders can’t find you until it arrives'}</p>
        </div>
        <button className="btn-outline !px-3.5 !py-2 text-xs" onClick={() => loc.share()} disabled={loc.status === 'asking'}>
          {loc.status === 'asking' ? <Spinner /> : 'Update'}
        </button>
      </div>
      {(loc.status === 'denied' || loc.status === 'unsupported' || (loc.status === 'error' && loc.message)) && <Alert tone="warn">{loc.message}</Alert>}
    </div>
  );
}

export default function DriverDashboard() {
  const { me } = useAuth();
  const live = useLiveData();
  const { driver, online, activeRide, loc } = live;
  const offset = useSheetOffset();
  const [toggling, setToggling] = useState(false);
  const [toggleError, setToggleError] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [sound, setSound] = useState(soundEnabled);

  async function setOnline(next) {
    setToggling(true);
    setToggleError(null);
    try { live.setDriver((await api.setAvailability(next)).driver); } catch (e) { setToggleError(e.message); } finally { setToggling(false); }
  }
  function toggleSound() { const v = !sound; setSound(v); setSoundEnabled(v); if (v) chime(); }

  const onTrip = Boolean(activeRide);
  const map = (
    <MapView fill driver={driver?.location} driverLabel="You" pickup={activeRide?.pickup} destination={activeRide?.destination}
      status={activeRide?.status} approach={activeRide?.status === 'accepted'} fitLeft={offset} pickupLabel="Passenger"
      overlay={!online ? <span className="chip pointer-events-auto !bg-ink/80 !text-white !ring-white/10 shadow backdrop-blur">You’re offline</span> : null} />
  );

  return (
    <CanvasLayout map={map}>
      <div className="space-y-6">
        <header className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm text-muted">{greeting()},</p>
            <h1 className="text-[40px] font-semibold leading-[1.02]"><span className="serif text-live">{firstName(me.profile.full_name)}</span></h1>
          </div>
          {driver && <div className="flex flex-col items-end gap-2 pt-2"><Plate>{driver.vehicle_registration}</Plate><span className="text-xs text-muted">{driver.vehicle_model}</span></div>}
        </header>

        {onTrip && (
          <Link to={`/driver/ride/${activeRide.id}`} className="cta-surface block rounded-3xl p-5 transition hover:brightness-95">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-widest">Active trip</span>
              <span className="inline-flex items-center gap-1 text-sm font-semibold">Open <ArrowRight className="h-4 w-4" aria-hidden /></span>
            </div>
            <div>
              <Route pickup={activeRide.pickup.address} destination={activeRide.destination.address} compact />
            </div>
          </Link>
        )}

        {!driver ? <SkeletonCard lines={3} /> : !online ? (
          <section className="space-y-4 rounded-3xl bg-surface-2 p-5 ring-1 ring-line">
            <div>
              <h2 className="text-2xl font-semibold">You’re <span className="serif">offline</span></h2>
              <p className="mt-1 text-sm text-muted">Go online to start receiving ride requests nearby. We’ll ask to use your location.</p>
            </div>
            <SlideToConfirm label="Slide to go online" busy={toggling} onConfirm={() => setOnline(true)} />
            {toggleError && <Alert>{toggleError}</Alert>}
          </section>
        ) : (
          <section className="space-y-5 rounded-3xl bg-surface-2 p-5 ring-1 ring-line">
            <div className="flex items-center gap-4">
              <div className="relative grid h-14 w-14 shrink-0 place-items-center">
                {!onTrip && <>
                  <span className="absolute inset-0 animate-radar rounded-full border-2 border-live/60" />
                  <span className="absolute inset-0 animate-radar rounded-full border-2 border-live/40 [animation-delay:1.2s]" />
                </>}
                <span className="cta-surface grid h-10 w-10 place-items-center rounded-full"><Power className="h-5 w-5" aria-hidden /></span>
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="text-xl font-semibold">{onTrip ? 'On a trip' : 'Looking for requests'}</h2>
                <p className="text-sm text-muted">{onTrip ? 'New requests are paused until this trip ends.' : 'Nearest-driver-first. A request will take over your screen.'}</p>
              </div>
            </div>
            <LocationRow driver={driver} loc={loc} />
            <div className="flex items-center justify-between gap-3 border-t border-line pt-4">
              <button className="inline-flex items-center gap-1 text-xs font-medium text-muted hover:text-fg" onClick={() => setShowSettings((v) => !v)} aria-expanded={showSettings}>
                Settings <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showSettings ? 'rotate-180' : ''}`} aria-hidden />
              </button>
              <button className="btn-outline !py-2 text-xs" onClick={() => setOnline(false)} disabled={toggling || onTrip} title={onTrip ? 'Finish your trip first' : undefined}>
                {toggling ? <Spinner /> : <Power className="h-3.5 w-3.5" aria-hidden />} Go offline
              </button>
            </div>
            {toggleError && <Alert>{toggleError}</Alert>}
            {showSettings && (
              <div className="animate-rise space-y-4 rounded-2xl bg-surface p-4 text-sm ring-1 ring-line">
                <div className="flex items-center justify-between gap-4">
                  <div><p className="font-medium">Keep location fresh</p><p className="text-xs text-muted">Every 30 s while the app is open (10 s on a trip). Never in the background.</p></div>
                  <Switch checked={loc.auto} onChange={() => loc.setAuto(!loc.auto)} label="Keep location fresh" />
                </div>
                <div className="flex items-center justify-between gap-4 border-t border-line pt-4">
                  <div><p className="font-medium">Request sound</p><p className="text-xs text-muted">A soft chime and vibration for new requests.</p></div>
                  <Switch checked={sound} onChange={toggleSound} label="Request sound" />
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
                  <div><p className="font-medium">Location source</p><p className="text-xs text-muted">“Demo” is a fixed Bengaluru point for testing.</p></div>
                  <Segmented label="Location source" value={loc.source} onChange={loc.setSource} options={[['device', 'My device'], ['demo', 'Demo']]} />
                </div>
              </div>
            )}
          </section>
        )}

        {activeRide && <StatusBadge status={activeRide.status} />}
        <div className="flex items-center justify-between gap-3 text-xs text-muted">
          <UnverifiedBadge />
          <span>Delta driver · demo build</span>
        </div>
      </div>
    </CanvasLayout>
  );
}
