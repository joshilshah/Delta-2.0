// Browser geolocation + reverse geocoding helpers for the customer's pickup.

export class LocationError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

/** One permission-based reading. Low accuracy + short cache: plenty for a pickup and far more reliable on desktops. */
export function getCurrentPosition({ timeout = 12_000 } = {}) {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) return reject(new LocationError('unsupported', 'This browser cannot share your location.'));
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => resolve({ latitude: coords.latitude, longitude: coords.longitude, accuracy: coords.accuracy }),
      (err) => reject(err.code === err.PERMISSION_DENIED
        ? new LocationError('denied', 'Location access is blocked. Allow it in your browser’s site settings, or type a pickup instead.')
        : new LocationError('unavailable', 'Could not find your location. Type a pickup instead.')),
      { enableHighAccuracy: false, timeout, maximumAge: 30_000 },
    );
  });
}

export const coordsLabel = (lat, lng) => `Current location (${lat.toFixed(5)}, ${lng.toFixed(5)})`;

/**
 * Turn coordinates into a readable address using OpenStreetMap's Nominatim service.
 * Note: this sends the coordinates to that third-party service. If it fails or is slow we fall back to a
 * coordinates label so booking never blocks on it.
 */
export async function reverseGeocode(latitude, longitude) {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&addressdetails=0&lat=${latitude}&lon=${longitude}`;
    const res = await fetch(url, { headers: { 'Accept-Language': 'en' }, signal: AbortSignal.timeout(6000) });
    if (!res.ok) throw new Error('geocode failed');
    const data = await res.json();
    const name = String(data.display_name ?? '').split(',').slice(0, 4).join(',').trim();
    return name.length >= 3 ? name : coordsLabel(latitude, longitude);
  } catch {
    return coordsLabel(latitude, longitude);
  }
}

/** Current position as a bookable place: { address, latitude, longitude }. */
export async function locateMe() {
  const pos = await getCurrentPosition();
  const address = await reverseGeocode(pos.latitude, pos.longitude);
  return { address, latitude: pos.latitude, longitude: pos.longitude };
}
