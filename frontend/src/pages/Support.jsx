import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Car, ChevronRight, CircleHelp, IndianRupee, LifeBuoy, Package, ShieldAlert, UserRoundX } from 'lucide-react';
import { Page } from '../components/Layout.jsx';
import { useToast } from '../components/Toast.jsx';
import { Alert, EmptyState, SkeletonCard, Spinner } from '../components/ui.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useLive } from '../hooks/useLive.js';
import { timeAgo } from '../lib/format.js';
import { api } from '../services/api.js';

export const CATEGORIES = [
  ['ride_issue', 'Problem with a ride', Car],
  ['fare', 'Incorrect fare', IndianRupee],
  ['driver', 'Driver issue', UserRoundX],
  ['lost_item', 'Lost item', Package],
  ['safety', 'Safety concern', ShieldAlert],
  ['general', 'General question', CircleHelp],
];
const CAT = Object.fromEntries(CATEGORIES.map(([k, label, icon]) => [k, { label, icon }]));
const STATUS = {
  open: ['Received', 'bg-accent/10 text-accent ring-accent/30'],
  in_review: ['In review', 'bg-amber-400/15 text-amber-700 ring-amber-400/40 [.theme-night_&]:text-amber-300'],
  resolved: ['Resolved', 'bg-success/10 text-success ring-success/30'],
  closed: ['Closed', 'bg-surface-2 text-muted ring-line'],
};
const FLOW = ['open', 'in_review', 'resolved'];
const short = (a) => a.split(',').slice(0, 2).join(',');

function TicketStatus({ status }) {
  const [label, cls] = STATUS[status] ?? [status, ''];
  return <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${cls}`}>{label}</span>;
}

function NewTicket({ rideId, onCreated, onCancel }) {
  const [rides, setRides] = useState([]);
  const [form, setForm] = useState({ category: rideId ? 'ride_issue' : '', ride_id: rideId ?? '', subject: '', description: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  useEffect(() => { api.history({ limit: 15 }).then((r) => setRides(r.items)).catch(() => {}); }, []);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    if (!form.category) { setError('Choose what the problem is about.'); return; }
    setBusy(true); setError(null);
    try {
      const { ticket } = await api.createTicket({ ...form, ride_id: form.ride_id || null });
      onCreated(ticket);
    } catch (err) { setError(err.details?.[0]?.message ?? err.message); } finally { setBusy(false); }
  }

  return (
    <form onSubmit={submit} className="card animate-rise space-y-5">
      <h2 className="text-lg font-semibold">What do you need help with?</h2>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Category">
        {CATEGORIES.map(([k, label, Icon]) => (
          <button type="button" role="radio" aria-checked={form.category === k} key={k} onClick={() => setForm({ ...form, category: k })}
            className={`flex items-center gap-2 rounded-2xl px-3 py-3 text-left text-sm font-medium ring-1 transition ${form.category === k ? 'bg-fg text-canvas ring-fg' : 'bg-surface-2 ring-line hover:ring-fg/30'}`}>
            <Icon className="h-4 w-4 shrink-0" aria-hidden />{label}
          </button>
        ))}
      </div>
      <div>
        <label className="label" htmlFor="t-ride">Which trip? <span className="text-muted">(optional)</span></label>
        <select id="t-ride" className="input" value={form.ride_id} onChange={set('ride_id')}>
          <option value="">Not about a specific trip</option>
          {rideId && !rides.some((r) => r.id === rideId) && <option value={rideId}>The trip you came from</option>}
          {rides.map((r) => (
            <option key={r.id} value={r.id}>{new Date(r.created_at).toLocaleDateString([], { day: 'numeric', month: 'short' })} · {short(r.pickup.address)} → {short(r.destination.address)}</option>
          ))}
        </select>
      </div>
      <div><label className="label" htmlFor="t-sub">Subject</label><input id="t-sub" className="input" value={form.subject} onChange={set('subject')} maxLength={120} required minLength={3} placeholder="e.g. Left my bag in the car" /></div>
      <div>
        <label className="label" htmlFor="t-desc">Details</label>
        <textarea id="t-desc" className="input min-h-32" value={form.description} onChange={set('description')} maxLength={2000} required minLength={10}
          placeholder="What happened? Include anything that helps us sort it out quickly." />
        <p className="mt-1 text-right text-xs text-muted">{form.description.length}/2000</p>
      </div>
      {form.category === 'safety' && <Alert tone="warn">If you are in danger right now, call 112 first.</Alert>}
      {error && <Alert>{error}</Alert>}
      <div className="flex gap-3">
        <button className="btn-primary flex-1" disabled={busy}>{busy && <Spinner />} Submit request</button>
        <button type="button" className="btn-outline" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

function TicketDetail({ id, onBack }) {
  const { toast } = useToast();
  const { data, error, loading, setData } = useLive(() => api.ticket(id), {
    intervalMs: 15000, realtime: [{ table: 'support_ticket_updates', filter: `ticket_id=eq.${id}` }, { table: 'support_tickets', filter: `id=eq.${id}` }],
  });
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(null);
  const [err, setErr] = useState(null);
  if (loading) return <SkeletonCard lines={6} />;
  if (error && !data) return <Alert>{error.message}</Alert>;
  const { ticket, updates } = data;
  const Icon = CAT[ticket.category]?.icon ?? CircleHelp;
  const at = ticket.status === 'closed' ? -1 : FLOW.indexOf(ticket.status);

  async function act(name, fn) {
    setBusy(name); setErr(null);
    try { setData(await fn()); if (name === 'reply') setReply(''); if (name === 'close') toast({ title: 'Request closed' }); }
    catch (e) { setErr(e.message); } finally { setBusy(null); }
  }

  return (
    <div className="animate-rise space-y-5">
      <button className="btn-ghost -ml-3 !px-3 !py-2 text-sm" onClick={onBack}><ArrowLeft className="h-4 w-4" aria-hidden /> All requests</button>
      <section className="card space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-xs text-muted"><Icon className="h-3.5 w-3.5" aria-hidden />{CAT[ticket.category]?.label}</p>
            <h2 className="mt-1 text-xl font-semibold">{ticket.subject}</h2>
            <p className="text-xs text-muted">Opened {new Date(ticket.created_at).toLocaleString([], { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })} · #{ticket.id.slice(0, 8)}</p>
          </div>
          <TicketStatus status={ticket.status} />
        </div>
        {ticket.status !== 'closed' && (
          <ol className="grid grid-cols-3 gap-2" aria-label="Request progress">
            {FLOW.map((s, i) => (
              <li key={s} className="space-y-1.5">
                <div className={`h-1.5 rounded-full ${i <= at ? 'bg-accent' : 'bg-line'}`} />
                <p className={`text-xs ${i <= at ? 'font-semibold' : 'text-muted'}`}>{STATUS[s][0]}</p>
              </li>
            ))}
          </ol>
        )}
        <p className="whitespace-pre-wrap rounded-2xl bg-surface-2 p-4 text-sm ring-1 ring-line">{ticket.description}</p>
        {ticket.ride_id && <Link to={`../trips/${ticket.ride_id}`} relative="path" className="text-sm font-semibold text-accent hover:underline">View the trip →</Link>}
      </section>

      <section className="card">
        <h3 className="mb-4 font-semibold">Updates</h3>
        <ol className="space-y-4">
          {updates.map((u) => (
            <li key={u.id} className="flex gap-3">
              <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${u.author === 'support' ? 'bg-accent' : u.author === 'user' ? 'bg-fg' : 'bg-muted'}`} />
              <div className="min-w-0 flex-1">
                <p className="text-xs text-muted">{u.author === 'support' ? 'Delta support' : u.author === 'user' ? 'You' : 'Delta'} · {timeAgo(u.created_at)}{u.status ? ` · ${STATUS[u.status]?.[0]}` : ''}</p>
                <p className="text-sm">{u.message}</p>
              </div>
            </li>
          ))}
        </ol>
        {ticket.status !== 'closed' ? (
          <form className="mt-5 space-y-3 border-t border-line pt-5" onSubmit={(e) => { e.preventDefault(); if (reply.trim()) act('reply', () => api.replyTicket(id, reply.trim())); }}>
            <label className="label" htmlFor="t-reply">Add a message</label>
            <textarea id="t-reply" className="input min-h-24" value={reply} onChange={(e) => setReply(e.target.value)} maxLength={2000} placeholder="Anything else we should know?" />
            {err && <Alert>{err}</Alert>}
            <div className="flex gap-3">
              <button className="btn-primary flex-1" disabled={!reply.trim() || Boolean(busy)}>{busy === 'reply' && <Spinner />} Send</button>
              <button type="button" className="btn-outline" disabled={Boolean(busy)} onClick={() => act('close', () => api.closeTicket(id))}>Close request</button>
            </div>
          </form>
        ) : <p className="mt-5 border-t border-line pt-4 text-sm text-muted">This request is closed. Open a new one if you still need help.</p>}
      </section>
    </div>
  );
}

/** Support centre: report a problem (stored in Supabase), then follow its status live. */
export default function Support() {
  const { me } = useAuth();
  const { toast } = useToast();
  const [params, setParams] = useSearchParams();
  const selected = params.get('ticket');
  const rideId = params.get('ride');
  const [composing, setComposing] = useState(Boolean(rideId));
  const list = useLive(() => api.tickets().then((r) => r.tickets), {
    intervalMs: 20000, realtime: { table: 'support_tickets', filter: `user_id=eq.${me.user.id}` },
  });

  const open = (id) => setParams({ ticket: id });
  return (
    <Page className="max-w-2xl space-y-6">
      <header>
        <p className="text-sm text-muted">Help</p>
        <h1 className="text-[40px] font-semibold leading-[1.02]">Support <span className="serif text-accent">centre</span></h1>
        <p className="mt-2 text-sm text-fg-soft">Report a problem with a trip, a fare or a driver, or ask us anything. Every request is saved and you can follow it here.</p>
      </header>

      {selected ? <TicketDetail id={selected} onBack={() => setParams({})} />
        : composing ? (
          <NewTicket rideId={rideId} onCancel={() => { setComposing(false); setParams({}); }}
            onCreated={(t) => { setComposing(false); list.refresh(); toast({ tone: 'success', title: 'Request submitted', body: 'We’ll update its status here.' }); open(t.id); }} />
        ) : (
          <>
            <button className="btn-primary btn-lg w-full" onClick={() => setComposing(true)}><LifeBuoy className="h-5 w-5" aria-hidden /> Get help</button>
            <section className="space-y-3">
              <h2 className="text-sm font-semibold text-fg-soft">Your requests</h2>
              {list.loading ? <SkeletonCard lines={3} /> : list.error && !list.data ? <Alert>{list.error.message}</Alert>
                : !list.data?.length ? (
                  <EmptyState icon={LifeBuoy} title="No requests yet">Anything you report will appear here with its status.</EmptyState>
                ) : (
                  <ul className="space-y-2">
                    {list.data.map((t) => {
                      const Icon = CAT[t.category]?.icon ?? CircleHelp;
                      return (
                        <li key={t.id}>
                          <button onClick={() => open(t.id)} className="flex w-full items-center gap-3 rounded-3xl bg-surface p-4 text-left ring-1 ring-line transition hover:ring-fg/25">
                            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-surface-2 ring-1 ring-line"><Icon className="h-4 w-4" aria-hidden /></span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate font-medium">{t.subject}</span>
                              <span className="block text-xs text-muted">{CAT[t.category]?.label} · updated {timeAgo(t.updated_at)}</span>
                            </span>
                            <TicketStatus status={t.status} />
                            <ChevronRight className="h-4 w-4 text-muted" aria-hidden />
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
            </section>
          </>
        )}
    </Page>
  );
}
