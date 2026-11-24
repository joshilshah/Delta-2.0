// Store implementation over a real Postgres connection (PGlite), calling the SAME SQL functions
// the production Supabase store calls via RPC. This lets service and API tests exercise the real
// dispatch SQL instead of a hand-written fake.
import { AppError, mapDbError } from '../../src/errors.js';
import { createPhase2Store } from '../../src/stores/phase2Store.js';

export function createPgStore(db) {
  const q = async (sql, params = []) => {
    try { return (await db.query(sql, params)).rows; } catch (err) { throw err.code === '23505' ? err : mapDbError(err); }
  };
  const one = async (sql, params) => (await q(sql, params))[0] ?? null;
  const fn = async (call, params) => (await one(`select ${call} as r`, params)).r;

  // Generic table operations (same contract as the Supabase store's, see src/stores/phase2Store.js).
  const where = (w = {}, params) => Object.entries(w).map(([k, v]) => {
    if (v && typeof v === 'object') {
      if ('in' in v) { params.push(v.in); return `${k} = any($${params.length})`; }
      if ('is' in v) return `${k} is null`;
      const op = 'gte' in v ? '>=' : 'lt' in v ? '<' : '<>';
      params.push(v.gte ?? v.lt ?? v.neq); return `${k} ${op} $${params.length}`;
    }
    params.push(v); return `${k} = $${params.length}`;
  }).join(' and ') || 'true';
  const tableOps = {
    rows(table, { where: w, order, limit, columns = '*' } = {}) {
      const params = [];
      const sql = `select ${columns} from public.${table} where ${where(w, params)}`
        + (order ? ` order by ${order[0]} ${order[1] === 'desc' ? 'desc' : 'asc'}` : '') + (limit ? ` limit ${Number(limit)}` : '');
      return q(sql, params);
    },
    insert(table, row) {
      const keys = Object.keys(row);
      return one(`insert into public.${table} (${keys.join(', ')}) values (${keys.map((_, i) => `$${i + 1}`).join(', ')}) returning *`, Object.values(row));
    },
    update(table, w, fields) {
      const params = Object.values(fields);
      const sets = Object.keys(fields).map((k, i) => `${k} = $${i + 1}`).join(', ');
      return q(`update public.${table} set ${sets} where ${where(w, params)} returning *`, params);
    },
    remove(table, w) {
      const params = [];
      return q(`delete from public.${table} where ${where(w, params)} returning id`, params);
    },
    async count(table, w) {
      const params = [];
      return Number((await one(`select count(*) c from public.${table} where ${where(w, params)}`, params)).c);
    },
  };

  const store = {
    ...createPhase2Store(tableOps),
    markArrived: (rid, did) => fn('public.mark_arrived($1,$2)', [rid, did]),
    ping: async () => { await q('select 1'); return true; },
    getProfile: (id) => one('select * from public.profiles where id = $1', [id]),
    completeOnboarding: (id, r) => fn('public.complete_onboarding($1,$2,$3,$4,$5)',
      [id, r.role, r.phone, r.vehicle_model ?? null, r.vehicle_registration ?? null]),
    async getDriverByProfileId(profileId) {
      const d = await one('select * from public.drivers where profile_id = $1', [profileId]);
      if (!d) return null;
      const location = await one('select latitude, longitude, updated_at from public.driver_locations where driver_id = $1', [d.id]);
      return { ...d, location };
    },
    getDriverById: (id) => one('select * from public.drivers where id = $1', [id]),
    setDriverOnline: (id, online) => fn('public.set_driver_online($1, $2)', [id, online]),
    upsertDriverLocation: (id, lat, lng) => one(
      `insert into public.driver_locations (driver_id, latitude, longitude, updated_at) values ($1,$2,$3,now())
       on conflict (driver_id) do update set latitude=excluded.latitude, longitude=excluded.longitude, updated_at=now()
       returning latitude, longitude, updated_at`, [id, lat, lng]),
    getRide: (id) => one('select * from public.rides where id = $1', [id]),
    listRideHistory: ({ passengerId, driverId, limit = 20, before }) => q(
      `select * from public.rides where ${passengerId ? 'passenger_id' : 'driver_id'} = $1
         and ($2::timestamptz is null or created_at < $2) order by created_at desc limit $3`,
      [passengerId ?? driverId, before ?? null, limit]),
    getDriverSummaries: (ids) => (ids.length ? q(
      `select d.id, d.vehicle_model, d.vehicle_registration, p.full_name
         from public.drivers d join public.profiles p on p.id = d.profile_id where d.id = any($1::uuid[])`, [ids]) : []),
    getProfileNames: (ids) => (ids.length ? q('select id, full_name from public.profiles where id = any($1::uuid[])', [ids]) : []),
    listCompletedForDriver: (did, since) => q(
      `select id, completed_at, estimated_fare, distance_km, duration_minutes, pickup_address, destination_address
         from public.rides where driver_id=$1 and status='completed' and completed_at >= $2 order by completed_at desc`, [did, since]),
    async driverAllTimeTotals(did) {
      const r = await one(`select count(*)::int trips, coalesce(sum(estimated_fare),0)::float fare, coalesce(sum(distance_km),0)::float distance_km
                             from public.rides where driver_id=$1 and status='completed'`, [did]);
      return { trips: r.trips, fare: r.fare, distance_km: r.distance_km };
    },
    async updateProfile(id, f) {
      const sets = Object.keys(f).map((k, i) => `${k} = $${i + 2}`).join(', ');
      return one(`update public.profiles set ${sets} where id = $1 returning *`, [id, ...Object.values(f)]);
    },
    async updateVehicle(id, f) {
      const sets = Object.keys(f).map((k, i) => `${k} = $${i + 2}`).join(', ');
      return one(`update public.drivers set ${sets} where id = $1 returning *`, [id, ...Object.values(f)]);
    },
    listRecentPlaceRows: (pid, limit = 60) => q(
      `select pickup_address, pickup_latitude, pickup_longitude, destination_address, destination_latitude,
              destination_longitude, created_at
         from public.rides where passenger_id=$1 order by created_at desc limit $2`, [pid, limit]),
    getRideByRequestKey: (pid, key) => one('select * from public.rides where passenger_id=$1 and request_key=$2', [pid, key]),
    getOpenRideForPassenger: (pid) => one(
      `select * from public.rides where passenger_id=$1 and status in ('requested','searching','accepted','in_progress')`, [pid]),
    getActiveRideForDriver: (did) => one(
      `select * from public.rides where driver_id=$1 and status in ('accepted','in_progress')`, [did]),
    async insertRide(r) {
      try {
        const ride = await one(
          `insert into public.rides (passenger_id, request_key, pickup_address, pickup_latitude, pickup_longitude,
             destination_address, destination_latitude, destination_longitude, distance_km, duration_minutes,
             estimated_fare, fare_breakdown)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb) returning *`,
          [r.passenger_id, r.request_key, r.pickup_address, r.pickup_latitude, r.pickup_longitude,
            r.destination_address, r.destination_latitude, r.destination_longitude, r.distance_km,
            r.duration_minutes, r.estimated_fare, JSON.stringify(r.fare_breakdown)]);
        return { ride, duplicate: false };
      } catch (err) {
        if (err.code !== '23505') throw err;
        const same = await store.getRideByRequestKey(r.passenger_id, r.request_key);
        if (same) return { ride: same, duplicate: true };
        const open = await store.getOpenRideForPassenger(r.passenger_id);
        throw new AppError(409, 'ACTIVE_RIDE_EXISTS', 'You already have an active ride.', { ride_id: open?.id });
      }
    },
    listOfferedDriverIds: async (rid) => (await q('select driver_id from public.ride_offers where ride_id=$1', [rid])).map((r) => r.driver_id),
    countOffersForRide: async (rid) => Number((await one('select count(*) c from public.ride_offers where ride_id=$1', [rid])).c),
    getLivePendingOffer: (rid) => one(`select * from public.ride_offers where ride_id=$1 and status='pending' and expires_at > now()`, [rid]),
    findEligibleDrivers: ({ lat, lng, radiusKm, staleSeconds, excludeDriverIds = [] }) =>
      q('select * from public.find_eligible_drivers($1,$2,$3,$4,$5::uuid[])', [lat, lng, radiusKm, staleSeconds, excludeDriverIds]),
    createOffer: ({ rideId, driverId, ttlSeconds }) => fn('public.create_offer($1,$2,$3)', [rideId, driverId, ttlSeconds]),
    async listPendingOffersForDriver(did) {
      const rows = await q(
        `select o.id, o.ride_id, o.status, o.offered_at, o.expires_at, r.pickup_address, r.pickup_latitude, r.pickup_longitude, r.destination_address,
                r.destination_latitude, r.destination_longitude, r.distance_km, r.duration_minutes, r.estimated_fare, r.fare_breakdown
           from public.ride_offers o join public.rides r on r.id = o.ride_id
          where o.driver_id=$1 and o.status='pending' and o.expires_at > now() order by o.offered_at desc`, [did]);
      return rows.map(({ pickup_address, pickup_latitude, pickup_longitude, destination_address, destination_latitude, destination_longitude, distance_km, duration_minutes, estimated_fare, fare_breakdown, ...o }) =>
        ({ ...o, ride: { pickup_address, pickup_latitude, pickup_longitude, destination_address, destination_latitude, destination_longitude, distance_km, duration_minutes, estimated_fare, fare_breakdown } }));
    },
    getOffer: (id) => one('select * from public.ride_offers where id=$1', [id]),
    acceptOffer: (oid, did) => fn('public.accept_offer($1,$2)', [oid, did]),
    rejectOffer: (oid, did) => fn('public.reject_offer($1,$2)', [oid, did]),
    expireStaleOffers: () => q('select * from public.expire_stale_offers()'),
    markUnmatched: (rid) => fn('public.mark_ride_unmatched($1)', [rid]),
    startRide: (rid, did) => fn('public.start_ride($1,$2)', [rid, did]),
    completeRide: (rid, did) => fn('public.complete_ride($1,$2)', [rid, did]),
    cancelRide: (rid, role, actor) => fn('public.cancel_ride($1,$2,$3)', [rid, role, actor]),
    async listStalledRideIds(olderThanSeconds) {
      const rows = await q(
        `select r.id from public.rides r
          where r.status in ('requested','searching') and r.updated_at < now() - make_interval(secs => $1)
            and not exists (select 1 from public.ride_offers o where o.ride_id=r.id and o.status='pending' and o.expires_at > now())`,
        [olderThanSeconds]);
      return rows.map((r) => r.id);
    },
    async getRideParties(ride) {
      const passenger = await one('select full_name, phone from public.profiles where id=$1', [ride.passenger_id]);
      let driver = null;
      if (ride.driver_id) {
        driver = await one(
          `select d.id, d.profile_id, d.vehicle_model, d.vehicle_registration, d.is_verified, p.full_name, p.phone
             from public.drivers d join public.profiles p on p.id = d.profile_id where d.id=$1`, [ride.driver_id]);
        if (driver) {
          driver.location = await one(
            'select latitude, longitude, updated_at from public.driver_locations where driver_id=$1', [ride.driver_id]);
        }
      }
      return { passenger, driver };
    },
  };
  return store;
}
