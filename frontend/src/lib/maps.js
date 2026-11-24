// Google Maps JS API loader + Places (New) autocomplete helpers.
// The browser key must be restricted by HTTP referrer and to the Maps JavaScript + Places APIs only.

const KEY = import.meta.env.VITE_GOOGLE_MAPS_BROWSER_KEY;
export const mapsConfigured = Boolean(KEY);

let loader;
function loadMaps() {
  if (!KEY) return Promise.reject(new Error('Google Maps key is not configured'));
  if (!loader) {
    loader = new Promise((resolve, reject) => {
      if (window.google?.maps?.importLibrary) return resolve();
      const s = document.createElement('script');
      s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(KEY)}&loading=async&v=weekly`;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => { loader = null; reject(new Error('Failed to load Google Maps')); };
      document.head.appendChild(s);
    });
  }
  return loader.then(() => window.google.maps.importLibrary('places'));
}

/** Load any Maps JS library ('maps', 'marker', 'routes', ...) once the script is in. */
export async function loadMapsLibrary(name) {
  await loadMaps();
  return window.google.maps.importLibrary(name);
}

export async function newSessionToken() {
  const { AutocompleteSessionToken } = await loadMaps();
  return new AutocompleteSessionToken();
}

export async function suggestPlaces(input, sessionToken) {
  const { AutocompleteSuggestion } = await loadMaps();
  const { suggestions } = await AutocompleteSuggestion.fetchAutocompleteSuggestions({
    input, sessionToken, includedRegionCodes: ['in'],
  });
  return suggestions.filter((s) => s.placePrediction).map((s) => ({
    id: s.placePrediction.placeId,
    text: s.placePrediction.text.text,
    prediction: s.placePrediction,
  }));
}

/** Resolve a prediction to validated coordinates + a readable address. */
export async function resolvePlace(prediction) {
  const place = prediction.toPlace();
  await place.fetchFields({ fields: ['location', 'formattedAddress', 'displayName'] });
  if (!place.location) throw new Error('This place has no coordinates');
  return {
    address: [place.displayName, place.formattedAddress].filter(Boolean).join(', ') || prediction.text.text,
    latitude: place.location.lat(),
    longitude: place.location.lng(),
  };
}

/**
 * Keyless place search used when no Google key is configured: Photon (komoot), built on OpenStreetMap data
 * and designed for search-as-you-type. Results are biased toward `near` (e.g. the customer's location).
 * Note: the typed text is sent to that third-party service.
 */
export async function searchOsm(query, near, signal) {
  const bias = near ? `&lat=${near.latitude}&lon=${near.longitude}` : '&lat=12.9716&lon=77.5946'; // default: Bengaluru
  const res = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=7&lang=en${bias}`, { signal });
  if (!res.ok) throw new Error('search failed');
  const data = await res.json();
  const seen = new Set();
  const out = [];
  for (const f of data.features ?? []) {
    const p = f.properties ?? {};
    const [lng, lat] = f.geometry?.coordinates ?? [];
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const street = [p.housenumber, p.street].filter(Boolean).join(' ');
    const parts = [p.name, street, p.district || p.locality, p.city || p.county, p.state]
      .filter(Boolean).filter((v, i, a) => a.indexOf(v) === i);
    const address = parts.slice(0, 4).join(', ');
    if (!address || seen.has(address)) continue;
    seen.add(address);
    out.push({ id: `${p.osm_type}${p.osm_id}`, text: address, address, latitude: lat, longitude: lng });
  }
  return out;
}
