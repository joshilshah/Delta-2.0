import { test, describe, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb, createUser, placeDriver, resetState, lapseOffer, PICKUP, DESTINATION, northKm } from './helpers/db.js';
import { createPgStore } from './helpers/pgStore.js';
import { createDispatchService } from '../src/services/dispatchService.js';
import { loadConfig } from '../src/config/index.js';

const matching = loadConfig({}).matching;
const quiet = { error() {} };
let db, store, dispatch, passengers, drivers;

async function newRide(passenger, key) {
  const { ride } = await store.insertRide({
    passenger_id: passenger.id, request_key: key ?? `key-${Math.random().toString(36).slice(2)}`,
    pickup_address: PICKUP.address, pickup_latitude: PICKUP.latitude, pickup_longitude: PICKUP.longitude,
    destination_address: DESTINATION.address, destination_latitude: DESTINATION.latitude,
    destination_longitude: DESTINATION.longitude, distance_km: 8, duration_minutes: 20,
    estimated_fare: 176, fare_breakdown: {},
  });
  return ride;
}
const at = (km) => ({ lat: northKm(km), lng: PICKUP.longitude });

describe('driver matching and dispatch (real SQL via PGlite)', () => {
  before(async () => {
    db = await createTestDb();
    store = createPgStore(db);
    dispatch = createDispatchService({ store, matching, logger: quiet });
    passengers = await Promise.all([1, 2, 3, 4, 5].map(() => createUser(db)));
    drivers = await Promise.all([1, 2, 3].map(() => createUser(db, { role: 'driver' })));
  });
  beforeEach(() => resetState(db));

  test('offers the nearest eligible driver first and marks the ride searching', async () => {
    await placeDriver(db, drivers[0].driverId, at(3));
    await placeDriver(db, drivers[1].driverId, at(1));
    await placeDriver(db, drivers[2].driverId, at(2));
    const ride = await newRide(passengers[0]);
    const res = await dispatch.dispatchRide(ride.id);
    assert.equal(res.outcome, 'offered');
    assert.equal(res.offer.driver_id, drivers[1].driverId);
    assert.equal((await store.getRide(ride.id)).status, 'searching');
    // only ONE pending offer: never broadcast to every driver
    assert.equal((await db.query(`select count(*)::int c from public.ride_offers where status='pending'`)).rows[0].c, 1);
  });

  test('excludes offline, stale, missing-location and busy drivers', async () => {
    await placeDriver(db, drivers[0].driverId, { ...at(1), online: false });
    await placeDriver(db, drivers[1].driverId, { ...at(1), ageSeconds: matching.locationStaleSeconds + 30 });
    await placeDriver(db, drivers[2].driverId, { online: true }); // no location row
    const ride = await newRide(passengers[0]);
    assert.equal((await dispatch.dispatchRide(ride.id)).outcome, 'unmatched');
    assert.equal((await store.getRide(ride.id)).status, 'unmatched');
  });

  test('driver on an active ride is never offered another', async () => {
    await placeDriver(db, drivers[0].driverId, at(1));
    const r1 = await newRide(passengers[0]);
    const o1 = (await dispatch.dispatchRide(r1.id)).offer;
    await store.acceptOffer(o1.id, drivers[0].driverId);
    const r2 = await newRide(passengers[1]);
    assert.equal((await dispatch.dispatchRide(r2.id)).outcome, 'unmatched');
  });

  test('expands from 5 km to 10 km, and gives up beyond 10 km', async () => {
    await placeDriver(db, drivers[0].driverId, at(7));
    const ride = await newRide(passengers[0]);
    const res = await dispatch.dispatchRide(ride.id);
    assert.equal(res.outcome, 'offered');
    assert.equal(res.radiusKm, 10);

    await resetState(db);
    await placeDriver(db, drivers[0].driverId, at(12));
    assert.equal((await dispatch.dispatchRide((await newRide(passengers[1])).id)).outcome, 'unmatched');
  });

  test('reject moves to the next driver; all rejecting ends as unmatched', async () => {
    await placeDriver(db, drivers[0].driverId, at(1));
    await placeDriver(db, drivers[1].driverId, at(2));
    const ride = await newRide(passengers[0]);
    const first = (await dispatch.dispatchRide(ride.id)).offer;
    assert.equal(first.driver_id, drivers[0].driverId);

    const rej = await store.rejectOffer(first.id, drivers[0].driverId);
    const second = await dispatch.dispatchRide(rej.ride_id);
    assert.equal(second.offer.driver_id, drivers[1].driverId);

    const rej2 = await store.rejectOffer(second.offer.id, drivers[1].driverId);
    assert.equal((await dispatch.dispatchRide(rej2.ride_id)).outcome, 'unmatched');
    assert.equal((await store.getRide(ride.id)).status, 'unmatched');
  });

  test('expired offer is swept by the worker and the next driver is tried', async () => {
    await placeDriver(db, drivers[0].driverId, at(1));
    await placeDriver(db, drivers[1].driverId, at(2));
    const ride = await newRide(passengers[0]);
    const first = (await dispatch.dispatchRide(ride.id)).offer;
    await lapseOffer(db, first.id);

    const swept = await dispatch.sweep();
    assert.equal(swept.expired, 1);
    const offers = (await db.query('select driver_id, status from public.ride_offers order by offered_at')).rows;
    assert.equal(offers[0].status, 'expired');
    assert.equal(offers[1].driver_id, drivers[1].driverId);
    assert.equal(offers[1].status, 'pending');
  });

  test('an expired offer can never be accepted', async () => {
    await placeDriver(db, drivers[0].driverId, at(1));
    const ride = await newRide(passengers[0]);
    const offer = (await dispatch.dispatchRide(ride.id)).offer;
    await lapseOffer(db, offer.id);
    await assert.rejects(store.acceptOffer(offer.id, drivers[0].driverId), (e) => e.code === 'OFFER_EXPIRED');
    await dispatch.sweep();
    await assert.rejects(store.acceptOffer(offer.id, drivers[0].driverId), (e) => e.code === 'OFFER_NOT_PENDING');
    assert.notEqual((await store.getRide(ride.id)).status, 'accepted');
  });

  test('accept validates ownership and assigns atomically', async () => {
    await placeDriver(db, drivers[0].driverId, at(1));
    await placeDriver(db, drivers[1].driverId, at(2));
    const ride = await newRide(passengers[0]);
    const offer = (await dispatch.dispatchRide(ride.id)).offer;
    await assert.rejects(store.acceptOffer(offer.id, drivers[1].driverId), (e) => e.code === 'OFFER_NOT_FOUND');
    const accepted = await store.acceptOffer(offer.id, drivers[0].driverId);
    assert.equal(accepted.status, 'accepted');
    assert.equal(accepted.driver_id, drivers[0].driverId);
    // idempotent retry by the same driver
    assert.equal((await store.acceptOffer(offer.id, drivers[0].driverId)).id, ride.id);
  });

  test('late accept by a previous driver fails once the ride moved on', async () => {
    await placeDriver(db, drivers[0].driverId, at(1));
    await placeDriver(db, drivers[1].driverId, at(2));
    const ride = await newRide(passengers[0]);
    const a = (await dispatch.dispatchRide(ride.id)).offer;
    await lapseOffer(db, a.id);
    await dispatch.sweep();
    const b = (await db.query(`select * from public.ride_offers where driver_id=$1`, [drivers[1].driverId])).rows[0];
    const results = await Promise.allSettled([
      store.acceptOffer(a.id, drivers[0].driverId),
      store.acceptOffer(b.id, drivers[1].driverId),
      store.acceptOffer(b.id, drivers[1].driverId),
    ]);
    assert.equal(results[0].status, 'rejected');
    assert.equal(results[1].status, 'fulfilled');
    const final = await store.getRide(ride.id);
    assert.equal(final.driver_id, drivers[1].driverId);
    assert.equal((await db.query(`select count(*)::int c from public.rides where driver_id is not null`)).rows[0].c, 1);
  });

  test('simultaneous requests: 5 passengers, 2 drivers => exactly 2 offers, never a shared driver', async () => {
    await placeDriver(db, drivers[0].driverId, at(1));
    await placeDriver(db, drivers[1].driverId, at(2));
    const rides = await Promise.all(passengers.map((p) => newRide(p)));
    const results = await Promise.all(rides.map((r) => dispatch.dispatchRide(r.id)));
    const offered = results.filter((r) => r.outcome === 'offered');
    assert.equal(offered.length, 2);
    assert.equal(new Set(offered.map((r) => r.offer.driver_id)).size, 2);
    assert.equal(results.filter((r) => r.outcome === 'unmatched').length, 3);

    await Promise.all(offered.map((r) => store.acceptOffer(r.offer.id, r.offer.driver_id)));
    const active = (await db.query(
      `select driver_id, count(*)::int c from public.rides where status='accepted' group by driver_id`)).rows;
    assert.ok(active.every((r) => r.c === 1));
  });

  test('DB constraint blocks a second active ride for one driver, even when bypassing the functions', async () => {
    const [p1, p2] = passengers;
    const r1 = await newRide(p1); const r2 = await newRide(p2);
    await db.query(`update public.rides set status='searching' where id in ($1,$2)`, [r1.id, r2.id]);
    await db.query(`update public.rides set status='accepted', driver_id=$2 where id=$1`, [r1.id, drivers[0].driverId]);
    await assert.rejects(db.query(`update public.rides set status='accepted', driver_id=$2 where id=$1`,
      [r2.id, drivers[0].driverId]), /rides_one_active_per_driver/);
  });

  test('driver going offline withdraws the pending offer and re-dispatches', async () => {
    await placeDriver(db, drivers[0].driverId, at(1));
    await placeDriver(db, drivers[1].driverId, at(2));
    const ride = await newRide(passengers[0]);
    const first = (await dispatch.dispatchRide(ride.id)).offer;
    const res = await store.setDriverOnline(drivers[0].driverId, false);
    assert.deepEqual(res.affected_ride_ids, [ride.id]);
    await dispatch.dispatchRide(ride.id);
    const offers = (await db.query('select driver_id, status from public.ride_offers order by offered_at')).rows;
    assert.equal(offers[0].status, 'cancelled');
    assert.equal(offers[1].driver_id, drivers[1].driverId);
    await assert.rejects(store.acceptOffer(first.id, drivers[0].driverId), (e) => e.code === 'OFFER_NOT_PENDING');
  });

  test('a driver with an active ride cannot go offline', async () => {
    await placeDriver(db, drivers[0].driverId, at(1));
    const ride = await newRide(passengers[0]);
    const offer = (await dispatch.dispatchRide(ride.id)).offer;
    await store.acceptOffer(offer.id, drivers[0].driverId);
    await assert.rejects(store.setDriverOnline(drivers[0].driverId, false), (e) => e.code === 'DRIVER_HAS_ACTIVE_RIDE');
  });
});
