import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from './AuthContext.jsx';
import { useLive } from '../hooks/useLive.js';
import { useDriverLocation } from '../hooks/useDriverLocation.js';
import { useToast } from '../components/Toast.jsx';
import { celebrate } from '../lib/celebrate.js';
import { buzz, chime, primeAudio } from '../lib/chime.js';
import { api } from '../services/api.js';

const LiveContext = createContext(null);
const firstName = (n = '') => n.replace(/\(.*?\)/g, '').trim().split(/\s+/)[0] || 'Your driver';

/**
 * One shared live view per signed-in user, so the header, nav, takeovers and every page agree:
 * the open ride (both roles), and for drivers their availability and pending offers.
 * It also turns state changes into moments: a toast and Δ-burst when a driver is found, a chime for new requests.
 */
export function LiveProvider({ children }) {
  const { me, role } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const isDriver = role === 'driver';
  const driverId = me.driver?.id;

  const ride = useLive(() => api.activeRide().then((r) => r.ride), {
    intervalMs: 2500,
    realtime: { table: 'rides', filter: isDriver ? `driver_id=eq.${driverId}` : `passenger_id=eq.${me.user.id}` },
  });

  const driverState = useLive(() => api.me().then((r) => r.driver), { intervalMs: 5000, enabled: isDriver });
  const driver = isDriver ? (driverState.data ?? me.driver) : null;
  const online = Boolean(driver?.is_online);

  const offersLive = useLive(() => api.offers().then((r) => r.offers), {
    intervalMs: 2000, enabled: isDriver && online,
    realtime: isDriver ? { table: 'ride_offers', filter: `driver_id=eq.${driverId}` } : undefined,
  });
  const offers = useMemo(() => (isDriver && online ? (offersLive.data ?? []) : []), [isDriver, online, offersLive.data]);

  // Location sharing runs on every driver screen while online and the app is open; faster during a trip.
  // Heading: the pickup until arrival, then the drop-off once the trip starts (drives the demo simulation too).
  const r = isDriver ? ride.data : null;
  const heading = !r ? null
    : r.status === 'accepted' && !r.arrived_at ? r.pickup
      : r.status === 'in_progress' ? r.destination : null;
  const headingKey = heading ? `${heading.latitude},${heading.longitude}` : '';
  const target = useMemo(() => (headingKey ? { latitude: Number(headingKey.split(',')[0]), longitude: Number(headingKey.split(',')[1]) } : null), [headingKey]);
  const loc = useDriverLocation({ online, onUpdated: driverState.refresh, intervalMs: ride.data ? 6_000 : 30_000, target });

  // In-ride chat for the active ride (both roles). Realtime pushes new messages; polling is the fallback.
  const chatRideId = ride.data && ['accepted', 'in_progress'].includes(ride.data.status) ? ride.data.id : null;
  const chatLive = useLive(() => (chatRideId ? api.messages(chatRideId) : Promise.resolve(null)), {
    intervalMs: 6000, enabled: Boolean(chatRideId),
    realtime: chatRideId ? { table: 'ride_messages', filter: `ride_id=eq.${chatRideId}` } : undefined,
  });
  const messages = useMemo(() => (chatRideId && chatLive.data ? chatLive.data.messages : []), [chatRideId, chatLive.data]);
  const [chatOpen, setChatOpen] = useState(false);
  const [readAt, setReadAt] = useState(() => new Date().toISOString());
  const unread = chatOpen ? 0 : messages.filter((m) => !m.mine && m.created_at > readAt).length;
  const openChat = () => { setChatOpen(true); setReadAt(new Date().toISOString()); };
  const closeChat = () => { setChatOpen(false); setReadAt(new Date().toISOString()); };
  async function sendMessage(body) {
    const { message } = await api.sendMessage(chatRideId, body);
    chatLive.setData((d) => ({ ...(d ?? { can_send: true }), messages: [...(d?.messages ?? []).filter((m) => m.id !== message.id), message] }));
  }

  // Incoming message while the chat is closed → toast with a one-tap "Reply".
  const seenMsgs = useRef(null);
  useEffect(() => {
    if (!chatLive.data) return;
    const ids = new Set(messages.map((m) => m.id));
    if (seenMsgs.current === null) { seenMsgs.current = ids; return; } // first load: history, not news
    const fresh = messages.filter((m) => !seenMsgs.current.has(m.id) && !m.mine && m.sender_role !== 'system');
    seenMsgs.current = ids;
    if (!fresh.length || chatOpen) return;
    const last = fresh[fresh.length - 1];
    const who = last.sender_role === 'driver' ? firstName(ride.data?.driver?.name) : firstName(ride.data?.passenger?.name) || 'Passenger';
    chime(); buzz([80]);
    toast({ title: `Message from ${who}`, body: last.body, action: { label: 'Reply', onClick: () => { setChatOpen(true); setReadAt(new Date().toISOString()); } } });
  }, [messages, chatLive.data, chatOpen, ride.data, toast]);

  const [busyOfferId, setBusyOfferId] = useState(null);
  const [offerError, setOfferError] = useState(null);

  async function respond(offer, fn, after) {
    setBusyOfferId(offer.id);
    setOfferError(null);
    try { after(await fn(offer.id)); } catch (e) { setOfferError(e.message); } finally {
      setBusyOfferId(null);
      offersLive.refresh();
      ride.refresh();
    }
  }
  const acceptOffer = (offer) => respond(offer, api.acceptOffer, (r) => navigate(`/driver/ride/${r.ride.id}`));
  const rejectOffer = (offer) => respond(offer, api.rejectOffer, () => {});

  // Browsers only allow sound after a gesture: unlock audio on the first tap anywhere.
  useEffect(() => {
    if (!isDriver) return undefined;
    const unlock = () => primeAudio();
    window.addEventListener('pointerdown', unlock, { once: true });
    return () => window.removeEventListener('pointerdown', unlock);
  }, [isDriver]);

  // New request → chime + vibration (once per offer).
  const seenOffers = useRef(new Set());
  useEffect(() => {
    let fresh = false;
    for (const o of offers) if (!seenOffers.current.has(o.id)) { seenOffers.current.add(o.id); fresh = true; }
    if (fresh) { chime(); buzz(); }
  }, [offers]);

  // Ride status transitions → moments (passengers and drivers see different ones).
  const prev = useRef(undefined);
  useEffect(() => {
    if (ride.loading) return;
    const cur = ride.data ? { id: ride.data.id, status: ride.data.status, arrived: Boolean(ride.data.arrived_at) } : null;
    const was = prev.current;
    prev.current = cur;
    if (was === undefined) return; // first load: nothing "happened"
    if (!isDriver) {
      if (cur?.status === 'accepted' && cur.arrived && was?.id === cur.id && !was.arrived) {
        // The driver tapped "I've arrived": the automated chat message is already in the thread.
        chime(); buzz([200, 80, 200]);
        toast({ tone: 'success', title: `${firstName(ride.data.driver?.name)} has arrived`, body: `Meet them at the pickup point. Look for ${ride.data.driver?.vehicle_registration ?? 'your car'}.`, ms: 9000, action: { label: 'Open chat', onClick: () => { setChatOpen(true); setReadAt(new Date().toISOString()); } } });
      } else if (cur?.status === 'accepted' && was?.status !== 'accepted') {
        toast({ tone: 'success', title: `${firstName(ride.data.driver?.name)} is on the way`, body: `${ride.data.driver?.vehicle_model ?? ''} · ${ride.data.driver?.vehicle_registration ?? ''}`, action: { label: 'Track your ride', to: `/passenger/ride/${cur.id}` } });
        celebrate();
      } else if (cur?.status === 'in_progress' && was?.status === 'accepted') {
        toast({ title: 'Trip started', body: 'Sit back. We’ll keep the map updated.' });
      } else if (!cur && was?.status === 'in_progress') {
        toast({ tone: 'success', title: 'You’ve arrived', body: 'Thanks for riding with Delta.', action: { label: 'See trip summary', to: `/passenger/ride/${was.id}` } });
        celebrate();
      } else if (!cur && (was?.status === 'accepted' || was?.status === 'searching')) {
        toast({ tone: 'warn', title: 'Your ride ended', action: { label: 'See what happened', to: `/passenger/ride/${was.id}` } });
      }
    } else if (!cur && was?.status === 'accepted') {
      toast({ tone: 'warn', title: 'The passenger cancelled', body: 'You’re free for new requests.' });
    }
  }, [ride.data, ride.loading, isDriver, toast]);

  // Tab title shows waiting requests so a driver on another tab notices them.
  useEffect(() => {
    const base = 'Delta';
    document.title = offers.length ? `(${offers.length}) New ride request · ${base}` : base;
    return () => { document.title = base; };
  }, [offers.length]);

  const value = useMemo(() => ({
    activeRide: ride.data, rideLoading: ride.loading, refreshRide: ride.refresh,
    driver, driverLoading: driverState.loading, setDriver: driverState.setData, refreshDriver: driverState.refresh,
    online, offers, offersLoading: isDriver && online && offersLive.loading, offerError, busyOfferId,
    acceptOffer, rejectOffer, loc, connection: ride.connection,
    chat: { rideId: chatRideId, messages, canSend: Boolean(chatLive.data?.can_send), loading: chatLive.loading, error: chatLive.error, open: chatOpen, unread, openChat, closeChat, send: sendMessage },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [ride.data, ride.loading, ride.connection, driver, driverState.loading, online, offers, offersLive.loading, offerError, busyOfferId, loc, chatRideId, messages, chatLive.data, chatLive.loading, chatLive.error, chatOpen, unread]);

  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>;
}

export const useLiveData = () => useContext(LiveContext);
