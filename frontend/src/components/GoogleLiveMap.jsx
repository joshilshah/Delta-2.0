import { useEffect, useRef, useState } from 'react';
import { loadMapsLibrary } from '../lib/maps.js';

const ll = (p) => (p ? { lat: p.latitude, lng: p.longitude } : null);
const dot = (fill, scale = 8) => ({ path: 0 /* google.maps.SymbolPath.CIRCLE */, fillColor: fill, fillOpacity: 1, strokeColor: '#fff', strokeWeight: 3, scale });

/**
 * Interactive Google map (Maps JavaScript API) for live trips: pickup, drop-off, the driver's live marker
 * (gliding between fixes), the driven path, and the road route + Google ETA for the current leg.
 * Only used when VITE_GOOGLE_MAPS_BROWSER_KEY is set; otherwise the Delta map does the same job.
 * The route request needs the "Directions API" (legacy) enabled on the key; without it the map still works
 * and the ETA falls back to Delta's estimate.
 */
export default function GoogleLiveMap({ pickup, destination, driver, status, path, fill = false, onEta }) {
  const el = useRef(null);
  const g = useRef(null); // { map, markers, lines, directions }
  const [error, setError] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const { Map, Marker, Polyline } = await loadMapsLibrary('maps').then(async (m) => ({ ...m, ...(await loadMapsLibrary('marker')) }));
        if (dead || !el.current) return;
        const map = new Map(el.current, {
          center: ll(pickup) ?? { lat: 12.9716, lng: 77.5946 }, zoom: 14, disableDefaultUI: true, zoomControl: true, clickableIcons: false,
        });
        g.current = {
          map,
          pickup: new Marker({ map, icon: dot('#0E1116'), title: 'Pickup' }),
          dest: new Marker({ map, icon: dot('#2F5BFF'), title: 'Drop-off' }),
          driver: new Marker({ map, icon: dot('#D7FF3C', 10), title: 'Driver', zIndex: 10 }),
          route: new Polyline({ map, strokeColor: '#2F5BFF', strokeOpacity: 0.85, strokeWeight: 5 }),
          driven: new Polyline({ map, strokeColor: '#0E1116', strokeOpacity: 0.7, strokeWeight: 4 }),
          fitted: '',
          routeKey: '',
        };
        setReady(true);
      } catch (e) { if (!dead) setError(e.message); }
    })();
    return () => { dead = true; g.current = null; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const key = [pickup, destination, driver].map((p) => (p ? `${p.latitude.toFixed(5)},${p.longitude.toFixed(5)}` : '-')).join('|') + status + (path?.length ?? 0);
  useEffect(() => {
    const s = g.current;
    if (!s) return undefined;
    s.pickup.setPosition(ll(pickup));
    s.dest.setPosition(ll(destination));
    // Glide the driver marker.
    const to = ll(driver);
    const from = s.driver.getPosition();
    let raf;
    if (to && from) {
      const t0 = performance.now();
      const step = (t) => {
        const k = Math.min(1, (t - t0) / 1200); const e = 1 - (1 - k) ** 3;
        s.driver.setPosition({ lat: from.lat() + (to.lat - from.lat()) * e, lng: from.lng() + (to.lng - from.lng()) * e });
        if (k < 1) raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    } else s.driver.setPosition(to);
    s.driven.setPath((path ?? []).map(ll));

    // Frame once per set of points.
    const pts = [pickup, destination, driver].filter(Boolean).map(ll);
    const fk = pts.length + (driver ? 'd' : '');
    if (pts.length && fk !== s.fitted) {
      s.fitted = fk;
      const b = new window.google.maps.LatLngBounds();
      pts.forEach((p) => b.extend(p));
      s.map.fitBounds(b, 64);
    }

    // Road route + Google ETA for the current leg, refreshed when the driver moved ~100 m.
    const legFrom = driver && ['accepted', 'in_progress'].includes(status) ? driver : pickup;
    const legTo = status === 'accepted' ? pickup : destination;
    const rk = legFrom && legTo ? `${legFrom.latitude.toFixed(3)},${legFrom.longitude.toFixed(3)}>${legTo.latitude.toFixed(4)}` : '';
    if (rk && rk !== s.routeKey) {
      s.routeKey = rk;
      loadMapsLibrary('routes').then(({ DirectionsService }) => new DirectionsService().route({
        origin: ll(legFrom), destination: ll(legTo), travelMode: 'DRIVING',
      })).then((res) => {
        const leg = res.routes[0]?.legs[0];
        s.route.setPath(res.routes[0]?.overview_path ?? []);
        if (leg) onEta?.({ minutes: Math.max(1, Math.round(leg.duration.value / 60)), distance_km: Math.round(leg.distance.value / 100) / 10, source: 'google' });
      }).catch(() => { s.route.setPath([ll(legFrom), ll(legTo)]); onEta?.(null); });
    }
    return () => cancelAnimationFrame(raf);
  }, [key, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={fill ? 'absolute inset-0' : 'relative h-64 overflow-hidden rounded-3xl ring-1 ring-line sm:h-80'}>
      <div ref={el} className="h-full w-full" />
      {error && <div className="absolute inset-0 grid place-items-center bg-surface-2 p-6 text-center text-sm text-muted">Google Maps couldn’t load ({error}). Switch to the Delta map.</div>}
    </div>
  );
}
