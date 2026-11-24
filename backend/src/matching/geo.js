const EARTH_RADIUS_KM = 6371.0088;
const toRad = (deg) => (deg * Math.PI) / 180;

/**
 * Great-circle (straight-line) distance in km. This is NOT road distance or ETA.
 * Must stay numerically aligned with public.haversine_km() in the database.
 */
export function haversineKm(lat1, lon1, lat2, lon2) {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(Math.min(1, a)));
}

/**
 * Shortest distance (km) from point P to the segment A-B, on a local flat projection
 * (accurate to well under 1% at city scale). Used for route-deviation monitoring.
 */
export function distanceToSegmentKm(p, a, b) {
  const kx = 111.32 * Math.cos(toRad(a.latitude));
  const ky = 110.57;
  const px = (p.longitude - a.longitude) * kx; const py = (p.latitude - a.latitude) * ky;
  const bx = (b.longitude - a.longitude) * kx; const by = (b.latitude - a.latitude) * ky;
  const len2 = bx * bx + by * by;
  const t = len2 ? Math.max(0, Math.min(1, (px * bx + py * by) / len2)) : 0;
  return Math.hypot(px - t * bx, py - t * by);
}

/** Rough road ETA from straight-line distance: x1.3 road factor at an average city speed. Labelled "estimate" in the API. */
export function estimateEta(from, to, avgKmh = 24) {
  const roadKm = haversineKm(from.latitude, from.longitude, to.latitude, to.longitude) * 1.3;
  return { distance_km: Math.round(roadKm * 10) / 10, minutes: Math.max(1, Math.round((roadKm / avgKmh) * 60)) };
}
