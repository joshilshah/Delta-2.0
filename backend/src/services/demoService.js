import { haversineKm } from '../matching/geo.js';

/**
 * DEMO AUTOPILOT (off unless DEMO_AUTOPILOT=on). For live demos without a second person running the driver app.
 *
 * Autopilot drivers (by default the seeded driver2 + driver3 demo accounts) are normally parked OFFLINE, so they never
 * compete with real or manually-operated drivers. When a ride finds no eligible driver, one autopilot driver is put
 * online ~1.2 km from the pickup (anywhere in the world), so the normal dispatch offers it the ride. Then `tick()`:
 *   offer  -> accept after a few seconds, send a hello chat message
 *   accepted -> drive to the pickup (~25-60 s), mark arrived (rider gets the automated arrival message)
 *   arrived  -> wait ~10 s, start the trip
 *   in progress -> drive to the drop-off (the planned trip, sped up to ~45-90 s), complete
 *   idle     -> park offline again
 * Positions are computed from the ride's timestamps (not incremental steps), so concurrent serverless instances agree.
 * Everything goes through the same store functions as real drivers: same SQL rules, same realtime updates.
 */
const lerp = (a, b, f) => ({
  latitude: a.latitude + (b.latitude - a.latitude) * f,
  longitude: a.longitude + (b.longitude - a.longitude) * f,
});
const offsetKm = (p, km, bearingDeg) => {
  const r = (bearingDeg * Math.PI) / 180;
  return {
    latitude: p.latitude + (km * Math.cos(r)) / 110.57,
    longitude: p.longitude + (km * Math.sin(r)) / (111.32 * Math.cos((p.latitude * Math.PI) / 180)),
  };
};
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const ms = (iso) => new Date(iso).getTime();
const firstName = (n = '') => n.replace(/\(.*?\)/g, '').trim().split(/\s+/)[0] || 'your driver';

export function createDemoService({ store, trackingService, demo = {}, logger = console, now = () => Date.now() }) {
  const cfg = {
    enabled: false,
    emails: ['driver2@demo.ridehail.test', 'driver3@demo.ridehail.test'],
    acceptDelayMs: 4000,
    approachMs: [25_000, 60_000],
    waitAtPickupMs: 10_000,
    tripMs: [45_000, 90_000],
    spawnKm: 1.2,
    parkAfterIdleMs: 20_000,
    ...demo,
  };
  let drivers = null; // cached per instance: [{ id, profile_id, name }]

  // On/off: the admin switch (app_settings 'demo_autopilot') wins; DEMO_AUTOPILOT env is the default.
  // Cached briefly per instance so the hot path stays cheap; every instance picks up a change within ~10 s.
  const SETTING = 'demo_autopilot';
  let cached = { at: 0, enabled: cfg.enabled, source: 'env' };
  async function isEnabled() {
    if (now() - cached.at < 10_000) return cached.enabled;
    try {
      const row = await store.getSetting(SETTING);
      cached = row ? { at: now(), enabled: Boolean(row.value?.enabled), source: 'admin', updated_at: row.updated_at }
        : { at: now(), enabled: cfg.enabled, source: 'env' };
    } catch {
      cached = { at: now(), enabled: cfg.enabled, source: 'env' }; // settings table not created yet
    }
    return cached.enabled;
  }
  async function setEnabled(enabled, userId) {
    const row = await store.setSetting(SETTING, { enabled: Boolean(enabled) }, userId);
    cached = { at: now(), enabled: Boolean(enabled), source: 'admin', updated_at: row?.updated_at };
    if (!enabled) await parkAll();
    return status();
  }
  /** Turning autopilot off: send idle autopilot drivers off duty right away (active trips finish normally). */
  async function parkAll() {
    for (const d of await autopilotDrivers()) {
      if (!(await store.getActiveRideForDriver(d.id))) await store.setDriverOnline(d.id, false).catch(() => {});
    }
  }
  async function status() {
    const enabled = await isEnabled();
    const list = await autopilotDrivers().catch(() => []);
    const rows = await Promise.all(list.map(async (d) => {
      const [row, ride] = await Promise.all([store.getDriverById(d.id), store.getActiveRideForDriver(d.id)]);
      return { id: d.id, name: d.name, online: Boolean(row?.is_online), ride_status: ride?.status ?? null, ride_id: ride?.id ?? null };
    }));
    return { enabled, source: cached.source, updated_at: cached.updated_at ?? null, env_default: cfg.enabled, emails: cfg.emails, drivers: rows };
  }

  async function autopilotDrivers() {
    if (drivers) return drivers;
    const profiles = await store.listProfilesByEmails(cfg.emails);
    const rows = profiles.length ? await store.listDriversByProfileIds(profiles.map((p) => p.id)) : [];
    drivers = rows.map((d) => ({ id: d.id, profile_id: d.profile_id, name: profiles.find((p) => p.id === d.profile_id)?.full_name }));
    return drivers;
  }

  async function move(driverId, ride, point) {
    await store.upsertDriverLocation(driverId, point.latitude, point.longitude);
    try { await trackingService.recordDriverLocation(ride, point, now()); } catch { /* tracking is best-effort */ }
  }

  /** Dispatch found nobody: bring a free autopilot driver online near the pickup. Returns true if one was provided. */
  async function provideDriver(ride) {
    if (!(await isEnabled())) return false;
    const list = await autopilotDrivers();
    if (!list.length) return false;
    const busy = new Set((await store.listPendingOffersForDriverIds(list.map((d) => d.id))).map((o) => o.driver_id));
    for (const d of list) {
      if (busy.has(d.id) || await store.getActiveRideForDriver(d.id)) continue;
      const pickup = { latitude: ride.pickup_latitude, longitude: ride.pickup_longitude };
      const at = offsetKm(pickup, cfg.spawnKm, (now() / 1000) % 360);
      await store.setDriverOnline(d.id, true);
      await store.upsertDriverLocation(d.id, at.latitude, at.longitude);
      logger.log?.(`[demo] autopilot driver ${d.name} placed near pickup for ride ${ride.id}`);
      return true;
    }
    return false;
  }

  async function advance(d, ride, t) {
    const pickup = { latitude: ride.pickup_latitude, longitude: ride.pickup_longitude };
    const dest = { latitude: ride.destination_latitude, longitude: ride.destination_longitude };

    if (ride.status === 'accepted' && !ride.arrived_at) {
      const start = await store.firstTrackingEvent(ride.id) ?? pickup;
      const km = haversineKm(start.latitude, start.longitude, pickup.latitude, pickup.longitude);
      const dur = clamp((km / 30) * 3_600_000, ...cfg.approachMs); // ~30 km/h, kept within demo-friendly bounds
      const f = (t - ms(ride.accepted_at)) / dur;
      if (f >= 1) {
        await move(d.id, ride, pickup);
        await store.markArrived(ride.id, d.id);
      } else {
        await move(d.id, ride, lerp(start, pickup, Math.max(0, f)));
      }
    } else if (ride.status === 'accepted' && ride.arrived_at) {
      if (t - ms(ride.arrived_at) >= cfg.waitAtPickupMs) await store.startRide(ride.id, d.id);
    } else if (ride.status === 'in_progress') {
      const dur = clamp((Number(ride.duration_minutes) * 60_000) / 10, ...cfg.tripMs); // the planned trip, 10x faster
      const f = (t - ms(ride.started_at)) / dur;
      if (f >= 1) {
        await move(d.id, ride, dest);
        await store.completeRide(ride.id, d.id);
      } else {
        await move(d.id, ride, lerp(pickup, dest, Math.max(0, f)));
      }
    }
  }

  /** One autopilot step for every autopilot driver. Safe to call often and from several instances at once. */
  async function tick() {
    const list = await autopilotDrivers();
    if (!list.length) return;
    const t = now();
    const pending = await store.listPendingOffersForDriverIds(list.map((d) => d.id));
    if (!(await isEnabled())) {
      // Switched off: finish any trip already under way, but take no new ones.
      for (const d of list) {
        const ride = await store.getActiveRideForDriver(d.id).catch(() => null);
        if (ride) await advance(d, ride, t).catch(() => {});
      }
      return;
    }

    // 1. Accept offers after a short, human-looking delay.
    for (const offer of pending) {
      if (ms(offer.offered_at) + cfg.acceptDelayMs > t || ms(offer.expires_at) <= t) continue;
      const d = list.find((x) => x.id === offer.driver_id);
      try {
        const ride = await store.acceptOffer(offer.id, d.id);
        const loc = await store.getDriverLocationRow(d.id);
        if (loc) {
          await store.insertTrackingEvent({ ride_id: ride.id, kind: 'location', latitude: loc.latitude, longitude: loc.longitude, ride_status: 'accepted' });
        }
        await store.insertRideMessage({
          ride_id: ride.id, sender_role: 'driver', sender_id: d.profile_id,
          body: `Hi! I'm ${firstName(d.name)}, on my way to your pickup. (Delta demo driver)`,
        });
      } catch { /* someone else accepted it first, or it expired: fine */ }
    }

    // 2. Drive active rides forward; park idle drivers.
    const offered = new Set(pending.map((o) => o.driver_id));
    for (const d of list) {
      try {
        const ride = await store.getActiveRideForDriver(d.id);
        if (ride) { await advance(d, ride, t); continue; }
        if (offered.has(d.id)) continue;
        const row = await store.getDriverById(d.id);
        if (!row?.is_online) continue;
        const loc = await store.getDriverLocationRow(d.id);
        if (!loc || t - ms(loc.updated_at) >= cfg.parkAfterIdleMs) await store.setDriverOnline(d.id, false);
      } catch (err) {
        logger.warn?.(`[demo] autopilot step for ${d.name} failed: ${err.message}`);
      }
    }
  }

  return { config: cfg, isEnabled, setEnabled, status, provideDriver, tick };
}
