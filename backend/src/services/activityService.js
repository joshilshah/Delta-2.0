import { AppError } from '../errors.js';

const DAY = 24 * 60 * 60 * 1000;

/**
 * Activity (trip history), driver Earnings and profile edits. All reads are scoped to the authenticated
 * user. Other people's names are included, but never their phone numbers.
 */
export function createActivityService({ store }) {
  return {
    async history(user, { limit = 20, before } = {}) {
      const isDriver = user.role === 'driver';
      const rows = await store.listRideHistory(isDriver
        ? { driverId: user.driver.id, limit, before }
        : { passengerId: user.id, limit, before });

      // Counterpart names in one bulk lookup.
      const names = new Map();
      if (isDriver) {
        const ids = [...new Set(rows.map((r) => r.passenger_id))];
        for (const p of await store.getProfileNames(ids)) names.set(p.id, { name: p.full_name });
      } else {
        const ids = [...new Set(rows.map((r) => r.driver_id).filter(Boolean))];
        for (const d of await store.getDriverSummaries(ids)) {
          names.set(d.id, { name: d.full_name, vehicle_model: d.vehicle_model, vehicle_registration: d.vehicle_registration });
        }
      }

      const items = rows.map((r) => {
        const who = names.get(isDriver ? r.passenger_id : r.driver_id) ?? null;
        return {
          id: r.id,
          status: r.status,
          pickup: { address: r.pickup_address, latitude: r.pickup_latitude, longitude: r.pickup_longitude },
          destination: { address: r.destination_address, latitude: r.destination_latitude, longitude: r.destination_longitude },
          distance_km: Number(r.distance_km),
          duration_minutes: Number(r.duration_minutes),
          estimated_fare: Number(r.estimated_fare),
          created_at: r.created_at,
          completed_at: r.completed_at,
          cancelled_by: r.cancelled_by ?? null,
          counterpart: who,
        };
      });
      return { items, next_before: rows.length === limit ? rows[rows.length - 1].created_at : null };
    },

    async earnings(driver, { days = 30 } = {}) {
      const since = new Date(Date.now() - days * DAY).toISOString();
      const [trips, allTime] = await Promise.all([
        store.listCompletedForDriver(driver.id, since),
        store.driverAllTimeTotals(driver.id),
      ]);
      return {
        currency: 'INR',
        window_days: days,
        trips: trips.map((t) => ({
          id: t.id,
          completed_at: t.completed_at,
          fare: Number(t.estimated_fare),
          distance_km: Number(t.distance_km),
          duration_minutes: Number(t.duration_minutes),
          pickup_address: t.pickup_address,
          destination_address: t.destination_address,
        })),
        all_time: { trips: allTime.trips, fare: Math.round(allTime.fare), distance_km: Math.round(allTime.distance_km * 10) / 10 },
      };
    },

    /** Account overview numbers. Each count is scoped to the signed-in user. */
    async overview(user) {
      const isDriver = user.role === 'driver';
      const [rides, contacts, places] = await Promise.all([
        store.listRideStatsRows(isDriver ? { driver_id: user.driver.id } : { passenger_id: user.id }),
        store.countEmergencyContacts(user.id).catch(() => null),
        isDriver ? null : store.countSavedPlaces(user.id).catch(() => null),
      ]);
      const by = (s) => rides.filter((r) => r.status === s);
      const completed = by('completed');
      return {
        member_since: user.profile.created_at,
        rides_total: rides.length,
        completed: completed.length,
        cancelled: by('cancelled').length,
        [isDriver ? 'earned' : 'spent']: Math.round(completed.reduce((a, r) => a + Number(r.estimated_fare), 0)),
        distance_km: Math.round(completed.reduce((a, r) => a + Number(r.distance_km), 0) * 10) / 10,
        last_ride_at: rides[0]?.created_at ?? null,
        emergency_contacts: contacts,
        saved_places: places,
        currency: 'INR',
      };
    },

    async updateProfile(user, body) {
      const { vehicle_model, vehicle_registration, ...personal } = body;
      const wantsVehicle = vehicle_model !== undefined || vehicle_registration !== undefined;
      if (wantsVehicle && user.role !== 'driver') {
        throw new AppError(400, 'VALIDATION_ERROR', 'Only drivers have a vehicle.');
      }
      const profile = Object.keys(personal).length ? await store.updateProfile(user.id, personal) : user.profile;
      let driver = user.driver ?? null;
      if (wantsVehicle) {
        const fields = {};
        if (vehicle_model !== undefined) fields.vehicle_model = vehicle_model;
        if (vehicle_registration !== undefined) fields.vehicle_registration = vehicle_registration.toUpperCase();
        driver = await store.updateVehicle(user.driver.id, fields);
      }
      return { profile, driver };
    },
  };
}
