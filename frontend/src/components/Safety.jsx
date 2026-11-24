import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Copy, Link2, Phone, Plus, ShieldCheck, Trash2, UserPlus, X } from 'lucide-react';
import { useToast } from './Toast.jsx';
import { Alert, Spinner } from './ui.jsx';
import { useLive } from '../hooks/useLive.js';
import { api } from '../services/api.js';

const tel = (p) => p.replace(/[^\d+]/g, '');
export const shareUrl = (token) => `${window.location.origin}/share/${token}`;

/** Live trip-monitoring alerts for the passenger: review, dismiss, or ask for help. Never auto-escalated. */
export function useRideAlerts(rideId, enabled) {
  return useLive(() => api.rideAlerts(rideId).then((r) => r.alerts), {
    intervalMs: 15000, enabled, realtime: enabled ? { table: 'safety_alerts', filter: `ride_id=eq.${rideId}` } : undefined,
  });
}

export function AlertBanner({ alerts, onReview }) {
  const open = (alerts ?? []).filter((a) => a.status === 'open');
  if (!open.length) return null;
  return (
    <button onClick={onReview} className="flex w-full animate-pop items-start gap-3 rounded-3xl bg-amber-400/15 p-4 text-left ring-1 ring-amber-400/50" role="alert">
      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">Is everything OK?</span>
        <span className="block text-sm text-fg-soft">{open[0].message} Tap to review.</span>
      </span>
    </button>
  );
}

/** Safety sheet during a ride: emergency services, trusted contacts, a live share link, and alert review. */
export function SafetySheet({ ride, alerts, onAlertsChanged, onClose }) {
  const { toast } = useToast();
  const [contacts, setContacts] = useState(null);
  const [link, setLink] = useState(null);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const canShare = ['accepted', 'in_progress'].includes(ride.status);

  useEffect(() => { api.contacts().then((r) => setContacts(r.contacts)).catch(() => setContacts([])); }, []);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function makeLink() {
    setBusy('link'); setError(null);
    try { const { share } = await api.createShare(ride.id); setLink({ ...share, url: shareUrl(share.token) }); return shareUrl(share.token); }
    catch (e) { setError(e.message); return null; } finally { setBusy(null); }
  }
  async function shareLink() {
    const url = link?.url ?? await makeLink();
    if (!url) return;
    const text = `Follow my Delta trip live: ${url}`;
    try {
      if (navigator.share) await navigator.share({ title: 'My Delta trip', text, url });
      else { await navigator.clipboard.writeText(url); toast({ tone: 'success', title: 'Link copied', body: 'Anyone with it can follow this trip until it ends.' }); }
    } catch { /* share sheet dismissed */ }
  }
  async function textContact(c) {
    const url = link?.url ?? await makeLink();
    const body = encodeURIComponent(`I'm on a Delta ride${url ? `. Follow it live: ${url}` : ''}`);
    window.location.assign(`sms:${tel(c.phone)}?&body=${body}`);
  }
  async function resolve(a, action) {
    setBusy(a.id);
    try {
      const r = await api.resolveAlert(a.id, action);
      onAlertsChanged?.();
      if (action === 'help') toast({ tone: 'warn', title: 'Help requested', body: `Safety request #${r.ticket?.id?.slice(0, 8)} opened. Call 112 if you are in danger.` });
    } catch (e) { setError(e.message); } finally { setBusy(null); }
  }
  const openAlerts = (alerts ?? []).filter((a) => a.status === 'open');

  return (
    <div className="fixed inset-0 z-[55] flex items-end justify-center bg-black/40 backdrop-blur-[2px] sm:items-center" onClick={onClose}>
      <section role="dialog" aria-modal="true" aria-label="Safety" onClick={(e) => e.stopPropagation()}
        className="sheet max-h-[90vh] w-full max-w-md animate-rise space-y-5 overflow-y-auto p-5 !rounded-b-none sm:!rounded-b-[28px]">
        <header className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-lg font-semibold"><ShieldCheck className="h-5 w-5 text-accent" aria-hidden />Safety</h2>
          <button className="btn-ghost btn-icon" onClick={onClose} aria-label="Close"><X className="h-5 w-5" aria-hidden /></button>
        </header>

        <a href="tel:112" className="flex items-center justify-center gap-2 rounded-full bg-danger py-4 text-base font-semibold text-white transition hover:brightness-110 active:scale-[0.98]">
          <Phone className="h-5 w-5" aria-hidden /> Call 112 · emergency services
        </a>

        {openAlerts.map((a) => (
          <div key={a.id} className="space-y-3 rounded-3xl bg-amber-400/15 p-4 ring-1 ring-amber-400/50">
            <p className="flex items-start gap-2 text-sm"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden />
              <span><span className="font-semibold">{a.kind === 'long_stop' ? 'Unexpected stop' : 'Off the expected route'}</span><br />{a.message} This may be nothing (traffic, a detour, a quick stop).</span></p>
            <div className="grid grid-cols-2 gap-2">
              <button className="btn-outline !py-2.5 text-sm" disabled={busy === a.id} onClick={() => resolve(a, 'dismiss')}>I’m OK</button>
              <button className="btn-danger !py-2.5 text-sm" disabled={busy === a.id} onClick={() => resolve(a, 'help')}>Get help</button>
            </div>
          </div>
        ))}

        <div className="space-y-2">
          <p className="eyebrow">Share your trip</p>
          <button className="btn-primary w-full" disabled={!canShare || busy === 'link'} onClick={shareLink}>
            {busy === 'link' ? <Spinner /> : <Link2 className="h-4 w-4" aria-hidden />} {link ? 'Share live link again' : 'Share a live trip link'}
          </button>
          {link && (
            <div className="flex items-center gap-2 rounded-2xl bg-surface-2 px-3 py-2 ring-1 ring-line">
              <span className="mono min-w-0 flex-1 truncate">{link.url}</span>
              <button className="btn-ghost btn-icon !h-8 !w-8" aria-label="Copy link" onClick={() => navigator.clipboard?.writeText(link.url).then(() => toast({ title: 'Copied' }))}><Copy className="h-4 w-4" aria-hidden /></button>
            </div>
          )}
          <p className="text-xs text-muted">The link shows pickup, drop-off, driver first name, car and live position, never phone numbers. It stops working when the trip ends{link ? ` or at ${new Date(link.expires_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : ''}, and you can turn it off any time.</p>
          {link && <button className="text-xs font-semibold text-danger hover:underline" onClick={async () => { await api.revokeShare(link.id); setLink(null); toast({ title: 'Link turned off' }); }}>Turn this link off</button>}
        </div>

        <div className="space-y-2">
          <p className="eyebrow">Trusted contacts</p>
          {contacts === null ? <Spinner /> : contacts.length === 0 ? (
            <p className="text-sm text-muted">No trusted contacts yet. <Link to="/passenger/account#safety" className="font-semibold text-accent hover:underline" onClick={onClose}>Add one</Link> to reach them in one tap.</p>
          ) : (
            <ul className="space-y-2">
              {contacts.map((c) => (
                <li key={c.id} className="flex items-center gap-3 rounded-2xl bg-surface-2 px-3 py-2.5 ring-1 ring-line">
                  <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{c.name}</span><span className="block text-xs text-muted">{c.relationship ?? c.phone}</span></span>
                  <a href={`tel:${tel(c.phone)}`} className="btn-outline btn-icon !h-9 !w-9" aria-label={`Call ${c.name}`}><Phone className="h-4 w-4" aria-hidden /></a>
                  <button className="btn-accent !px-3 !py-2 text-xs" onClick={() => textContact(c)} disabled={!canShare}>Send trip</button>
                </li>
              ))}
            </ul>
          )}
        </div>
        {error && <Alert>{error}</Alert>}
      </section>
    </div>
  );
}

/** Account section: manage up to 5 trusted contacts (stored in Supabase, visible only to you). */
export function EmergencyContacts() {
  const [list, setList] = useState(null);
  const [form, setForm] = useState(null); // null | { id?, name, phone, relationship }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const load = () => api.contacts().then((r) => setList(r.contacts)).catch((e) => { setError(e.message); setList([]); });
  useEffect(() => { load(); }, []);

  async function save(e) {
    e.preventDefault();
    setBusy(true); setError(null);
    const body = { name: form.name, phone: form.phone, relationship: form.relationship || undefined };
    try { if (form.id) await api.updateContact(form.id, body); else await api.addContact(body); setForm(null); await load(); }
    catch (err) { setError(err.details?.[0]?.message ?? err.message); } finally { setBusy(false); }
  }
  async function remove(c) {
    if (!window.confirm(`Remove ${c.name} from your trusted contacts?`)) return;
    try { await api.deleteContact(c.id); await load(); } catch (err) { setError(err.message); }
  }

  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-medium">Trusted contacts</p>
        <p className="text-xs text-muted">Call or send them your live trip from the Safety button during any ride. Up to 5.</p>
      </div>
      {list === null ? <Spinner /> : (
        <ul className="space-y-2">
          {list.map((c) => (
            <li key={c.id} className="flex items-center gap-3 rounded-2xl bg-surface-2 px-3 py-2.5 ring-1 ring-line">
              <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{c.name}{c.relationship && <span className="font-normal text-muted"> · {c.relationship}</span>}</span><span className="mono block text-xs text-muted">{c.phone}</span></span>
              <button className="btn-ghost !px-3 !py-1.5 text-xs" onClick={() => setForm({ id: c.id, name: c.name, phone: c.phone, relationship: c.relationship ?? '' })}>Edit</button>
              <button className="btn-ghost btn-icon !h-8 !w-8 text-danger" onClick={() => remove(c)} aria-label={`Remove ${c.name}`}><Trash2 className="h-4 w-4" aria-hidden /></button>
            </li>
          ))}
        </ul>
      )}
      {form ? (
        <form onSubmit={save} className="animate-rise space-y-3 rounded-3xl bg-surface-2 p-4 ring-1 ring-line">
          <div className="grid gap-3 sm:grid-cols-2">
            <div><label className="label" htmlFor="ec-name">Name</label><input id="ec-name" className="input !bg-surface" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required maxLength={80} /></div>
            <div><label className="label" htmlFor="ec-phone">Phone</label><input id="ec-phone" type="tel" className="input !bg-surface" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} required placeholder="+91 98450 12345" /></div>
          </div>
          <div><label className="label" htmlFor="ec-rel">Relationship <span className="text-muted">(optional)</span></label><input id="ec-rel" className="input !bg-surface" value={form.relationship} onChange={(e) => setForm({ ...form, relationship: e.target.value })} maxLength={40} placeholder="Sister, flatmate…" /></div>
          {error && <Alert>{error}</Alert>}
          <div className="flex gap-2">
            <button className="btn-primary flex-1" disabled={busy}>{busy && <Spinner />} {form.id ? 'Save contact' : 'Add contact'}</button>
            <button type="button" className="btn-outline" onClick={() => { setForm(null); setError(null); }}>Cancel</button>
          </div>
        </form>
      ) : (list && list.length < 5 && (
        <button className="btn-outline w-full" onClick={() => setForm({ name: '', phone: '', relationship: '' })}>
          {list.length ? <Plus className="h-4 w-4" aria-hidden /> : <UserPlus className="h-4 w-4" aria-hidden />} Add a trusted contact
        </button>
      ))}
      {!form && error && <Alert>{error}</Alert>}
    </div>
  );
}
