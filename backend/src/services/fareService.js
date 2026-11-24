import { AppError } from '../errors.js';

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * Estimated Fare = Base + (distance_km x per_km) + (duration_min x per_min)
 * Distance is kept to 2 decimals, duration is rounded UP to a whole minute,
 * and the fare is rounded to the nearest rupee.
 * Inputs must come from the server-side routing result, never from the client.
 */
export function calculateFare({ distanceKm, durationMinutes }, pricing) {
  if (!Number.isFinite(distanceKm) || distanceKm < 0 || !Number.isFinite(durationMinutes) || durationMinutes < 0) {
    throw new AppError(422, 'INVALID_ROUTE', 'Route distance and duration must be non-negative numbers.');
  }
  const distance = round2(distanceKm);
  const minutes = Math.ceil(durationMinutes - 1e-9);
  const distanceCharge = round2(distance * pricing.perKmRate);
  const timeCharge = round2(minutes * pricing.perMinuteRate);
  const total = Math.round(pricing.baseFare + distanceCharge + timeCharge);

  return {
    currency: pricing.currency,
    distance_km: distance,
    duration_minutes: minutes,
    breakdown: {
      base_fare: pricing.baseFare,
      distance_charge: distanceCharge,
      time_charge: timeCharge,
      per_km_rate: pricing.perKmRate,
      per_minute_rate: pricing.perMinuteRate,
    },
    estimated_fare: total,
  };
}

export function createFareService({ routeService, pricing }) {
  return {
    /** Look up the route server-side and price it. */
    async estimate(pickup, destination) {
      const route = await routeService.getRoute(pickup, destination);
      const fare = calculateFare(route, pricing);
      return { ...fare, route_source: route.source };
    },
  };
}
