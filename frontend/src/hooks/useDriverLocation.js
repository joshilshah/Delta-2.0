import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../services/api.js';

const REFRESH_MS = 30_000;
// Fixed Bengaluru point used by the optional demo source (near the seeded demo drivers).
export const DEMO_POINT = { latitude: 12.9738, longitude: 77.601 };

const read = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const write = (k, v) => { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } };

/**
 * Permission-based location sharing for drivers: one reading per share() call, plus an optional
 * foreground refresh every 30 s while the page is open and the driver is online. No background tracking.
 *
 * Stability notes:
 *  - automatic refreshes are silent (no spinner flicker) and never overwrite a good state with a one-off timeout;
 *    an error is only surfaced after two failures in a row, or immediately when permission is denied
 *  - low-accuracy + cached reading is plenty for dispatch and is far more reliable on desktops
 *  - readings are sent one at a time (a late response can't clobber a newer one)
 */
/** Move `from` up to `meters` toward `to` (demo drive). */
function stepToward(from, to, meters) {
  const dy = (to.latitude - from.latitude) * 110_570;
  const dx = (to.longitude - from.longitude) * 111_320 * Math.cos((from.latitude * Math.PI) / 180);
  const d = Math.hypot(dx, dy);
  if (d <= meters) return { latitude: to.latitude, longitude: to.longitude };
  const f = meters / d;
  return { latitude: from.latitude + (to.latitude - from.latitude) * f, longitude: from.longitude + (to.longitude - from.longitude) * f };
}

/**
 * `target` (optional): where the driver is heading during a ride. With the Demo source, each update
 * simulates driving ~`demoStepMeters` toward it (clearly a simulation, for demos where GPS isn't available).
 * With the Device source, trip updates ask for a fresh, high-accuracy fix.
 */
export function useDriverLocation({ online, onUpdated, intervalMs = REFRESH_MS, target = null, demoStepMeters = 150 }) {
  const targetRef = useRef(target);
  const demoPos = useRef(null);
  useEffect(() => { targetRef.current = target; });
  const [status, setStatus] = useState('idle'); // idle | asking | ok | denied | unsupported | error
  const [message, setMessage] = useState(null);
  const [lastOkAt, setLastOkAt] = useState(null);
  const [auto, setAutoState] = useState(() => read('Delta.loc.auto', '1') === '1');
  const [source, setSourceState] = useState(() => read('Delta.loc.source', 'device'));
  const inFlight = useRef(false);
  const failures = useRef(0);
  const sourceRef = useRef(source);
  const onUpdatedRef = useRef(onUpdated);
  useEffect(() => { onUpdatedRef.current = onUpdated; sourceRef.current = source; });

  const setAuto = (v) => { setAutoState(v); write('Delta.loc.auto', v ? '1' : '0'); };
  const setSource = (v) => { setSourceState(v); write('Delta.loc.source', v); };

  const send = useCallback(async ({ latitude, longitude }, silent) => {
    if (sourceRef.current !== 'demo') demoPos.current = null; // a demo drive restarts from the demo point
    try {
      await api.updateLocation(latitude, longitude);
      failures.current = 0;
      setStatus('ok');
      setMessage(null);
      setLastOkAt(Date.now());
      onUpdatedRef.current?.();
    } catch (e) {
      failures.current += 1;
      if (!silent || failures.current >= 2) { setStatus('error'); setMessage(e.message); }
    }
  }, []);

  const share = useCallback(({ silent = false } = {}) => {
    if (inFlight.current) return Promise.resolve();
    inFlight.current = true;
    if (!silent) setStatus('asking');
    const done = () => { inFlight.current = false; };

    if (sourceRef.current === 'demo') {
      const at = demoPos.current ?? DEMO_POINT;
      const next = targetRef.current ? stepToward(at, targetRef.current, demoStepMeters) : at;
      demoPos.current = next;
      return send(next, silent).finally(done);
    }

    if (!('geolocation' in navigator)) {
      setStatus('unsupported');
      setMessage('This browser does not support location sharing.');
      done();
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        async ({ coords }) => { await send(coords, silent); done(); resolve(); },
        (err) => {
          failures.current += 1;
          if (err.code === err.PERMISSION_DENIED) {
            setStatus('denied');
            setMessage('Location access is blocked. Allow it in your browser’s site settings, or switch to the demo location below.');
          } else if (!silent || failures.current >= 2) {
            setStatus('error');
            setMessage('Could not read your location. Check that location services are on, or use the demo location.');
          }
          done();
          resolve();
        },
        targetRef.current
          ? { enableHighAccuracy: true, timeout: 15_000, maximumAge: 5_000 }   // on a trip: fresh fixes for live tracking
          : { enableHighAccuracy: false, timeout: 20_000, maximumAge: 60_000 }, // idle: cheap, cached fixes are enough
      );
    });
  }, [send, demoStepMeters]);

  // Re-share immediately when the source changes while online.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return undefined; }
    if (!online) return undefined;
    failures.current = 0;
    const t = setTimeout(() => share(), 0);
    return () => clearTimeout(t);
  }, [source, online, share]);

  useEffect(() => {
    if (!online || !auto) return undefined;
    const kickoff = setTimeout(() => share({ silent: true }), 0);
    const timer = setInterval(() => share({ silent: true }), intervalMs);
    return () => { clearTimeout(kickoff); clearInterval(timer); };
  }, [online, auto, share, intervalMs]);

  return { status, message, lastOkAt, share, auto, setAuto, source, setSource };
}

