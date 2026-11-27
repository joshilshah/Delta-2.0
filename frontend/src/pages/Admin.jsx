import { useMemo, useState } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import {
  Activity, ArrowLeft, Bot, Car, CircleDollarSign, Inbox, LayoutDashboard, LifeBuoy, LogOut, Radio, Search, ShieldCheck,
  Users, UserRound,
} from 'lucide-react';
import { Logo } from '../components/Layout.jsx';
import ThemeMenu from '../components/ThemeMenu.jsx';
import { useToast } from '../components/Toast.jsx';
import { Alert, EmptyState, FullPageSpinner, Segmented, SkeletonCard, Spinner, StatusBadge, Switch } from '../components/ui.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useLive } from '../hooks/useLive.js';
import { inr, timeAgo } from '../lib/format.js';
import { api } from '../services/api.js';

const TABS = [
  ['overview', 'Overview', LayoutDashboard],
  ['rides', 'Rides', Car],
  ['drivers', 'Drivers', Radio],
  ['support', 'Support', LifeBuoy],
  ['users', 'Users', Users],
];
const short = (a = '') => a.split(',').slice(0, 2).join(',');
const clock = (iso) => (iso ? new Date(iso).toLocaleString([], { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '—');
// ride_log times are plain India Standard Time clock values (no offset): read them as IST, show them as IST.
const ist = (s) => (s
  ? `${new Date(`${s}+05:30`).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })} IST`
  : '—');

function Stat({ icon: Icon, label, value, hint, tone = '' }) {
  return (
    <div className="rounded-3xl bg-surface p-5 ring-1 ring-line">
      <p className="flex items-center gap-2 text-xs text-muted"><Icon className="h-4 w-4" aria-hidden />{label}</p>
      <p className={`num mt-2 text-3xl font-semibold ${tone}`}>{value}</p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}

/** The demo autopilot switch: on = demo drivers take rides on their own when nobody else is available. */
function AutopilotCard({ autopilot, onChanged }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  async function flip() {
    setBusy(true); setError(null);
    try {
      const r = await api.admin.setAutopilot(!autopilot.enabled);
      onChanged(r.autopilot);
      toast({ tone: 'success', title: `Demo autopilot ${r.autopilot.enabled ? 'on' : 'off'}`, body: r.autopilot.enabled ? 'Demo drivers will take rides when nobody else is available.' : 'Demo drivers are off duty. Trips already under way will finish.' });
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  return (
    <section className={`rounded-3xl p-5 ring-1 sm:p-6 ${autopilot.enabled ? 'cta-surface ring-transparent' : 'bg-surface ring-line'}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-semibold"><Bot className="h-5 w-5" aria-hidden />Demo autopilot</p>
          <p className="mt-1 text-2xl font-semibold">{autopilot.enabled ? 'On' : 'Off'}</p>
          <p className="mt-1 max-w-md text-sm opacity-75">
            When on, demo drivers accept a ride, drive to the rider, arrive, and complete the trip by themselves whenever no other driver is available. Ideal for demos with just the rider app.
          </p>
          <p className="mt-2 text-xs opacity-60">
            {autopilot.source === 'admin' ? `Set here ${autopilot.updated_at ? timeAgo(autopilot.updated_at) : ''}` : `Default from DEMO_AUTOPILOT (${autopilot.env_default ? 'on' : 'off'})`}
            {' · '}takes effect within ~10 s
          </p>
        </div>
        {busy ? <Spinner /> : <Switch checked={autopilot.enabled} onChange={flip} label="Demo autopilot" />}
      </div>
      {error && <div className="mt-3"><Alert>{error}</Alert></div>}
      <ul className="mt-4 grid gap-2 sm:grid-cols-2">
        {autopilot.drivers.map((d) => (
          <li key={d.id} className="flex items-center justify-between gap-3 rounded-2xl bg-black/5 px-3 py-2 text-sm ring-1 ring-current/10 [.theme-night_&]:bg-white/5">
            <span className="truncate font-medium">{d.name}</span>
            <span className="shrink-0 text-xs opacity-75">{d.ride_status ? `On a trip · ${d.ride_status.replace('_', ' ')}` : d.online ? 'Online' : 'Off duty'}</span>
          </li>
        ))}
        {!autopilot.drivers.length && <li className="text-sm opacity-75">No autopilot demo accounts found. Run the demo seeder first.</li>}
      </ul>
    </section>
  );
}

function Overview() {
  const { data, error, loading, setData } = useLive(() => api.admin.overview(), { intervalMs: 8000 });
  if (loading) return <SkeletonCard lines={6} />;
  if (error && !data) return <Alert>{error.message}</Alert>;
  const o = data;
  return (
    <div className="space-y-6">
      <AutopilotCard autopilot={o.autopilot} onChanged={(autopilot) => setData({ ...o, autopilot })} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat icon={Activity} label="Live rides" value={o.rides_live} hint={`${o.rides_searching} searching for a driver`} tone={o.rides_live ? 'text-accent' : ''} />
        <Stat icon={Radio} label="Drivers online" value={o.drivers_online} hint={`of ${o.users.drivers} drivers`} />
        <Stat icon={Car} label="Rides today" value={o.today.booked} hint={`${o.today.completed} completed · ${o.today.cancelled} cancelled`} />
        <Stat icon={CircleDollarSign} label="Fares today" value={inr(o.today.fares)} hint={`${o.today.distance_km} km driven`} />
        <Stat icon={UserRound} label="Riders" value={o.users.riders} />
        <Stat icon={Users} label="Drivers" value={o.users.drivers} />
        <Stat icon={Inbox} label="Open support" value={o.support_open} tone={o.support_open ? 'text-danger' : ''} />
        <Stat icon={ShieldCheck} label="Status" value="OK" hint="API and database reachable" />
      </div>
    </div>
  );
}

function Rides() {
  const [filter, setFilter] = useState('live');
  return (
    <div className="space-y-4">
      <Segmented label="Ride filter" value={filter} onChange={setFilter}
        options={[['live', 'Live'], ['completed', 'Completed'], ['cancelled', 'Cancelled'], ['all', 'All']]} />
      <RideList key={filter} filter={filter} />
    </div>
  );
}

function RideList({ filter }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(null);
  const { data, error, loading, refresh } = useLive(() => api.admin.rides(filter).then((r) => r.rides), { intervalMs: 6000 });

  async function act(ride, action) {
    const label = action === 'cancel' ? 'Cancel this ride? Both people will see it was cancelled by Delta.' : 'Mark this trip as completed?';
    if (!window.confirm(label)) return;
    setBusy(ride.ride_id);
    try { await api.admin.rideAction(ride.ride_id, action); toast({ tone: 'success', title: action === 'cancel' ? 'Ride cancelled' : 'Trip completed' }); refresh(); }
    catch (e) { toast({ tone: 'warn', title: 'Couldn’t do that', body: e.message }); } finally { setBusy(null); }
  }

  return (
    <div>
      {loading ? <SkeletonCard lines={5} /> : error && !data ? <Alert>{error.message}</Alert> : !data?.length ? (
        <EmptyState icon={Car} title={filter === 'live' ? 'No rides right now' : 'Nothing here yet'}>Rides appear here the moment they’re booked.</EmptyState>
      ) : (
        <ul className="space-y-3">
          {data.map((r) => (
            <li key={r.ride_id} className="rounded-3xl bg-surface p-4 ring-1 ring-line">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-semibold">{short(r.pickup_address)} → {short(r.destination_address)}</p>
                  <p className="text-xs text-muted">{ist(r.booked_at_ist)} · {Number(r.distance_km).toFixed(1)} km · {r.offers_sent} offer{Number(r.offers_sent) === 1 ? '' : 's'} sent · {r.messages} message{Number(r.messages) === 1 ? '' : 's'}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="num text-lg font-semibold">{inr(r.fare_inr)}</span>
                  <StatusBadge status={r.status} />
                </div>
              </div>
              <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                <p><span className="text-muted">Rider </span><span className="font-medium">{r.passenger_name}</span> <span className="mono text-muted">{r.passenger_phone}</span></p>
                <p><span className="text-muted">Driver </span>{r.driver_name ? <><span className="font-medium">{r.driver_name}</span> <span className="mono text-muted">{r.vehicle_registration}</span></> : <span className="text-muted">none yet</span>}</p>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3 text-xs text-muted">
                {r.accepted_at_ist && <span>accepted {ist(r.accepted_at_ist)}</span>}
                {r.arrived_at_ist && <span>· arrived {ist(r.arrived_at_ist)}</span>}
                {r.started_at_ist && <span>· started {ist(r.started_at_ist)}</span>}
                {r.completed_at_ist && <span>· completed {ist(r.completed_at_ist)}</span>}
                {r.cancelled_at_ist && <span>· cancelled by {r.cancelled_by === 'system' ? 'admin' : r.cancelled_by}</span>}
                <span className="ml-auto flex gap-2">
                  {['requested', 'searching', 'accepted'].includes(r.status) && (
                    <button className="btn-danger !px-3 !py-1.5 text-xs" disabled={busy === r.ride_id} onClick={() => act(r, 'cancel')}>Cancel ride</button>
                  )}
                  {r.status === 'in_progress' && (
                    <button className="btn-outline !px-3 !py-1.5 text-xs" disabled={busy === r.ride_id} onClick={() => act(r, 'complete')}>Force complete</button>
                  )}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Drivers() {
  const { toast } = useToast();
  const { data, error, loading, refresh } = useLive(() => api.admin.drivers().then((r) => r.drivers), { intervalMs: 8000 });
  async function offline(d) {
    if (!window.confirm(`Take ${d.name} offline?`)) return;
    try { await api.admin.driverOffline(d.id); refresh(); toast({ title: `${d.name} is offline` }); }
    catch (e) { toast({ tone: 'warn', title: 'Couldn’t take them offline', body: e.message }); }
  }
  if (loading) return <SkeletonCard lines={5} />;
  if (error && !data) return <Alert>{error.message}</Alert>;
  if (!data.length) return <EmptyState icon={Radio} title="No drivers yet">Drivers appear once they sign up.</EmptyState>;
  return (
    <ul className="divide-y divide-line overflow-hidden rounded-3xl bg-surface ring-1 ring-line">
      {data.map((d) => (
        <li key={d.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
          <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${d.is_online ? 'bg-success' : 'bg-muted/50'}`} aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{d.name} {d.autopilot && <span className="chip ml-1 !py-0.5"><Bot className="h-3 w-3" aria-hidden />autopilot</span>}</p>
            <p className="truncate text-xs text-muted">{d.email} · <span className="mono">{d.phone}</span></p>
          </div>
          <p className="text-xs text-muted">{d.vehicle_model} · <span className="mono">{d.vehicle_registration}</span></p>
          <p className="w-36 text-right text-xs text-muted">{d.is_online ? 'Online' : 'Offline'}{d.location_updated_at ? ` · seen ${timeAgo(d.location_updated_at)}` : ''}</p>
          {d.is_online
            ? <button className="btn-outline !px-3 !py-1.5 text-xs" onClick={() => offline(d)}>Take offline</button>
            : <span className="w-[88px]" />}
        </li>
      ))}
    </ul>
  );
}

const TICKET_STATUS = { open: 'Received', in_review: 'In review', resolved: 'Resolved', closed: 'Closed' };

function TicketPanel({ id, onClose, onChanged }) {
  const { data, error, loading, setData } = useLive(() => api.admin.ticket(id), { intervalMs: 10000 });
  const [reply, setReply] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  if (loading) return <SkeletonCard lines={5} />;
  if (error && !data) return <Alert>{error.message}</Alert>;
  const { ticket, updates } = data;
  async function send(e) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      setData(await api.admin.respond(id, { ...(reply.trim() ? { message: reply.trim() } : {}), ...(status ? { status } : {}) }));
      setReply(''); setStatus(''); onChanged();
    } catch (e2) { setErr(e2.details?.[0]?.message ?? e2.message); } finally { setBusy(false); }
  }
  return (
    <div className="space-y-4 rounded-3xl bg-surface p-5 ring-1 ring-line">
      <button className="btn-ghost -ml-3 !px-3 !py-1.5 text-sm" onClick={onClose}><ArrowLeft className="h-4 w-4" aria-hidden /> Inbox</button>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-muted">{ticket.category.replace('_', ' ')} · #{ticket.id.slice(0, 8)} · {clock(ticket.created_at)}</p>
          <h3 className="text-xl font-semibold">{ticket.subject}</h3>
          <p className="text-sm text-muted">{ticket.user?.name} · {ticket.user?.email} · <span className="mono">{ticket.user?.phone}</span></p>
        </div>
        <span className="chip">{TICKET_STATUS[ticket.status]}</span>
      </div>
      <p className="whitespace-pre-wrap rounded-2xl bg-surface-2 p-4 text-sm ring-1 ring-line">{ticket.description}</p>
      <ol className="space-y-3">
        {updates.map((u) => (
          <li key={u.id} className={`rounded-2xl px-4 py-2.5 text-sm ${u.author === 'support' ? 'ml-8 bg-accent/10' : u.author === 'user' ? 'mr-8 bg-surface-2' : 'text-muted'}`}>
            <p className="text-xs text-muted">{u.author === 'support' ? 'Delta support' : u.author === 'user' ? ticket.user?.name : 'Delta'} · {timeAgo(u.created_at)}{u.status ? ` · ${TICKET_STATUS[u.status]}` : ''}</p>
            <p>{u.message}</p>
          </li>
        ))}
      </ol>
      <form onSubmit={send} className="space-y-3 border-t border-line pt-4">
        <label className="label" htmlFor="adm-reply">Reply to {ticket.user?.name?.split(' ')[0] ?? 'the user'}</label>
        <textarea id="adm-reply" className="input min-h-24" value={reply} onChange={(e) => setReply(e.target.value)} maxLength={2000} placeholder="They’ll see this on their request straight away." />
        <div className="flex flex-wrap gap-3">
          <select className="input !w-auto" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="New status">
            <option value="">Keep status ({TICKET_STATUS[ticket.status]})</option>
            {Object.entries(TICKET_STATUS).filter(([k]) => k !== ticket.status).map(([k, v]) => <option key={k} value={k}>Mark {v.toLowerCase()}</option>)}
          </select>
          <button className="btn-primary flex-1" disabled={busy || (!reply.trim() && !status)}>{busy && <Spinner />} Send</button>
        </div>
        {err && <Alert>{err}</Alert>}
      </form>
    </div>
  );
}

function Support() {
  const [filter, setFilter] = useState('active');
  const [open, setOpen] = useState(null);
  if (open) return <TicketPanel id={open} onClose={() => setOpen(null)} onChanged={() => {}} />;
  return (
    <div className="space-y-4">
      <Segmented label="Ticket filter" value={filter} onChange={setFilter}
        options={[['active', 'Needs attention'], ['resolved', 'Resolved'], ['closed', 'Closed'], ['all', 'All']]} />
      <TicketList key={filter} filter={filter} onOpen={setOpen} />
    </div>
  );
}

function TicketList({ filter, onOpen: setOpen }) {
  const { data, error, loading } = useLive(() => api.admin.tickets(filter).then((r) => r.tickets), { intervalMs: 10000 });
  return (
    <div>
      {loading ? <SkeletonCard lines={4} /> : error && !data ? <Alert>{error.message}</Alert> : !data?.length ? (
        <EmptyState icon={Inbox} title={filter === 'active' ? 'Inbox zero' : 'Nothing here'}>Support requests from riders and drivers land here.</EmptyState>
      ) : (
        <ul className="space-y-2">
          {data.map((t) => (
            <li key={t.id}>
              <button onClick={() => setOpen(t.id)} className="flex w-full flex-wrap items-center gap-3 rounded-3xl bg-surface p-4 text-left ring-1 ring-line transition hover:ring-fg/25">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{t.subject}</span>
                  <span className="block truncate text-xs text-muted">{t.user?.name} ({t.user?.role}) · {t.category.replace('_', ' ')} · updated {timeAgo(t.updated_at)}</span>
                </span>
                <span className={`chip ${['open', 'in_review'].includes(t.status) ? '!text-fg' : ''}`}>{TICKET_STATUS[t.status]}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function UsersTab() {
  const [q, setQ] = useState('');
  const { data, error, loading } = useLive(() => api.admin.users().then((r) => r.users), { intervalMs: 30000 });
  const shown = useMemo(() => (data ?? []).filter((u) => `${u.name} ${u.email} ${u.phone} ${u.role}`.toLowerCase().includes(q.toLowerCase())), [data, q]);
  if (loading) return <SkeletonCard lines={5} />;
  if (error && !data) return <Alert>{error.message}</Alert>;
  return (
    <div className="space-y-4">
      <label className="relative block">
        <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
        <input className="input !pl-11" placeholder="Search name, email, phone or role" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search users" />
      </label>
      <p className="text-xs text-muted">{shown.length} of {data.length} newest accounts</p>
      <ul className="divide-y divide-line overflow-hidden rounded-3xl bg-surface ring-1 ring-line">
        {shown.map((u) => (
          <li key={u.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{u.name} {u.is_admin && <span className="chip ml-1 !py-0.5"><ShieldCheck className="h-3 w-3" aria-hidden />admin</span>}</p>
              <p className="truncate text-xs text-muted">{u.email} · <span className="mono">{u.phone}</span></p>
            </div>
            <span className="chip capitalize">{u.needs_onboarding ? 'setting up' : u.role}</span>
            <span className="w-28 text-right text-xs text-muted">joined {timeAgo(u.created_at)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Admin dashboard: /admin. Only for accounts in the app_admins table (checked by the server on every request). */
export default function Admin() {
  const { session, me, loading, signOut } = useAuth();
  const location = useLocation();
  const [tab, setTab] = useState('overview');
  if (loading) return <FullPageSpinner />;
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (!me?.user?.is_admin) {
    return (
      <div className="mx-auto grid min-h-screen max-w-md place-items-center p-6">
        <div className="space-y-4 text-center">
          <ShieldCheck className="mx-auto h-10 w-10 text-muted" aria-hidden />
          <h1 className="text-2xl font-semibold">Admins only</h1>
          <p className="text-sm text-muted">Your account isn’t a Delta admin. An existing admin, or the database owner, can add you (see docs/SETUP.md, “Admin access”).</p>
          <Link to="/" className="btn-primary">Back to Delta</Link>
        </div>
      </div>
    );
  }
  const Tab = { overview: Overview, rides: Rides, drivers: Drivers, support: Support, users: UsersTab }[tab];
  return (
    <div className="min-h-screen bg-canvas">
      <header className="sticky top-0 z-40 border-b border-line bg-canvas/85 backdrop-blur-xl">
        <div className="wrap flex h-16 items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Logo />
            <span className="chip !bg-fg !text-canvas !ring-0"><ShieldCheck className="h-3.5 w-3.5" aria-hidden />Admin</span>
          </div>
          <div className="flex items-center gap-2">
            <Link to={`/${me.user.role}/dashboard`} className="btn-ghost hidden !px-3 sm:inline-flex">Open app</Link>
            <ThemeMenu />
            <button onClick={signOut} className="btn-ghost btn-icon" aria-label="Sign out"><LogOut className="h-4 w-4" aria-hidden /></button>
          </div>
        </div>
        <nav className="wrap -mb-px flex gap-1 overflow-x-auto" aria-label="Admin sections">
          {TABS.map(([key, label, Icon]) => (
            <button key={key} onClick={() => setTab(key)} aria-current={tab === key ? 'page' : undefined}
              className={`flex shrink-0 items-center gap-2 border-b-2 px-3 py-3 text-sm font-medium transition ${tab === key ? 'border-fg text-fg' : 'border-transparent text-muted hover:text-fg'}`}>
              <Icon className="h-4 w-4" aria-hidden />{label}
            </button>
          ))}
        </nav>
      </header>
      <main className="wrap max-w-5xl animate-rise py-8">
        <h1 className="mb-6 text-[32px] font-semibold">{TABS.find(([k]) => k === tab)[1]}</h1>
        <Tab />
      </main>
    </div>
  );
}
