import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { X } from 'lucide-react';
import { reverseGeocode } from '../lib/geo.js';
import { Spinner } from './ui.jsx';

const PIN = L.divIcon({
  className: '',
  html: '<div class="h-5 w-5 -translate-y-1 rounded-full border-4 border-white bg-accent shadow-lg"></div>',
  iconSize: [20, 20], iconAnchor: [10, 10],
});

/**
 * Full-screen "choose on map" for places no search service knows about (a hostel gate, a side lane...).
 * Tap the map to drop a pin; the address label comes from reverse geocoding, and the exact pin
 * coordinates are what gets booked.
 */
export default function MapPicker({ title, start, onPick, onClose }) {
  const el = useRef(null);
  const marker = useRef(null);
  const seq = useRef(0);
  const [picked, setPicked] = useState(null); // { latitude, longitude, address|null }

  useEffect(() => {
    const center = start ? [start.latitude, start.longitude] : [12.9716, 77.5946];
    const m = L.map(el.current, { zoomControl: true }).setView(center, start ? 17 : 13);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors', maxZoom: 19,
    }).addTo(m);
    m.on('click', async ({ latlng }) => {
      const mine = ++seq.current;
      if (!marker.current) marker.current = L.marker(latlng, { icon: PIN }).addTo(m);
      else marker.current.setLatLng(latlng);
      setPicked({ latitude: latlng.lat, longitude: latlng.lng, address: null });
      const address = await reverseGeocode(latlng.lat, latlng.lng);
      if (mine === seq.current) setPicked({ latitude: latlng.lat, longitude: latlng.lng, address });
    });
    // The dialog lays out after the map is created: keep Leaflet's size in sync so tiles fill the whole area.
    const ro = new ResizeObserver(() => m.invalidateSize());
    ro.observe(el.current);
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => { ro.disconnect(); window.removeEventListener('keydown', onKey); m.remove(); marker.current = null; };
  }, [start, onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 backdrop-blur-sm sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-label={title}>
      <div className="sheet flex h-[92vh] w-full max-w-2xl animate-pop flex-col overflow-hidden !rounded-b-none sm:h-[80vh] sm:!rounded-[28px]">
        <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
          <div><h2 className="text-lg font-semibold">{title}</h2><p className="text-xs text-muted">Zoom in and tap the exact spot. The pin is what gets booked.</p></div>
          <button onClick={onClose} className="btn-outline btn-icon" aria-label="Close"><X className="h-4 w-4" aria-hidden /></button>
        </div>
        <div ref={el} className="delta-map isolate z-0 min-h-0 flex-1" />
        <div className="space-y-3 border-t border-line p-4">
          <p className="min-h-5 text-sm">
            {!picked ? <span className="text-muted">No point chosen yet.</span>
              : picked.address ? picked.address
                : <span className="inline-flex items-center gap-2 text-muted"><Spinner /> Finding the address…</span>}
          </p>
          <button className="btn-primary btn-lg w-full" disabled={!picked?.address}
            onClick={() => onPick({ address: picked.address, latitude: picked.latitude, longitude: picked.longitude })}>
            Use this location
          </button>
        </div>
      </div>
    </div>
  );
}
