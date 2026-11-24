import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useNow } from '../hooks/useLive.js';
import { useTheme } from '../context/ThemeContext.jsx';

// OpenStreetMap tiles (no API key; attribution required and shown). The CSS filter in index.css gives them
// Delta's paper / night look. For production traffic switch to a commercial tile provider.
const TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
const BENGALURU = [12.9716, 77.5946];

const icon = (html, w, h = w, anchor = [w / 2, h / 2]) => L.divIcon({ className: '', html, iconSize: [w, h], iconAnchor: anchor });
const PICKUP = icon('<span class="block h-[18px] w-[18px] rounded-full bg-white shadow-md ring-[5px] ring-[#0E1116]"></span>', 18);
// The destination is a Δ: Delta's mark doubles as "where you're going".
const DROPOFF = icon('<svg viewBox="0 0 28 26" class="h-[26px] w-[28px] drop-shadow-md"><path d="M14 2 26.5 23.5h-25Z" fill="#2F5BFF" stroke="#fff" stroke-width="2.6" stroke-linejoin="round"/></svg>', 28, 26, [14, 18]);
const DRIVER = icon(
  `<span class="grid h-11 w-11 place-items-center rounded-full bg-[#0E1116] shadow-xl ring-4 ring-[#D7FF3C]/70">
     <svg viewBox="0 0 24 24" class="h-5 w-5" fill="#D7FF3C"><path d="M12 2.5 19.5 20 12 16.2 4.5 20Z"/></svg>
   </span>`, 44);
const YOU = icon(
  `<span class="relative block h-4 w-4">
     <span class="absolute -inset-3 rounded-full bg-[#2F5BFF]/25 animate-radar"></span>
     <span class="relative block h-4 w-4 rounded-full bg-[#2F5BFF] shadow ring-[3px] ring-white"></span>
   </span>`, 16);
const RADAR = icon(
  `<span class="relative block h-0 w-0">
     <span class="absolute -left-24 -top-24 h-48 w-48 rounded-full border-2 border-[#2F5BFF]/70 animate-radar"></span>
     <span class="absolute -left-24 -top-24 h-48 w-48 rounded-full border-2 border-[#2F5BFF]/50 animate-radar [animation-delay:0.8s]"></span>
     <span class="absolute -left-24 -top-24 h-48 w-48 rounded-full bg-[#2F5BFF]/10 animate-radar [animation-delay:1.6s]"></span>
   </span>`, 0);
const PLACE = icon('<span class="grid h-7 w-7 place-items-center rounded-full bg-white shadow-md ring-1 ring-black/10"><span class="h-2 w-2 rounded-full bg-[#0E1116]"></span></span>', 28);

const ago = (iso, now) => {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  return s < 8 ? 'just now' : s < 60 ? `${s}s ago` : `${Math.floor(s / 60)}m ago`;
};

/** A gentle arc between two points (a guide line, not the road route). */
function arc(a, b, bend = 0.16, n = 40) {
  const [x1, y1] = a; const [x2, y2] = b;
  const cx = (x1 + x2) / 2 - (y2 - y1) * bend;
  const cy = (y1 + y2) / 2 + (x2 - x1) * bend;
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n; const u = 1 - t;
    return [u * u * x1 + 2 * u * t * cx + t * t * x2, u * u * y1 + 2 * u * t * cy + t * t * y2];
  });
}

/**
 * Delta's live map. Shows the pickup, the destination (Δ), the driver's last shared position, the viewer's own
 * position, a "searching" radar, and optional saved places. Can fill its parent (map-first layouts) and
 * leave room for a floating sheet on the left via `fitLeft`.
 */
export default function LiveMap({
  pickup, destination, driver, you, places = [], pickupLabel = 'Pickup', driverLabel = 'Driver', approach = true, searching = false,
  night: nightProp, fill = false, interactive = true, fitLeft = 0, onMapClick, onPlaceClick, className = '',
  smoothFit = false, animateDriver = false, path = null,
}) {
  // Follows the app theme unless a page forces night (hero sections, auth panel).
  const theme = useTheme();
  const night = nightProp ?? theme.dark;
  const tripRef = useRef(null);
  const el = useRef(null);
  const map = useRef(null);
  const layers = useRef({ places: new Map() });
  const fitKey = useRef('');
  const handlers = useRef({});
  const refit = useRef(null);
  const now = useNow(5000);
  useEffect(() => { handlers.current = { onMapClick, onPlaceClick }; });

  // Create the map once.
  useEffect(() => {
    const m = L.map(el.current, {
      zoomControl: false, attributionControl: true,
      scrollWheelZoom: interactive && fill, dragging: interactive && (fill || !L.Browser.mobile), tap: false,
      touchZoom: interactive, doubleClickZoom: interactive, boxZoom: false, keyboard: interactive,
    }).setView(BENGALURU, 13);
    if (interactive) L.control.zoom({ position: 'bottomright' }).addTo(m);
    m.attributionControl.setPrefix(false);
    L.tileLayer(TILES, { attribution: ATTRIBUTION, maxZoom: 19 }).addTo(m);
    m.on('click', (e) => handlers.current.onMapClick?.({ latitude: e.latlng.lat, longitude: e.latlng.lng }));
    map.current = m;
    // When the container settles into its final size (layout, sheet, rotation), re-frame the points.
    let last = '';
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      const size = `${Math.round(width)}x${Math.round(height)}`;
      if (size === last || !width || !height) return;
      last = size;
      m.invalidateSize({ pan: false });
      refit.current?.();
    });
    ro.observe(el.current);
    return () => {
      ro.disconnect();
      m.remove();
      map.current = null;
      // Markers belonged to the map we just removed: forget them so the next map gets fresh ones.
      layers.current = { places: new Map() };
      fitKey.current = '';
      refit.current = null;
    };
  }, [interactive, fill]);

  const pLat = pickup?.latitude, pLng = pickup?.longitude;
  const dLat = destination?.latitude, dLng = destination?.longitude;
  const vLat = driver?.latitude, vLng = driver?.longitude, vTime = driver?.updated_at;
  const yLat = you?.latitude, yLng = you?.longitude;
  const placesKey = places.map((p) => `${p.latitude},${p.longitude}`).join('|');
  const pathKey = path?.length ? `${path.length}:${path[path.length - 1].latitude},${path[path.length - 1].longitude}` : '';
  const pathRef = useRef(path);
  useEffect(() => { pathRef.current = path; });

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const S = layers.current;
    const upsert = (key, latlng, ic, label, extra = {}) => {
      if (!latlng) { S[key]?.remove(); delete S[key]; return; }
      if (!S[key]) {
        S[key] = L.marker(latlng, { icon: ic, keyboard: false, ...extra }).addTo(m);
        if (label) S[key].bindTooltip(label, { permanent: true, direction: 'top', offset: [0, -14], className: 'delta-tip' });
      } else {
        const from = S[key].getLatLng();
        // The live driver glides to its new position instead of jumping.
        if (key === 'driver' && (from.lat !== latlng[0] || from.lng !== latlng[1]) && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
          cancelAnimationFrame(S.glide);
          const t0 = performance.now();
          const step = (t) => {
            const k = Math.min(1, (t - t0) / 1200);
            const e = 1 - (1 - k) ** 3;
            S.driver?.setLatLng([from.lat + (latlng[0] - from.lat) * e, from.lng + (latlng[1] - from.lng) * e]);
            if (k < 1) S.glide = requestAnimationFrame(step);
          };
          S.glide = requestAnimationFrame(step);
        } else S[key].setLatLng(latlng);
        if (label) S[key].setTooltipContent(label);
      }
    };
    const pk = pLat != null ? [pLat, pLng] : null;
    const ds = dLat != null ? [dLat, dLng] : null;
    const dv = vLat != null ? [vLat, vLng] : null;
    const yu = yLat != null ? [yLat, yLng] : null;

    upsert('radar', searching ? pk : null, RADAR, null, { interactive: false });
    upsert('pickup', pk, PICKUP, pickupLabel);
    upsert('dest', ds, DROPOFF, 'Drop-off');
    upsert('you', yu, YOU, null, { zIndexOffset: 500 });
    upsert('driver', dv, DRIVER, vTime ? `${driverLabel} · ${ago(vTime, Date.now())}` : driverLabel, { zIndexOffset: 1000 });

    // Routes: a casing + an animated dashed arc, so the line reads on any basemap.
    const line = (key, pts, opts) => { S[key]?.remove(); delete S[key]; if (pts) S[key] = L.polyline(pts, opts).addTo(m); };
    const trip = pk && ds ? arc(pk, ds) : null;
    const approachLine = approach && dv && pk ? arc(dv, pk, -0.12) : null;
    line('tripCase', trip, { color: night ? '#0d1117' : '#ffffff', weight: 9, opacity: 0.85, interactive: false });
    line('trip', trip, { color: night ? '#D7FF3C' : '#0E1116', weight: 4, lineCap: 'round', className: 'delta-route', interactive: false });
    line('approach', approachLine, { color: '#2F5BFF', weight: 4, lineCap: 'round', dashArray: '1 9', opacity: 0.95, interactive: false });
    // The path actually driven (recorded GPS fixes), drawn solid over the planned arc.
    const driven = pathRef.current?.length > 1 ? pathRef.current.map((p) => [p.latitude, p.longitude]) : null;
    line('driven', driven, { color: '#2F5BFF', weight: 5, opacity: 0.9, lineCap: 'round', lineJoin: 'round', interactive: false });

    // Saved / recent places as tappable pins.
    const wanted = new Set();
    for (const p of places) {
      const k = `${p.latitude},${p.longitude}`;
      wanted.add(k);
      if (!S.places.has(k)) {
        const mk = L.marker([p.latitude, p.longitude], { icon: PLACE, keyboard: false })
          .bindTooltip(p.address.split(',')[0], { direction: 'top', offset: [0, -14], className: 'delta-tip' })
          .on('click', () => handlers.current.onPlaceClick?.(p))
          .addTo(m);
        S.places.set(k, mk);
      }
    }
    for (const [k, mk] of S.places) if (!wanted.has(k)) { mk.remove(); S.places.delete(k); }

    // Fit when the set of points changes; follow the driver only if they leave the view.
    const pts = [pk, ds, dv, yu, ...places.map((p) => [p.latitude, p.longitude])].filter(Boolean);
    if (!pts.length) return;
    const key = `${pk}|${ds}|${dv ? 'd' : ''}|${yu ? 'y' : ''}|${placesKey}|${fitLeft}`;
    // Framing is instant: several fits can arrive together (layout settling, data loading) and an animated
    // zoom in progress would swallow the later ones.
    const pad = { paddingTopLeft: [fitLeft + 48, 64], paddingBottomRight: [48, 48], maxZoom: 16, animate: false };
    const fit = () => {
      const { x, y } = m.getSize();
      if (x < 50 || y < 50) return m; // not laid out yet: the resize observer will call us again
      if (pts.length > 1) return m.fitBounds(L.latLngBounds(pts), pad);
      m.setView(pts[0], 15, { animate: false });
      if (fitLeft) m.panBy([-fitLeft / 2, 0], { animate: false }); // keep a lone point clear of the sheet
      return m;
    };
    refit.current = fit;
    tripRef.current = trip;
    if (key !== fitKey.current) {
      const first = !fitKey.current;
      fitKey.current = key;
      // Showcase maps glide between routes; everything else frames instantly.
      if (smoothFit && !first && pts.length > 1) m.flyToBounds(L.latLngBounds(pts), { ...pad, animate: true, duration: 1.2 });
      else fit();
    } else if (dv && !m.getBounds().pad(-0.05).contains(dv)) fit();
  }, [pLat, pLng, dLat, dLng, vLat, vLng, vTime, yLat, yLng, pickupLabel, driverLabel, searching, approach, night, placesKey, pathKey, fitLeft, interactive, fill]); // eslint-disable-line react-hooks/exhaustive-deps

  // Showcase only: a car that drives the trip route on a loop (landing / auth pages, not live data).
  useEffect(() => {
    if (!animateDriver || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return undefined;
    let raf;
    let start = null;
    let seen = null;
    let car = null;
    const step = (t) => {
      const m = map.current;
      const pts = tripRef.current;
      if (m && pts) {
        if (pts !== seen) { seen = pts; start = t; } // new route: start again from the pickup
        const period = 6500;
        const k = Math.min(1, ((t - start) % period) / (period * 0.82)); // drive, then pause at the drop-off
        const i = (1 - (1 - k) ** 2) * (pts.length - 1);
        const a = pts[Math.floor(i)];
        const b = pts[Math.min(pts.length - 1, Math.floor(i) + 1)];
        const f = i - Math.floor(i);
        const ll = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
        if (!car || car._map !== m) { car?.remove(); car = L.marker(ll, { icon: DRIVER, interactive: false, keyboard: false, zIndexOffset: 1000 }).addTo(m); }
        else car.setLatLng(ll);
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => { cancelAnimationFrame(raf); car?.remove(); };
  }, [animateDriver]);

  // Keep the driver's "x s ago" label honest as time passes.
  useEffect(() => {
    layers.current.driver?.setTooltipContent(vTime ? `${driverLabel} · ${ago(vTime, now)}` : driverLabel);
  }, [now, vTime, driverLabel]);

  const size = fill ? 'h-full w-full' : 'h-64 w-full rounded-3xl ring-1 ring-line sm:h-80';
  // Leaflet adds its own classes to the element it owns, so React must never re-render that element's
  // className (a theme switch would wipe them). Theme classes live on this wrapper instead.
  return (
    <div className={`delta-map ${night ? 'night' : ''} isolate z-0 overflow-hidden ${size} ${className}`} role="region" aria-label="Map">
      <div ref={el} className="h-full w-full" />
    </div>
  );
}
