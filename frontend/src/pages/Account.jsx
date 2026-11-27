import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Activity, ChevronDown, ChevronRight, LifeBuoy, LogOut, MapPin, Phone, Settings2, Share2, ShieldCheck, UserRound } from 'lucide-react';
import { Overview, SavedPlaces } from '../components/AccountParts.jsx';
import { EmergencyContacts } from '../components/Safety.jsx';
import { Page } from '../components/Layout.jsx';
import { useToast } from '../components/Toast.jsx';
import { Alert, Avatar, Plate, Segmented, Spinner, Switch, UnverifiedBadge } from '../components/ui.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useLiveData } from '../context/LiveContext.jsx';
import { useTheme } from '../context/ThemeContext.jsx';
import { DarkStylePicker } from '../components/ThemeMenu.jsx';
import { chime, setSoundEnabled, soundEnabled } from '../lib/chime.js';
import { shareTrip } from '../lib/share.js';
import { api } from '../services/api.js';

const readMap = () => { try { return localStorage.getItem('delta.map.mode') === 'google' ? 'google' : 'delta'; } catch { return 'delta'; } };
const writeMap = (v) => { try { localStorage.setItem('delta.map.mode', v); } catch { /* storage unavailable */ } };

function Section({ icon: Icon, title, children }) {
  return (
    <section className="card space-y-4">
      <h2 className="flex items-center gap-2 text-base font-semibold"><Icon className="h-4 w-4 text-muted" aria-hidden />{title}</h2>
      {children}
    </section>
  );
}

function Row({ title, hint, children }) {
  return (
    <div className="flex items-center justify-between gap-4 border-t border-line pt-4 first:border-0 first:pt-0">
      <div className="min-w-0"><p className="text-sm font-medium">{title}</p>{hint && <p className="text-xs text-muted">{hint}</p>}</div>
      {children}
    </div>
  );
}

const FAQ = [
  ['How is my fare calculated?', 'Base fare + distance × per-km rate + time × per-minute rate, using the road distance and time for your route. You see every line before you book.'],
  ['How are drivers matched?', 'We ask the nearest available driver first, give them 30 seconds, and move to the next nearest if they pass, within 5 km and then 10 km.'],
  ['Can I cancel?', 'Passengers can cancel while we’re finding a driver or before the trip starts. Drivers can cancel before starting the trip.'],
  ['Are drivers verified?', 'Not in this demo. Drivers are clearly labelled as unverified demo drivers and there is no licence or vehicle checking.'],
  ['Who sees my phone number?', 'Only the person you’re matched with, and only while the ride is active. It never appears in trip history.'],
];

/** Account for both roles: who you are, staying safe, how the app behaves, and help. */
export default function Account() {
  const { me, role, refresh, signOut } = useAuth();
  const live = useLiveData();
  const theme = useTheme();
  const { toast } = useToast();
  const isDriver = role === 'driver';
  const driver = live.driver ?? me.driver;

  const [form, setForm] = useState({
    full_name: me.profile.full_name, phone: me.profile.phone,
    vehicle_model: driver?.vehicle_model ?? '', vehicle_registration: driver?.vehicle_registration ?? '',
  });
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [mapMode, setMapMode] = useState(readMap);
  const [sound, setSound] = useState(soundEnabled);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body = {};
    if (form.full_name.trim() !== me.profile.full_name) body.full_name = form.full_name.trim();
    if (form.phone.trim() !== me.profile.phone) body.phone = form.phone.trim();
    if (isDriver && form.vehicle_model.trim() !== driver?.vehicle_model) body.vehicle_model = form.vehicle_model.trim();
    if (isDriver && form.vehicle_registration.trim().toUpperCase() !== driver?.vehicle_registration) body.vehicle_registration = form.vehicle_registration.trim();
    if (!Object.keys(body).length) { setEditing(false); setBusy(false); return; }
    try {
      await api.updateProfile(body);
      await refresh();
      live.refreshDriver?.();
      setEditing(false);
      toast({ tone: 'success', title: 'Profile saved' });
    } catch (err) {
      setError(err.details?.[0]?.message ?? err.message);
    } finally { setBusy(false); }
  }

  async function share() {
    const result = await shareTrip(live.activeRide);
    if (result === 'copied') toast({ tone: 'success', title: 'Trip details copied', body: 'Paste them into any chat to share.' });
    if (result === 'failed') toast({ tone: 'warn', title: 'Couldn’t share from this browser' });
  }

  return (
    <Page className="max-w-2xl space-y-6">
      {/* Identity */}
      <header className="flex items-center gap-5">
        <Avatar name={me.profile.full_name} size="h-20 w-20 text-2xl" />
        <div className="min-w-0">
          <p className="text-sm capitalize text-muted">{role} account</p>
          <h1 className="truncate text-[36px] font-semibold leading-tight"><span className="serif">{me.profile.full_name}</span></h1>
          <p className="truncate text-sm text-muted">{me.profile.email}</p>
        </div>
      </header>

      <Section icon={Activity} title={isDriver ? 'Driving summary' : 'Ride activity'}>
        {isDriver && (
          <Row title="Availability" hint={live.activeRide ? 'On a trip right now' : 'Change it from the Drive tab'}>
            <span className="chip"><span className={`h-2 w-2 rounded-full ${live.activeRide ? 'bg-accent' : live.online ? 'bg-live' : 'bg-muted'}`} />{live.activeRide ? 'On a trip' : live.online ? 'Online' : 'Offline'}</span>
          </Row>
        )}
        <Overview role={role} />
        <Link to={isDriver ? '/driver/earnings' : '/passenger/activity'} className="btn-outline w-full">
          {isDriver ? 'Completed trips & earnings' : 'All previous bookings'} <ChevronRight className="h-4 w-4" aria-hidden />
        </Link>
      </Section>

      <Section icon={UserRound} title="Profile">
        {!editing ? (
          <div className="space-y-4">
            <Row title="Phone" hint="Shared only with your match, only during a ride"><span className="mono whitespace-nowrap">{me.profile.phone}</span></Row>
            {isDriver && driver && (
              <Row title={driver.vehicle_model} hint="Your vehicle"><Plate>{driver.vehicle_registration}</Plate></Row>
            )}
            <Row title="Email" hint="Used to sign in"><span className="truncate text-sm">{me.profile.email}</span></Row>
            <Row title="Member since" hint={`Account #${me.user.id.slice(0, 8)} · ${role}`}>
              <span className="text-sm">{me.profile.created_at ? new Date(me.profile.created_at).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}</span>
            </Row>
            {isDriver && <div className="pt-1"><UnverifiedBadge /></div>}
            <button className="btn-outline w-full" onClick={() => setEditing(true)}>Edit profile</button>
          </div>
        ) : (
          <form onSubmit={save} className="animate-rise space-y-4">
            {error && <Alert>{error}</Alert>}
            <div><label className="label" htmlFor="acc-name">Full name</label><input id="acc-name" className="input" value={form.full_name} onChange={set('full_name')} required minLength={2} /></div>
            <div><label className="label" htmlFor="acc-phone">Phone</label><input id="acc-phone" type="tel" className="input" value={form.phone} onChange={set('phone')} required /></div>
            {isDriver && (
              <div className="grid gap-4 sm:grid-cols-2">
                <div><label className="label" htmlFor="acc-vm">Vehicle model</label><input id="acc-vm" className="input" value={form.vehicle_model} onChange={set('vehicle_model')} /></div>
                <div><label className="label" htmlFor="acc-vr">Registration</label><input id="acc-vr" className="input mono uppercase" value={form.vehicle_registration} onChange={set('vehicle_registration')} /></div>
              </div>
            )}
            <p className="text-xs text-muted">Your role ({role}) can’t be changed.</p>
            <div className="flex gap-3">
              <button className="btn-primary flex-1" disabled={busy}>{busy && <Spinner />} Save</button>
              <button type="button" className="btn-outline" onClick={() => { setEditing(false); setError(null); }}>Cancel</button>
            </div>
          </form>
        )}
      </Section>

      {!isDriver && (
        <Section icon={MapPin} title="Saved places">
          <SavedPlaces />
        </Section>
      )}

      <Section icon={ShieldCheck} title="Safety">
        <div id="safety" className="scroll-mt-24" />
        <p className="text-sm text-muted">In an emergency, call the national emergency number first.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <a href="tel:112" className="btn-lg inline-flex items-center justify-center gap-2 rounded-full bg-danger font-semibold text-white transition hover:brightness-110 active:scale-[0.97]">
            <Phone className="h-4 w-4" aria-hidden /> Call 112
          </a>
          <button className="btn-outline btn-lg" onClick={share} disabled={!live.activeRide} title={live.activeRide ? 'Share your current trip' : 'Available during a trip'}>
            <Share2 className="h-4 w-4" aria-hidden /> Share trip status
          </button>
        </div>
        {!live.activeRide && <p className="text-xs text-muted">Trip sharing becomes available while you’re on a ride. {isDriver ? 'It sends the route and trip status to someone you choose.' : 'During a ride, use “Safety & share” to send a live link that ends with the trip.'}</p>}
        <div className="border-t border-line pt-4"><EmergencyContacts /></div>
      </Section>

      <Section icon={Settings2} title="Preferences">
        <div className="space-y-4">
          <Row title="Appearance" hint={theme.mode === 'system' ? `Following your device (${theme.dark ? 'dark' : 'light'})` : 'Saved on this device'}>
            <Segmented label="Appearance" value={theme.mode} onChange={theme.setMode} options={[['light', 'Light'], ['dark', 'Dark'], ['system', 'System']]} />
          </Row>
          <div className="border-t border-line pt-4">
            <DarkStylePicker prompt={theme.dark && !theme.styleChosen} />
            {!theme.dark && <p className="mt-2 text-xs text-muted">Used whenever Delta is in dark mode.</p>}
          </div>
          <Row title="Default map" hint="You can still switch on any map">
            <Segmented label="Default map" value={mapMode} onChange={(v) => { setMapMode(v); writeMap(v); }} options={[['delta', 'Delta'], ['google', 'Google']]} />
          </Row>
          {isDriver && (
            <>
              <Row title="Request sound" hint="Chime and vibration for new requests">
                <Switch checked={sound} label="Request sound" onChange={() => { const v = !sound; setSound(v); setSoundEnabled(v); if (v) chime(); }} />
              </Row>
              <Row title="Keep location fresh" hint="Every 30 s while the app is open">
                <Switch checked={live.loc.auto} label="Keep location fresh" onChange={() => live.loc.setAuto(!live.loc.auto)} />
              </Row>
              <Row title="Location source" hint="Demo: a Bengaluru point that simulates driving during trips">
                <Segmented label="Location source" value={live.loc.source} onChange={live.loc.setSource} options={[['device', 'Device'], ['demo', 'Demo']]} />
              </Row>
            </>
          )}
        </div>
      </Section>

      {me.user.is_admin && (
        <Link to="/admin" className="cta-surface flex items-center gap-3 rounded-3xl p-5">
          <ShieldCheck className="h-6 w-6 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1"><span className="block font-semibold">Admin dashboard</span><span className="block text-sm opacity-75">Live rides, drivers, support inbox, users and the demo autopilot switch</span></span>
          <ChevronRight className="h-5 w-5" aria-hidden />
        </Link>
      )}

      <Section icon={LifeBuoy} title="Help">
        <Link to={`/${role}/support`} className="flex items-center gap-3 rounded-2xl bg-surface-2 p-4 ring-1 ring-line transition hover:ring-fg/30">
          <LifeBuoy className="h-5 w-5 text-accent" aria-hidden />
          <span className="min-w-0 flex-1"><span className="block text-sm font-semibold">Support centre</span><span className="block text-xs text-muted">Report a ride, fare, driver or lost-item problem and track your requests</span></span>
          <ChevronRight className="h-4 w-4 text-muted" aria-hidden />
        </Link>
        <div className="divide-y divide-line">
          {FAQ.map(([q, a]) => (
            <details key={q} className="group py-3 first:pt-0">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-medium">
                {q}<ChevronDown className="h-4 w-4 shrink-0 text-muted transition group-open:rotate-180" aria-hidden />
              </summary>
              <p className="mt-2 text-sm text-fg-soft">{a}</p>
            </details>
          ))}
        </div>
      </Section>

      <button onClick={signOut} className="btn-danger w-full"><LogOut className="h-4 w-4" aria-hidden /> Sign out</button>
      <p className="text-center text-xs text-muted"><Link to="/story" className="font-semibold text-fg hover:underline">Our story</Link> · Delta · hackathon demo build</p>
    </Page>
  );
}
