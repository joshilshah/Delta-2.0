import { distanceToSegmentKm, haversineKm } from '../matching/geo.js';

const meters = (a, b) => haversineKm(a.latitude, a.longitude, b.latitude, b.longitude) * 1000;

/**
 * Live trip tracking and monitoring.
 *
 * The driver's browser posts GPS fixes to /drivers/location. The latest fix always updates driver_locations
 * (one row per driver). While the driver has an active ride, a fix is ALSO appended to ride_tracking_events,
 * which Realtime pushes to the passenger. To keep writes down, an event is only stored when the driver has moved
 * `minMoveMeters` or `maxSilenceSeconds` have passed since the last one.
 *
 * Monitoring (only during the trip itself) raises *possible* safety alerts for the passenger to review:
 *  - route deviation: far from the planned pickup -> destination line (straight line: routes are estimates here);
 *  - long stop: stationary for `stopMinutes` away from the destination.
 * Alerts are never treated as emergencies automatically; the passenger dismisses them or asks for help.
 */
export function createTrackingService({ store, tracking, logger = console }) {
  const cfg = {
    minMoveMeters: 25, maxSilenceSeconds: 30, deviationMinKm: 1.2, deviationRatio: 0.35,
    stopMinutes: 5, stopRadiusMeters: 150, nearDestinationMeters: 400, alertCooldownMinutes: 10, ...tracking,
  };

  async function maybeAlert(ride, kind, message, point, now) {
    const latest = await store.latestSafetyAlert(ride.id, kind);
    if (latest && (latest.status === 'open'
      || now - new Date(latest.created_at).getTime() < cfg.alertCooldownMinutes * 60000)) return null;
    return store.insertSafetyAlert({ ride_id: ride.id, kind, message, latitude: point.latitude, longitude: point.longitude });
  }

  async function monitor(ride, point, now = Date.now()) {
    const raised = [];
    const pickup = { latitude: ride.pickup_latitude, longitude: ride.pickup_longitude };
    const destination = { latitude: ride.destination_latitude, longitude: ride.destination_longitude };

    // 1. Significant deviation from the planned route.
    const planKm = haversineKm(pickup.latitude, pickup.longitude, destination.latitude, destination.longitude);
    const offKm = distanceToSegmentKm(point, pickup, destination);
    if (offKm > Math.max(cfg.deviationMinKm, cfg.deviationRatio * planKm)) {
      const a = await maybeAlert(ride, 'route_deviation',
        `Your car is about ${offKm.toFixed(1)} km away from the expected route.`, point, now);
      if (a) raised.push(a);
    }

    // 2. Unusually long stop (not at the destination).
    if (meters(point, destination) > cfg.nearDestinationMeters) {
      const windowStart = new Date(now - (cfg.stopMinutes * 60 + 120) * 1000);
      const startedAt = ride.started_at ? new Date(ride.started_at) : windowStart;
      const since = new Date(Math.max(windowStart.getTime(), startedAt.getTime())).toISOString();
      const events = (await store.listTrackingEvents(ride.id, { sinceIso: since }))
        .filter((e) => e.kind === 'location' && e.ride_status === 'in_progress');
      let streakStart = null;
      for (let i = events.length - 1; i >= 0; i -= 1) {
        if (meters(events[i], point) > cfg.stopRadiusMeters) break;
        streakStart = new Date(events[i].recorded_at).getTime();
      }
      if (streakStart !== null && now - streakStart >= cfg.stopMinutes * 60000) {
        const mins = Math.round((now - streakStart) / 60000);
        const a = await maybeAlert(ride, 'long_stop', `Your car hasn't moved for about ${mins} minutes.`, point, now);
        if (a) raised.push(a);
      }
    }
    return raised;
  }

  return {
    config: cfg,
    monitor,

    /** Record a driver fix against their active ride (throttled) and run trip monitoring. */
    async recordDriverLocation(ride, point, now = Date.now()) {
      if (!ride || !['accepted', 'in_progress'].includes(ride.status)) return { recorded: false };
      const last = await store.lastTrackingEvent(ride.id);
      if (last) {
        const moved = meters(last, point);
        const age = now - new Date(last.recorded_at).getTime();
        if (moved < cfg.minMoveMeters && age < cfg.maxSilenceSeconds * 1000) return { recorded: false };
      }
      await store.insertTrackingEvent({
        ride_id: ride.id, kind: 'location', latitude: point.latitude, longitude: point.longitude, ride_status: ride.status,
      });
      let alerts = [];
      if (ride.status === 'in_progress') {
        try { alerts = await monitor(ride, point, now); } catch (err) { logger.warn?.(`[tracking] monitor failed: ${err.message}`); }
      }
      return { recorded: true, alerts };
    },

    /** The recorded path of a ride (for the live map and the trip detail page). */
    async path(rideId) {
      const events = await store.listTrackingEvents(rideId, { limit: 2000 });
      return events.map((e) => ({ latitude: e.latitude, longitude: e.longitude, kind: e.kind, status: e.ride_status, at: e.recorded_at }));
    },
  };
}
