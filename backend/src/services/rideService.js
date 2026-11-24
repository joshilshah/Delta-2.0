import { AppError } from '../errors.js';
import { haversineKm } from '../matching/geo.js';
import { buildRideView } from './rideView.js';

/**
 * Passenger/driver ride operations. `user` is always the authenticated identity
 * attached by the auth middleware: { id, role, driver? } - never client-supplied IDs.
 */
export function createRideService({ store, fareService, dispatchService, minTripMeters = 100 }) {
  async function viewFor(ride, viewerRole) {
    const parties = await store.getRideParties(ride);
    let matching;
    if (viewerRole === 'passenger' && ['requested', 'searching'].includes(ride.status)) {
      const [offer, attempts] = await Promise.all([
        store.getLivePendingOffer(ride.id),
        store.countOffersForRide(ride.id),
      ]);
      matching = {
        attempt: attempts,
        offer_seconds_left: offer ? Math.max(0, Math.ceil((new Date(offer.expires_at) - Date.now()) / 1000)) : null,
      };
    }
    return buildRideView({ ride, parties, viewerRole, matching });
  }

  /** Resolve the viewer's relationship to a ride, or hide its existence (404). */
  async function loadForParticipant(rideId, user) {
    const ride = await store.getRide(rideId);
    const isPassenger = ride && user.role === 'passenger' && ride.passenger_id === user.id;
    const isDriver = ride && user.role === 'driver' && user.driver && ride.driver_id === user.driver.id;
    if (!ride || (!isPassenger && !isDriver)) throw new AppError(404, 'RIDE_NOT_FOUND', 'Ride not found.');
    return { ride, role: isPassenger ? 'passenger' : 'driver' };
  }

  function assertValidTrip(pickup, destination) {
    const meters = haversineKm(pickup.latitude, pickup.longitude, destination.latitude, destination.longitude) * 1000;
    if (meters < minTripMeters) {
      throw new AppError(422, 'INVALID_LOCATION', 'Pickup and destination are too close together.');
    }
  }

  return {
    assertValidTrip,

    async estimate({ pickup, destination }) {
      assertValidTrip(pickup, destination);
      return fareService.estimate(pickup, destination);
    },

    async createRide(user, { pickup, destination, idempotencyKey }) {
      assertValidTrip(pickup, destination);

      // Idempotency + duplicate guard before paying for a Routes API call.
      const [existing, open] = await Promise.all([
        store.getRideByRequestKey(user.id, idempotencyKey),
        store.getOpenRideForPassenger(user.id),
      ]);
      if (existing) return { ride: await viewFor(existing, 'passenger'), created: false };
      if (open) throw new AppError(409, 'ACTIVE_RIDE_EXISTS', 'You already have an active ride.', { ride_id: open.id });

      // Distance, duration and fare are ALWAYS computed here, never taken from the client.
      const fare = await fareService.estimate(pickup, destination);

      const { ride, duplicate } = await store.insertRide({
        passenger_id: user.id,
        request_key: idempotencyKey,
        pickup_address: pickup.address,
        pickup_latitude: pickup.latitude,
        pickup_longitude: pickup.longitude,
        destination_address: destination.address,
        destination_latitude: destination.latitude,
        destination_longitude: destination.longitude,
        distance_km: fare.distance_km,
        duration_minutes: fare.duration_minutes,
        estimated_fare: fare.estimated_fare,
        fare_breakdown: { ...fare.breakdown, currency: fare.currency, route_source: fare.route_source },
      });

      if (!duplicate) await dispatchService.safeDispatch(ride.id); // failures are retried by the worker
      const fresh = await store.getRide(ride.id);
      return { ride: await viewFor(fresh, 'passenger'), created: !duplicate };
    },

    async getRide(user, rideId) {
      const { ride, role } = await loadForParticipant(rideId, user);
      return viewFor(ride, role);
    },

    /** The viewer's current open ride (for recovery after refresh). */
    async getActiveRide(user) {
      const ride = user.role === 'passenger'
        ? await store.getOpenRideForPassenger(user.id)
        : user.driver ? await store.getActiveRideForDriver(user.driver.id) : null;
      return ride ? viewFor(ride, user.role) : null;
    },

    async cancelRide(user, rideId) {
      const { ride, role } = await loadForParticipant(rideId, user);
      const actorId = role === 'passenger' ? user.id : user.driver.id;
      await store.cancelRide(ride.id, role, actorId);
      return viewFor(await store.getRide(ride.id), role);
    },

    async startRide(user, rideId) {
      const { ride } = await loadForParticipant(rideId, user);
      if (user.role !== 'driver') throw new AppError(403, 'FORBIDDEN', 'Only the assigned driver can start a ride.');
      await store.startRide(ride.id, user.driver.id);
      return viewFor(await store.getRide(ride.id), 'driver');
    },

    /** Driver reached the pickup. Also sends the passenger an automated chat message (same DB transaction). */
    async markArrived(user, rideId) {
      const { ride } = await loadForParticipant(rideId, user);
      if (user.role !== 'driver') throw new AppError(403, 'FORBIDDEN', 'Only the assigned driver can mark arrival.');
      await store.markArrived(ride.id, user.driver.id);
      return viewFor(await store.getRide(ride.id), 'driver');
    },

    // ---- in-ride chat: only the two participants; sending only while the ride is active ----
    async listMessages(user, rideId) {
      const { ride, role } = await loadForParticipant(rideId, user);
      const rows = await store.listRideMessages(ride.id);
      return {
        messages: rows.map((m) => ({ id: m.id, sender_role: m.sender_role, mine: m.sender_role === role, body: m.body, created_at: m.created_at })),
        can_send: ['accepted', 'in_progress'].includes(ride.status),
      };
    },

    async sendMessage(user, rideId, body) {
      const { ride, role } = await loadForParticipant(rideId, user);
      if (!['accepted', 'in_progress'].includes(ride.status)) {
        throw new AppError(409, 'CHAT_CLOSED', 'Messaging is only available during an active ride.');
      }
      const m = await store.insertRideMessage({ ride_id: ride.id, sender_role: role, sender_id: user.id, body });
      return { message: { id: m.id, sender_role: m.sender_role, mine: true, body: m.body, created_at: m.created_at } };
    },

    async completeRide(user, rideId) {
      const { ride } = await loadForParticipant(rideId, user);
      if (user.role !== 'driver') throw new AppError(403, 'FORBIDDEN', 'Only the assigned driver can complete a ride.');
      await store.completeRide(ride.id, user.driver.id);
      return viewFor(await store.getRide(ride.id), 'driver');
    },

    // ---- offers (driver) ----
    async listOffers(driver) {
      const offers = await store.listPendingOffersForDriver(driver.id);
      // Deliberately NO passenger identity or phone in an offer.
      // pickup_distance_km is straight-line from the driver's last shared location (not road distance).
      const where = driver.location;
      return offers.map((o) => ({
        pickup_distance_km: where && o.ride.pickup_latitude != null
          ? Math.round(haversineKm(where.latitude, where.longitude, o.ride.pickup_latitude, o.ride.pickup_longitude) * 10) / 10
          : null,
        id: o.id,
        ride_id: o.ride_id,
        offered_at: o.offered_at,
        expires_at: o.expires_at,
        seconds_left: Math.max(0, Math.ceil((new Date(o.expires_at) - Date.now()) / 1000)),
        pickup_address: o.ride.pickup_address,
        destination_address: o.ride.destination_address,
        // Coordinates let the driver preview the trip on a map. Still no passenger identity or phone.
        pickup_latitude: o.ride.pickup_latitude,
        pickup_longitude: o.ride.pickup_longitude,
        destination_latitude: o.ride.destination_latitude ?? null,
        destination_longitude: o.ride.destination_longitude ?? null,
        distance_km: Number(o.ride.distance_km),
        duration_minutes: Number(o.ride.duration_minutes),
        estimated_fare: Number(o.ride.estimated_fare),
        currency: 'INR',
      }));
    },

    async acceptOffer(driver, offerId) {
      const ride = await store.acceptOffer(offerId, driver.id); // atomic in the database
      return viewFor(ride, 'driver');
    },

    async rejectOffer(driver, offerId) {
      const result = await store.rejectOffer(offerId, driver.id);
      if (result.changed) await dispatchService.safeDispatch(result.ride_id); // try the next driver now
      return { status: 'rejected' };
    },
  };
}
