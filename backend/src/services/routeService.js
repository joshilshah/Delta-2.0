import { AppError } from '../errors.js';
import { haversineKm } from '../matching/geo.js';

const ROUTES_URL = 'https://routes.googleapis.com/directions/v2:computeRoutes';

/**
 * Route provider. 'google' calls the Google Routes API (server key, never sent to browsers).
 * 'mock' is for offline development only and is flagged via `source: 'mock'`.
 * Returns { distanceKm, durationMinutes, source }.
 */
export function createRouteService({ apiKey, provider = 'google', timeoutMs = 8000, fetchImpl = fetch }) {
  const point = (p) => ({ location: { latLng: { latitude: p.latitude, longitude: p.longitude } } });

  async function googleRoute(origin, destination) {
    if (!apiKey) {
      throw new AppError(503, 'ROUTING_NOT_CONFIGURED',
        'Route calculation is not configured on the server (missing GOOGLE_MAPS_SERVER_KEY).');
    }
    let response;
    try {
      response = await fetchImpl(ROUTES_URL, {
        method: 'POST',
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration',
        },
        body: JSON.stringify({
          origin: point(origin),
          destination: point(destination),
          travelMode: 'DRIVE',
          routingPreference: 'TRAFFIC_UNAWARE',
          units: 'METRIC',
        }),
      });
    } catch {
      throw new AppError(502, 'ROUTING_UNAVAILABLE', 'Could not reach the routing service. Please try again.');
    }

    if (!response.ok) {
      // 400 for unroutable coordinates is possible; 403/429/5xx mean the service itself is unusable.
      const status = response.status === 400 ? 422 : 502;
      throw new AppError(status, status === 422 ? 'NO_ROUTE' : 'ROUTING_UNAVAILABLE',
        status === 422 ? 'No drivable route was found between these locations.'
                       : 'The routing service returned an error. Please try again.');
    }

    const data = await response.json().catch(() => ({}));
    const route = data.routes?.[0];
    if (!route || !Number.isFinite(route.distanceMeters) || !route.duration) {
      throw new AppError(422, 'NO_ROUTE', 'No drivable route was found between these locations.');
    }
    const seconds = parseFloat(String(route.duration).replace('s', ''));
    if (!Number.isFinite(seconds)) {
      throw new AppError(502, 'ROUTING_UNAVAILABLE', 'The routing service returned an unreadable response.');
    }
    return { distanceKm: route.distanceMeters / 1000, durationMinutes: seconds / 60, source: 'google' };
  }

  async function mockRoute(origin, destination) {
    const km = haversineKm(origin.latitude, origin.longitude, destination.latitude, destination.longitude) * 1.3;
    return { distanceKm: km, durationMinutes: (km / 25) * 60, source: 'mock' };
  }

  return {
    getRoute: (origin, destination) =>
      provider === 'mock' ? mockRoute(origin, destination) : googleRoute(origin, destination),
  };
}
