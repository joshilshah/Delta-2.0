import { allowedActions } from './rideStateMachine.js';
import { estimateEta } from '../matching/geo.js';

const CONTACT_STATUSES = ['accepted', 'in_progress'];          // phone numbers visible
// Names/vehicle visible (never phones). Includes 'cancelled': a driver was only ever assigned after a match,
// so both sides had already seen each other; trip history needs it.
const IDENTITY_STATUSES = ['accepted', 'in_progress', 'completed', 'cancelled'];

/**
 * Serialise a ride for ONE viewer. This is the only place contact details are released:
 *  - passengers see the driver only after a confirmed match (phone only while the ride is active)
 *  - drivers see the passenger only after accepting (phone only while the ride is active)
 */
export function buildRideView({ ride, parties, viewerRole, matching }) {
  const view = {
    id: ride.id,
    status: ride.status,
    pickup: { address: ride.pickup_address, latitude: ride.pickup_latitude, longitude: ride.pickup_longitude },
    destination: {
      address: ride.destination_address,
      latitude: ride.destination_latitude,
      longitude: ride.destination_longitude,
    },
    distance_km: Number(ride.distance_km),
    duration_minutes: Number(ride.duration_minutes),
    estimated_fare: Number(ride.estimated_fare),
    fare_breakdown: ride.fare_breakdown ?? null,
    currency: 'INR',
    cancelled_by: ride.cancelled_by ?? null,
    created_at: ride.created_at,
    accepted_at: ride.accepted_at,
    started_at: ride.started_at,
    completed_at: ride.completed_at,
    cancelled_at: ride.cancelled_at,
    arrived_at: ride.arrived_at ?? null,
    // Real trip time (start to drop-off), once the trip has finished.
    actual_duration_minutes: ride.started_at && ride.completed_at
      ? Math.max(1, Math.round((new Date(ride.completed_at) - new Date(ride.started_at)) / 60000))
      : null,
    viewer_role: viewerRole,
    allowed_actions: allowedActions(viewerRole, ride.status),
  };
  if (viewerRole === 'driver' && ride.status === 'accepted' && !ride.arrived_at) view.allowed_actions.push('arrive');

  // Live ETA from the driver's last shared location: to the pickup before the trip, to the destination during it.
  const loc = parties?.driver?.location;
  if (loc && CONTACT_STATUSES.includes(ride.status)) {
    const toPickup = ride.status === 'accepted';
    const target = toPickup ? view.pickup : view.destination;
    view.eta = { target: toPickup ? 'pickup' : 'destination', ...estimateEta(loc, target), source: 'estimate', from_updated_at: loc.updated_at };
  } else {
    view.eta = null;
  }

  if (viewerRole === 'passenger') {
    if (parties?.driver && IDENTITY_STATUSES.includes(ride.status)) {
      view.driver = {
        name: parties.driver.full_name,
        vehicle_model: parties.driver.vehicle_model,
        vehicle_registration: parties.driver.vehicle_registration,
        is_verified: Boolean(parties.driver.is_verified), // always false in Phase 1 (demo driver)
        phone: CONTACT_STATUSES.includes(ride.status) ? parties.driver.phone : null,
        // Last location the driver shared. Released only to this ride's passenger, only while the ride is active.
        location: CONTACT_STATUSES.includes(ride.status) && parties.driver.location
          ? {
            latitude: parties.driver.location.latitude,
            longitude: parties.driver.location.longitude,
            updated_at: parties.driver.location.updated_at,
          }
          : null,
      };
    }
    if (matching && ['requested', 'searching'].includes(ride.status)) view.matching = matching;
  } else if (viewerRole === 'driver') {
    if (parties?.passenger && IDENTITY_STATUSES.includes(ride.status)) {
      view.passenger = {
        name: parties.passenger.full_name,
        phone: CONTACT_STATUSES.includes(ride.status) ? parties.passenger.phone : null,
      };
    }
  }
  return view;
}
