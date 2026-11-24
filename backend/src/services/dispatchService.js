import { rankDrivers } from '../matching/ranker.js';

// Reasons create_offer can refuse that mean "stop, someone else is handling this ride".
const STOP_REASONS = new Set(['RIDE_HAS_PENDING', 'RIDE_NOT_SEARCHING', 'RIDE_NOT_FOUND']);

/**
 * Sequential dispatch: offer the ride to ONE best driver at a time.
 * On reject/expiry the next eligible driver is tried; if none remain the ride becomes `unmatched`.
 * All state lives in the database, so any backend instance (or a restart) can continue a dispatch.
 */
export function createDispatchService({ store, matching, logger = console }) {
  async function dispatchRide(rideId) {
    const ride = await store.getRide(rideId);
    if (!ride || !['requested', 'searching'].includes(ride.status)) return { outcome: 'skipped' };

    const attempted = new Set(await store.listOfferedDriverIds(rideId));

    // Step 1: 5 km, then expand to 10 km.
    for (const radiusKm of matching.radiiKm) {
      const candidates = await store.findEligibleDrivers({
        lat: ride.pickup_latitude,
        lng: ride.pickup_longitude,
        radiusKm,
        staleSeconds: matching.locationStaleSeconds,
        excludeDriverIds: [...attempted],
      });

      // Step 2: rank (proximity in Phase 1).
      for (const candidate of rankDrivers(candidates, { strategy: matching.rankingStrategy })) {
        // Step 3: offer to exactly one driver; the DB arbitrates concurrent attempts.
        const result = await store.createOffer({
          rideId,
          driverId: candidate.driver_id,
          ttlSeconds: matching.offerTtlSeconds,
        });
        if (result.ok) {
          return { outcome: 'offered', offer: result.offer, radiusKm, distanceKm: candidate.distance_km };
        }
        if (STOP_REASONS.has(result.reason)) return { outcome: 'skipped', reason: result.reason };
        attempted.add(candidate.driver_id); // driver taken by a concurrent dispatch: try the next one
      }
    }

    // Step 5: nobody left.
    const updated = await store.markUnmatched(rideId);
    return { outcome: updated.status === 'unmatched' ? 'unmatched' : 'skipped' };
  }

  async function safeDispatch(rideId) {
    try {
      return await dispatchRide(rideId);
    } catch (err) {
      logger.error(`[dispatch] ride ${rideId} failed: ${err.message}`);
      return { outcome: 'error' };
    }
  }

  /** One worker pass: expire lapsed offers, then advance every ride that needs a next driver. */
  async function sweep() {
    const expired = await store.expireStaleOffers();
    const stalled = await store.listStalledRideIds(5);
    const rideIds = new Set([...expired.map((e) => e.ride_id), ...stalled]);
    for (const id of rideIds) await safeDispatch(id);
    return { expired: expired.length, redispatched: rideIds.size };
  }

  function startWorker({ intervalMs }) {
    let running = false;
    const timer = setInterval(async () => {
      if (running) return;
      running = true;
      try { await sweep(); } catch (err) { logger.error(`[worker] sweep failed: ${err.message}`); }
      finally { running = false; }
    }, intervalMs);
    timer.unref?.();
    return { stop: () => clearInterval(timer) };
  }

  return { dispatchRide, safeDispatch, sweep, startWorker };
}
