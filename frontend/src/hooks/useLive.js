import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase.js';

/**
 * Keeps server state fresh. Supabase Realtime (postgres_changes, filtered by RLS) triggers an
 * immediate refetch; polling runs regardless as the reliable fallback, so refreshes, dropped
 * sockets and reconnects always recover the true state from the database via the API.
 */
export function useLive(fetcher, { intervalMs = 3000, realtime, enabled = true } = {}) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  // 'live' = realtime socket subscribed, 'polling' = socket down (polling keeps working), 'offline' = no network.
  const [connection, setConnection] = useState('polling');
  const fetcherRef = useRef(fetcher);
  useEffect(() => { fetcherRef.current = fetcher; });

  const refresh = useCallback(async () => {
    try {
      const next = await fetcherRef.current();
      setData(next);
      setError(null);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, []);

  // One or several realtime sources, e.g. [{ table: 'rides', filter }, { table: 'ride_tracking_events', filter }].
  const sources = realtime ? (Array.isArray(realtime) ? realtime : [realtime]) : [];
  const sourceKey = sources.map((s) => `${s.table}:${s.filter ?? ''}`).join('|');

  useEffect(() => {
    if (!enabled) return undefined;
    const first = setTimeout(refresh, 0);
    const timer = setInterval(refresh, intervalMs);
    const onVisible = () => { if (document.visibilityState === 'visible') refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    // Back online: refetch immediately (the socket reconnects itself) so nothing missed while offline is lost.
    const onOnline = () => { setConnection('polling'); refresh(); };
    const onOffline = () => setConnection('offline');
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);

    let channel;
    const specs = sourceKey ? sourceKey.split('|').map((s) => { const i = s.indexOf(':'); return [s.slice(0, i), s.slice(i + 1)]; }) : [];
    if (supabase && specs.length) {
      channel = supabase.channel(`live-${sourceKey}-${Math.random().toString(36).slice(2, 7)}`);
      for (const [table, filter] of specs) {
        channel = channel.on('postgres_changes', { event: '*', schema: 'public', table, ...(filter ? { filter } : {}) }, refresh);
      }
      channel.subscribe((status) => {
        if (status === 'SUBSCRIBED') { setConnection(navigator.onLine === false ? 'offline' : 'live'); refresh(); }
        else if (['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(status)) setConnection(navigator.onLine === false ? 'offline' : 'polling');
      });
    }
    return () => {
      clearTimeout(first);
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      if (channel) supabase.removeChannel(channel);
    };
  }, [enabled, intervalMs, refresh, sourceKey]);

  return { data, error, loading, refresh, setData, connection };
}

/** Re-renders on an interval so "x seconds ago" labels stay accurate. */
export function useNow(ms = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

/** Seconds remaining until a deadline derived from a server-provided "seconds left". */
export function useCountdown(secondsLeft, key) {
  const [left, setLeft] = useState(secondsLeft ?? 0);
  useEffect(() => {
    if (secondsLeft == null) return undefined;
    const deadline = Date.now() + secondsLeft * 1000;
    const tick = () => setLeft(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
    tick();
    const t = setInterval(tick, 250);
    return () => clearInterval(t);
  }, [secondsLeft, key]);
  return secondsLeft == null ? null : left;
}
