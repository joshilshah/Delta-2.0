import { useState } from 'react';
import LiveMap from './LiveMap.jsx';
import GoogleLiveMap from './GoogleLiveMap.jsx';
import { mapsConfigured } from '../lib/maps.js';
import { Segmented } from './ui.jsx';
import { useTheme } from '../context/ThemeContext.jsx';

const read = () => { try { return localStorage.getItem('delta.map.mode') === 'google' ? 'google' : 'delta'; } catch { return 'delta'; } };
const write = (v) => { try { localStorage.setItem('delta.map.mode', v); } catch { /* storage unavailable */ } };

// ~11 m precision: stops the embed reloading for tiny GPS jitter.
const pt = (p) => `${p.latitude.toFixed(4)},${p.longitude.toFixed(4)}`;

/**
 * Embedded Google Maps (iframe, no API key or billing). An embed cannot take custom markers, so the trip is
 * expressed as a Google route whose two ends are the two parties.
 */
export function googleEmbed({ pickup, destination, driver, status }) {
  if (!pickup) return null;
  const base = 'https://www.google.com/maps?output=embed&hl=en&dirflg=d';
  if (driver && status === 'accepted') return { url: `${base}&saddr=${pt(driver)}&daddr=${pt(pickup)}`, caption: 'Driver to pickup' };
  if (driver && status === 'in_progress' && destination) return { url: `${base}&saddr=${pt(driver)}&daddr=${pt(destination)}`, caption: 'Driver to destination' };
  if (destination) return { url: `${base}&saddr=${pt(pickup)}&daddr=${pt(destination)}`, caption: 'Pickup to destination' };
  return { url: `https://www.google.com/maps?output=embed&hl=en&z=16&q=${pt(pickup)}`, caption: 'Your pickup point' };
}

/**
 * The map stage: Delta's live map (markers, radar, tap-to-pick) with a switch to the embedded Google map
 * (real road route + ETA). Used full-bleed on map-first pages.
 */
export default function MapView({ status, fill = false, night: nightProp, overlay, ...mapProps }) {
  const theme = useTheme();
  const night = nightProp ?? theme.dark;
  const [mode, setMode] = useState(read);
  const [googleEta, setGoogleEta] = useState(null);
  const embed = googleEmbed({ ...mapProps, status });
  const choose = (m) => { setMode(m); write(m); };
  const showGoogle = mode === 'google' && embed;
  // With a browser key: the interactive Google map (live markers, route, Google ETA). Without: the embed.
  const interactiveGoogle = showGoogle && mapsConfigured;

  return (
    <div className={`relative ${fill ? 'h-full w-full' : ''}`}>
      {interactiveGoogle ? (
        <GoogleLiveMap pickup={mapProps.pickup} destination={mapProps.destination} driver={mapProps.driver} path={mapProps.path}
          status={status} fill={fill} onEta={setGoogleEta} />
      ) : showGoogle ? (
        <iframe key={embed.url} title="Google Maps" src={embed.url} loading="lazy" referrerPolicy="no-referrer-when-downgrade" allowFullScreen
          className={fill ? 'absolute inset-0 h-full w-full border-0' : 'h-64 w-full rounded-3xl border-0 ring-1 ring-line sm:h-80'} />
      ) : (
        <LiveMap {...mapProps} night={night} fill={fill} />
      )}
      <div className={`pointer-events-none absolute right-3 top-3 z-[500] flex flex-col items-end gap-2 ${night ? 'theme-night' : ''}`}>
        {embed && (
          <Segmented className="pointer-events-auto shadow-lg" label="Map style" value={mode} onChange={choose}
            options={[['delta', 'Delta map'], ['google', 'Google Maps']]} />
        )}
        {showGoogle && <span className="chip pointer-events-auto shadow">{embed.caption}{interactiveGoogle && googleEta ? ` · ${googleEta.minutes} min (Google)` : ''}</span>}
        {mode === 'delta' && !mapsConfigured && mapProps.driver && ['accepted', 'in_progress'].includes(status) && (
          <span className="chip pointer-events-auto shadow" title="Add VITE_GOOGLE_MAPS_BROWSER_KEY to use the interactive Google map">Live on Delta map · Google live map needs a key</span>
        )}
        {overlay}
      </div>
    </div>
  );
}
