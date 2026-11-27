import { createClient } from '@supabase/supabase-js';
import { AppError, mapDbError } from '../errors.js';
import { createPhase2Store } from './phase2Store.js';

/**
 * Data-access layer over Supabase (PostgREST + RPC) using the SECRET key.
 * The secret key bypasses RLS, so this module must only ever run on the server, and
 * authorization decisions are made by the services that call it.
 *
 * Every dispatch-critical mutation is a single RPC to a SQL function (see
 * supabase/migrations/..._dispatch_functions.sql) so it runs in one transaction.
 */
export function createSupabaseClients({ url, publishableKey, secretKey }) {
  const opts = { auth: { persistSession: false, autoRefreshToken: false } };
  return {
    // Used only to validate user access tokens.
    authClient: createClient(url, publishableKey, opts),
    adminClient: createClient(url, secretKey, opts),
  };
}

const ACTIVE = ['accepted', 'in_progress'];
const OPEN = ['requested', 'searching', 'accepted', 'in_progress'];

export function createSupabaseStore(db) {
  const check = ({ data, error }) => {
    if (error) throw mapDbError(error);
    return data;
  };
  const rpc = async (fn, args) => check(await db.rpc(fn, args));

  // Generic table operations for the Phase 2 store (see phase2Store.js).
  const applyWhere = (q, where = {}) => {
    for (const [k, v] of Object.entries(where)) {
      if (v && typeof v === 'object') {
        if ('in' in v) q = q.in(k, v.in);
        else if ('gte' in v) q = q.gte(k, v.gte);
        else if ('lt' in v) q = q.lt(k, v.lt);
        else if ('neq' in v) q = q.neq(k, v.neq);
        else if ('is' in v) q = q.is(k, v.is);
      } else q = q.eq(k, v);
    }
    return q;
  };
  const tableOps = {
    async rows(table, { where, order, limit, columns = '*' } = {}) {
      let q = applyWhere(db.from(table).select(columns), where);
      if (order) q = q.order(order[0], { ascending: order[1] !== 'desc' });
      if (limit) q = q.limit(limit);
      return check(await q);
    },
    insert: async (table, row) => check(await db.from(table).insert(row).select('*').single()),
    update: async (table, where, fields) => check(await applyWhere(db.from(table).update(fields), where).select('*')),
    remove: async (table, where) => check(await applyWhere(db.from(table).delete(), where).select('id')),
    async count(table, where) {
      const { count, error } = await applyWhere(db.from(table).select('id', { count: 'exact', head: true }), where);
      if (error) throw mapDbError(error);
      return count ?? 0;
    },
  };

  return {
    ...createPhase2Store(tableOps),
    markArrived: (rideId, driverId) => rpc('mark_arrived', { p_ride_id: rideId, p_driver_id: driverId }),
    adminCancelRide: (rideId) => rpc('admin_cancel_ride', { p_ride_id: rideId }),

    async ping() {
      check(await db.from('profiles').select('id').limit(1));
      return true;
    },

    async getProfile(userId) {
      return check(await db.from('profiles').select('*').eq('id', userId).maybeSingle());
    },

    completeOnboarding: (userId, { role, phone, vehicle_model, vehicle_registration }) =>
      rpc('complete_onboarding', {
        p_user: userId, p_role: role, p_phone: phone,
        p_vehicle_model: vehicle_model ?? null, p_vehicle_registration: vehicle_registration ?? null,
      }),

    async getDriverByProfileId(profileId) {
      // One round trip: driver row with its (one-to-one) location embedded.
      const row = check(await db.from('drivers')
        .select('*, driver_locations(latitude, longitude, updated_at)').eq('profile_id', profileId).maybeSingle());
      if (!row) return null;
      const { driver_locations: embedded, ...driver } = row;
      const location = Array.isArray(embedded) ? (embedded[0] ?? null) : (embedded ?? null);
      return { ...driver, location };
    },

    async getDriverById(driverId) {
      return check(await db.from('drivers').select('*').eq('id', driverId).maybeSingle());
    },

    setDriverOnline: (driverId, online) => rpc('set_driver_online', { p_driver_id: driverId, p_online: online }),

    async upsertDriverLocation(driverId, latitude, longitude) {
      return check(await db.from('driver_locations')
        .upsert({ driver_id: driverId, latitude, longitude, updated_at: new Date().toISOString() })
        .select('latitude, longitude, updated_at').single());
    },

    async getRide(id) {
      return check(await db.from('rides').select('*').eq('id', id).maybeSingle());
    },

    /** A participant's own rides, newest first (Activity). Exactly one of passengerId / driverId is set. */
    async listRideHistory({ passengerId, driverId, limit = 20, before }) {
      let q = db.from('rides').select('*');
      q = passengerId ? q.eq('passenger_id', passengerId) : q.eq('driver_id', driverId);
      if (before) q = q.lt('created_at', before);
      return check(await q.order('created_at', { ascending: false }).limit(limit));
    },

    /** Display names (no phone numbers) for a set of drivers, with their vehicles. */
    async getDriverSummaries(ids) {
      if (!ids.length) return [];
      const rows = check(await db.from('drivers')
        .select('id, vehicle_model, vehicle_registration, profiles(full_name)').in('id', ids));
      return rows.map(({ profiles, ...d }) => ({ ...d, full_name: (Array.isArray(profiles) ? profiles[0] : profiles)?.full_name }));
    },

    async getProfileNames(ids) {
      if (!ids.length) return [];
      return check(await db.from('profiles').select('id, full_name').in('id', ids));
    },

    /** Completed trips for a driver since a timestamp (Earnings), plus all-time totals. */
    async listCompletedForDriver(driverId, sinceIso) {
      return check(await db.from('rides')
        .select('id, completed_at, estimated_fare, distance_km, duration_minutes, pickup_address, destination_address')
        .eq('driver_id', driverId).eq('status', 'completed').gte('completed_at', sinceIso)
        .order('completed_at', { ascending: false }).limit(500));
    },
    async driverAllTimeTotals(driverId) {
      const rows = check(await db.from('rides').select('estimated_fare, distance_km')
        .eq('driver_id', driverId).eq('status', 'completed').limit(10000));
      return {
        trips: rows.length,
        fare: rows.reduce((a, r) => a + Number(r.estimated_fare), 0),
        distance_km: rows.reduce((a, r) => a + Number(r.distance_km), 0),
      };
    },

    async updateProfile(userId, fields) {
      return check(await db.from('profiles').update(fields).eq('id', userId).select('*').single());
    },
    async updateVehicle(driverId, fields) {
      return check(await db.from('drivers').update(fields).eq('id', driverId).select('*').single());
    },

    /** The passenger's own recent bookings (newest first), used to build "recent places". */
    async listRecentPlaceRows(passengerId, limit = 60) {
      return check(await db.from('rides')
        .select('pickup_address, pickup_latitude, pickup_longitude, destination_address, destination_latitude, destination_longitude, created_at')
        .eq('passenger_id', passengerId).order('created_at', { ascending: false }).limit(limit));
    },

    async getRideByRequestKey(passengerId, key) {
      return check(await db.from('rides').select('*').eq('passenger_id', passengerId)
        .eq('request_key', key).maybeSingle());
    },

    async getOpenRideForPassenger(passengerId) {
      return check(await db.from('rides').select('*').eq('passenger_id', passengerId)
        .in('status', OPEN).maybeSingle());
    },

    async getActiveRideForDriver(driverId) {
      return check(await db.from('rides').select('*').eq('driver_id', driverId)
        .in('status', ACTIVE).maybeSingle());
    },

    /** Returns { ride, duplicate }. Throws ACTIVE_RIDE_EXISTS if the passenger already has an open ride. */
    async insertRide(row) {
      const { data, error } = await db.from('rides').insert(row).select('*').single();
      if (!error) return { ride: data, duplicate: false };
      if (error.code === '23505') {
        const same = await this.getRideByRequestKey(row.passenger_id, row.request_key);
        if (same) return { ride: same, duplicate: true };
        const open = await this.getOpenRideForPassenger(row.passenger_id);
        throw new AppError(409, 'ACTIVE_RIDE_EXISTS', 'You already have an active ride.', { ride_id: open?.id });
      }
      throw mapDbError(error);
    },

    async listOfferedDriverIds(rideId) {
      const rows = check(await db.from('ride_offers').select('driver_id').eq('ride_id', rideId));
      return rows.map((r) => r.driver_id);
    },

    async countOffersForRide(rideId) {
      const { count, error } = await db.from('ride_offers').select('id', { count: 'exact', head: true })
        .eq('ride_id', rideId);
      if (error) throw mapDbError(error);
      return count ?? 0;
    },

    async getLivePendingOffer(rideId) {
      return check(await db.from('ride_offers').select('*').eq('ride_id', rideId)
        .eq('status', 'pending').gt('expires_at', new Date().toISOString()).maybeSingle());
    },

    findEligibleDrivers: ({ lat, lng, radiusKm, staleSeconds, excludeDriverIds = [] }) =>
      rpc('find_eligible_drivers', {
        p_lat: lat, p_lng: lng, p_radius_km: radiusKm,
        p_stale_seconds: staleSeconds, p_exclude: excludeDriverIds,
      }),

    createOffer: ({ rideId, driverId, ttlSeconds }) =>
      rpc('create_offer', { p_ride_id: rideId, p_driver_id: driverId, p_ttl_seconds: ttlSeconds }),

    async listPendingOffersForDriver(driverId) {
      const rows = check(await db.from('ride_offers')
        .select('id, ride_id, status, offered_at, expires_at, rides(pickup_address, pickup_latitude, pickup_longitude, destination_address, destination_latitude, destination_longitude, distance_km, duration_minutes, estimated_fare, fare_breakdown)')
        .eq('driver_id', driverId).eq('status', 'pending')
        .gt('expires_at', new Date().toISOString()).order('offered_at', { ascending: false }));
      return rows.map(({ rides, ...offer }) => ({ ...offer, ride: rides }));
    },

    async getOffer(offerId) {
      return check(await db.from('ride_offers').select('*').eq('id', offerId).maybeSingle());
    },

    acceptOffer: (offerId, driverId) => rpc('accept_offer', { p_offer_id: offerId, p_driver_id: driverId }),
    rejectOffer: (offerId, driverId) => rpc('reject_offer', { p_offer_id: offerId, p_driver_id: driverId }),
    expireStaleOffers: () => rpc('expire_stale_offers', {}),
    markUnmatched: (rideId) => rpc('mark_ride_unmatched', { p_ride_id: rideId }),
    startRide: (rideId, driverId) => rpc('start_ride', { p_ride_id: rideId, p_driver_id: driverId }),
    completeRide: (rideId, driverId) => rpc('complete_ride', { p_ride_id: rideId, p_driver_id: driverId }),
    cancelRide: (rideId, role, actorId) =>
      rpc('cancel_ride', { p_ride_id: rideId, p_actor_role: role, p_actor_id: actorId }),

    /** Rides still waiting for dispatch with no live offer (e.g. server restarted mid-dispatch). */
    async listStalledRideIds(olderThanSeconds) {
      const cutoff = new Date(Date.now() - olderThanSeconds * 1000).toISOString();
      const rides = check(await db.from('rides').select('id').in('status', ['requested', 'searching'])
        .lt('updated_at', cutoff).limit(50));
      if (!rides.length) return [];
      const ids = rides.map((r) => r.id);
      const live = check(await db.from('ride_offers').select('ride_id').in('ride_id', ids)
        .eq('status', 'pending').gt('expires_at', new Date().toISOString()));
      const busy = new Set(live.map((o) => o.ride_id));
      return ids.filter((id) => !busy.has(id));
    },

    /** Contact details are read here, server-side, and only released by the service after authorization. */
    async getRideParties(ride) {
      const loadDriver = async () => {
        if (!ride.driver_id) return null;
        // driver + their profile in one round trip (drivers.profile_id -> profiles.id)
        const d = check(await db.from('drivers')
          .select('id, profile_id, vehicle_model, vehicle_registration, is_verified, profiles(full_name, phone), driver_locations(latitude, longitude, updated_at)')
          .eq('id', ride.driver_id).maybeSingle());
        if (!d) return null;
        const { profiles, driver_locations: loc, ...rest } = d;
        const p = Array.isArray(profiles) ? profiles[0] : profiles;
        const location = Array.isArray(loc) ? (loc[0] ?? null) : (loc ?? null);
        return { ...rest, full_name: p?.full_name, phone: p?.phone, location };
      };
      const [passenger, driver] = await Promise.all([
        db.from('profiles').select('full_name, phone').eq('id', ride.passenger_id).maybeSingle().then(check),
        loadDriver(),
      ]);
      return { passenger, driver };
    },
  };
}
