import { useEffect, useRef, useState } from 'react';
import { BellRing, MessageCircle, MessageSquareText, Phone, SendHorizontal, X } from 'lucide-react';
import { useLiveData } from '../context/LiveContext.jsx';
import { Avatar, Spinner } from './ui.jsx';

const QUICK = {
  passenger: ['I’m at the pickup point', 'Coming in 2 minutes', 'Where are you exactly?', 'Please call me'],
  driver: ['I’ve reached the pickup', 'Stuck in traffic, 5 more minutes', 'Which gate should I come to?', 'Please call me'],
};
const telOf = (phone) => phone?.replace(/[^\d+]/g, '');
const time = (iso) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

/** Call / Message / SMS row for the person you're riding with. Message opens the in-app chat. */
export function ContactActions({ person, role }) {
  const { chat } = useLiveData();
  const tel = telOf(person?.phone);
  const label = role === 'driver' ? 'passenger' : 'driver';
  return (
    <div className="grid grid-cols-3 gap-2">
      <a href={tel ? `tel:${tel}` : undefined} aria-disabled={!tel} className={`btn-outline !px-3 ${tel ? '' : 'pointer-events-none opacity-45'}`} aria-label={`Call ${label}`}>
        <Phone className="h-4 w-4" aria-hidden /> Call
      </a>
      <button className="btn-primary relative !px-3" onClick={chat.openChat} disabled={!chat.rideId} aria-label={`Message ${label}${chat.unread ? `, ${chat.unread} unread` : ''}`}>
        <MessageCircle className="h-4 w-4" aria-hidden /> Chat
        {chat.unread > 0 && <span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-danger px-1 text-[11px] font-bold text-white">{chat.unread}</span>}
      </button>
      <a href={tel ? `sms:${tel}` : undefined} aria-disabled={!tel} className={`btn-outline !px-3 ${tel ? '' : 'pointer-events-none opacity-45'}`} aria-label={`Text ${label} by SMS`}>
        <MessageSquareText className="h-4 w-4" aria-hidden /> SMS
      </a>
    </div>
  );
}

/** In-ride chat drawer (one per app, mounted in the layout). Bottom sheet on phones, side panel on desktop. */
export default function RideChat() {
  const { chat, activeRide } = useLiveData() ?? {};
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const list = useRef(null);
  const input = useRef(null);

  const count = chat?.messages.length ?? 0;
  useEffect(() => {
    if (chat?.open && list.current) list.current.scrollTop = list.current.scrollHeight;
  }, [chat?.open, count]);
  useEffect(() => {
    if (!chat?.open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') chat.closeChat(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [chat]);

  if (!chat?.open || !activeRide) return null;
  const role = activeRide.viewer_role;
  const other = role === 'driver' ? activeRide.passenger : activeRide.driver;
  const tel = telOf(other?.phone);

  async function send(body) {
    const msg = body.trim();
    if (!msg || busy) return;
    setBusy(true);
    setError(null);
    try { await chat.send(msg); setText(''); input.current?.focus(); } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-[55] flex items-end justify-center bg-black/40 backdrop-blur-[2px] lg:items-stretch lg:justify-end" onClick={chat.closeChat}>
      <section role="dialog" aria-modal="true" aria-label={`Chat with ${other?.name ?? 'your match'}`}
        className="sheet flex h-[82vh] w-full max-w-md animate-rise flex-col !rounded-b-none lg:h-full lg:!rounded-none lg:!rounded-l-[28px]" onClick={(e) => e.stopPropagation()}>
        <header className="flex items-center gap-3 border-b border-line px-5 py-4">
          <Avatar name={other?.name ?? '?'} size="h-10 w-10 text-sm" />
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold">{other?.name ?? 'Your match'}</p>
            <p className="truncate text-xs text-muted">{role === 'driver' ? 'Passenger' : `${activeRide.driver?.vehicle_model ?? ''} · ${activeRide.driver?.vehicle_registration ?? ''}`}</p>
          </div>
          {tel && <a href={`tel:${tel}`} className="btn-accent btn-icon" aria-label="Call"><Phone className="h-4 w-4" aria-hidden /></a>}
          <button className="btn-ghost btn-icon" onClick={chat.closeChat} aria-label="Close chat"><X className="h-5 w-5" aria-hidden /></button>
        </header>

        <div ref={list} className="flex-1 space-y-2.5 overflow-y-auto px-4 py-4" aria-live="polite">
          {chat.loading && !count && <div className="grid place-items-center py-10"><Spinner /></div>}
          {!chat.loading && !count && (
            <div className="mx-auto max-w-xs py-10 text-center">
              <MessageCircle className="mx-auto h-8 w-8 text-muted" aria-hidden />
              <p className="mt-3 text-sm font-medium">Say hello</p>
              <p className="mt-1 text-xs text-muted">Messages stay inside Delta: your number isn’t needed to chat. The chat closes when the ride ends.</p>
            </div>
          )}
          {chat.messages.map((m) => (m.sender_role === 'system' ? (
            <div key={m.id} className="mx-auto flex max-w-[92%] items-start gap-2 rounded-2xl bg-volt/25 px-3.5 py-2.5 text-[13px] text-fg ring-1 ring-volt/60">
              <BellRing className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <div><p className="font-semibold">Delta update</p><p>{m.body}</p><p className="mt-1 text-[11px] text-muted">{time(m.created_at)}</p></div>
            </div>
          ) : (
            <div key={m.id} className={`flex ${m.mine ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[80%] rounded-[20px] px-3.5 py-2 text-[14px] leading-snug ${m.mine ? 'rounded-br-md bg-accent text-white' : 'rounded-bl-md bg-surface-2 ring-1 ring-line'}`}>
                <p className="whitespace-pre-wrap break-words">{m.body}</p>
                <p className={`mt-0.5 text-right text-[10px] ${m.mine ? 'text-white/70' : 'text-muted'}`}>{time(m.created_at)}</p>
              </div>
            </div>
          )))}
        </div>

        <footer className="space-y-3 border-t border-line px-4 pb-5 pt-3">
          {error && <p className="text-xs text-danger" role="alert">{error}</p>}
          {chat.canSend ? (
            <>
              <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-0.5">
                {QUICK[role === 'driver' ? 'driver' : 'passenger'].map((q) => (
                  <button key={q} className="chip shrink-0 hover:text-fg" onClick={() => send(q)} disabled={busy}>{q}</button>
                ))}
              </div>
              <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); send(text); }}>
                <label htmlFor="chat-input" className="sr-only">Message</label>
                <input id="chat-input" ref={input} className="input !rounded-full !py-3" placeholder="Message…" maxLength={500}
                  value={text} onChange={(e) => setText(e.target.value)} autoComplete="off" autoFocus />
                <button className="btn-accent btn-icon !h-12 !w-12 shrink-0" disabled={busy || !text.trim()} aria-label="Send">
                  {busy ? <Spinner /> : <SendHorizontal className="h-5 w-5" aria-hidden />}
                </button>
              </form>
            </>
          ) : <p className="text-center text-xs text-muted">This ride has ended, so the chat is read-only.</p>}
        </footer>
      </section>
    </div>
  );
}
