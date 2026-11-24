import { test, describe, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb, createUser, createOAuthUser, placeDriver, resetState, PICKUP, DESTINATION, northKm } from './helpers/db.js';
import { createPgStore } from './helpers/pgStore.js';

let db, store, p1, p2, d1, d2;

async function ride(passenger) {
  return (await store.insertRide({
    passenger_id: passenger.id, request_key: `k-${Math.random()}`.slice(0, 20).replace('.', 'x'),
    pickup_address: PICKUP.address, pickup_latitude: PICKUP.latitude, pickup_longitude: PICKUP.longitude,
    destination_address: DESTINATION.address, destination_latitude: DESTINATION.latitude,
    destination_longitude: DESTINATION.longitude, distance_km: 8, duration_minutes: 20,
    estimated_fare: 176, fare_breakdown: {},
  })).ride;
}
async function asUser(userId, role, sql, params) {
  await db.exec(`set role ${role}`);
  try {
    await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userId ?? '']);
    return (await db.query(sql, params)).rows;
  } finally {
    await db.exec('reset role');
  }
}

describe('database constraints, triggers and RLS', () => {
  before(async () => {
    db = await createTestDb();
    store = createPgStore(db);
    [p1, p2] = await Promise.all([createUser(db), createUser(db)]);
    [d1, d2] = await Promise.all([createUser(db, { role: 'driver' }), createUser(db, { role: 'driver' })]);
  });
  beforeEach(() => resetState(db));

  test('signup trigger creates profile and driver rows from auth metadata', async () => {
    const prof = (await db.query('select role, phone from public.profiles where id=$1', [d1.id])).rows[0];
    assert.equal(prof.role, 'driver');
    const drv = (await db.query('select is_online, is_verified from public.drivers where id=$1', [d1.driverId])).rows[0];
    assert.deepEqual(drv, { is_online: false, is_verified: false });
  });

  test('Google-style signup is flagged for onboarding; completing it is one-time and atomic', async () => {
    const g = await createOAuthUser(db, 'Ana Google');
    const row = (await db.query('select role, full_name, needs_onboarding from public.profiles where id=$1', [g.id])).rows[0];
    assert.deepEqual(row, { role: 'passenger', full_name: 'Ana Google', needs_onboarding: true });
    assert.equal((await db.query('select count(*)::int c from public.drivers where profile_id=$1', [g.id])).rows[0].c, 0);

    const done = await store.completeOnboarding(g.id, { role: 'driver', phone: '+91 91234 56789', vehicle_model: 'Alto', vehicle_registration: 'KA09 X 1' });
    assert.equal(done.role, 'driver');
    assert.equal(done.needs_onboarding, false);
    assert.equal((await db.query('select count(*)::int c from public.drivers where profile_id=$1', [g.id])).rows[0].c, 1);

    await assert.rejects(store.completeOnboarding(g.id, { role: 'passenger', phone: '+91 91234 56789' }), (e) => e.code === 'ALREADY_ONBOARDED');
    await assert.rejects(db.query(`update public.profiles set role='passenger' where id=$1`, [g.id]), /ROLE_IMMUTABLE/);
  });

  test('email signups are never marked for onboarding, and clients cannot clear the flag themselves', async () => {
    assert.equal((await db.query('select needs_onboarding from public.profiles where id=$1', [p1.id])).rows[0].needs_onboarding, false);
    const g = await createOAuthUser(db);
    await assert.rejects(asUser(g.id, 'authenticated', `update public.profiles set needs_onboarding=false where id=$1`, [g.id]), /permission denied/);
    await assert.rejects(store.completeOnboarding(p1.id, { role: 'driver', phone: '+91 91234 56789', vehicle_model: 'A', vehicle_registration: 'B' }), (e) => e.code === 'ALREADY_ONBOARDED');
  });

  test('account role cannot be changed after registration', async () => {
    await assert.rejects(db.query(`update public.profiles set role='driver' where id=$1`, [p1.id]), /ROLE_IMMUTABLE/);
  });

  test('state machine enforced in the database; completed rides never go back', async () => {
    const r = await ride(p1);
    await assert.rejects(db.query(`update public.rides set status='completed' where id=$1`, [r.id]), /INVALID_TRANSITION/);
    await db.query(`update public.rides set status='cancelled' where id=$1`, [r.id]);
    await assert.rejects(db.query(`update public.rides set status='searching' where id=$1`, [r.id]), /INVALID_TRANSITION/);
  });

  test('full lifecycle: accept -> start -> complete releases the driver', async () => {
    await placeDriver(db, d1.driverId, { lat: northKm(1), lng: PICKUP.longitude });
    const r = await ride(p1);
    const { offer } = await store.createOffer({ rideId: r.id, driverId: d1.driverId, ttlSeconds: 30 });
    await store.acceptOffer(offer.id, d1.driverId);
    await assert.rejects(store.startRide(r.id, d2.driverId), (e) => e.code === 'NOT_ASSIGNED_DRIVER');
    await assert.rejects(store.completeRide(r.id, d1.driverId), (e) => e.code === 'INVALID_TRANSITION');
    assert.equal((await store.startRide(r.id, d1.driverId)).status, 'in_progress');
    assert.equal((await store.completeRide(r.id, d1.driverId)).status, 'completed');
    assert.equal(await store.getActiveRideForDriver(d1.driverId), null);
    await assert.rejects(store.cancelRide(r.id, 'passenger', p1.id), (e) => e.code === 'INVALID_TRANSITION');
    const elig = await store.findEligibleDrivers({ lat: PICKUP.latitude, lng: PICKUP.longitude, radiusKm: 5, staleSeconds: 120 });
    assert.equal(elig.length, 1); // released and eligible again
  });

  test('cancellation rules and participants', async () => {
    await placeDriver(db, d1.driverId, { lat: northKm(1), lng: PICKUP.longitude });
    const r = await ride(p1);
    await assert.rejects(store.cancelRide(r.id, 'passenger', p2.id), (e) => e.code === 'NOT_PARTICIPANT');
    await assert.rejects(store.cancelRide(r.id, 'driver', d1.driverId), (e) => e.code === 'NOT_PARTICIPANT');
    const { offer } = await store.createOffer({ rideId: r.id, driverId: d1.driverId, ttlSeconds: 30 });
    assert.equal((await store.cancelRide(r.id, 'passenger', p1.id)).status, 'cancelled');
    assert.equal((await store.getOffer(offer.id)).status, 'cancelled');
    await assert.rejects(store.acceptOffer(offer.id, d1.driverId), (e) => e.code === 'OFFER_NOT_PENDING');
  });

  test('one open ride per passenger (duplicate-click guard)', async () => {
    await ride(p1);
    await assert.rejects(ride(p1), (e) => e.code === 'ACTIVE_RIDE_EXISTS');
  });

  test('same idempotency key returns the same ride', async () => {
    const base = {
      passenger_id: p1.id, request_key: 'same-key-123', pickup_address: 'A', pickup_latitude: 1, pickup_longitude: 1,
      destination_address: 'B', destination_latitude: 2, destination_longitude: 2, distance_km: 1,
      duration_minutes: 1, estimated_fare: 1, fare_breakdown: {},
    };
    const a = await store.insertRide(base);
    const b = await store.insertRide(base);
    assert.equal(a.ride.id, b.ride.id);
    assert.equal(b.duplicate, true);
  });

  test('RLS: passengers see only their own rides; drivers only their offers and assigned rides', async () => {
    await placeDriver(db, d1.driverId, { lat: northKm(1), lng: PICKUP.longitude });
    const r = await ride(p1);
    await store.createOffer({ rideId: r.id, driverId: d1.driverId, ttlSeconds: 30 });

    assert.equal((await asUser(p1.id, 'authenticated', 'select id from public.rides')).length, 1);
    assert.equal((await asUser(p2.id, 'authenticated', 'select id from public.rides')).length, 0);
    assert.equal((await asUser(d1.id, 'authenticated', 'select id from public.rides')).length, 0); // not assigned yet
    assert.equal((await asUser(d1.id, 'authenticated', 'select id from public.ride_offers')).length, 1);
    assert.equal((await asUser(d2.id, 'authenticated', 'select id from public.ride_offers')).length, 0);
    assert.equal((await asUser(p2.id, 'authenticated', 'select id from public.profiles')).length, 1); // only self
    assert.equal((await asUser(null, 'anon', 'select 1 where false')).length, 0);
  });

  test('RLS / grants: clients cannot write rides, change roles or call dispatch functions', async () => {
    const r = await ride(p1);
    await assert.rejects(asUser(p1.id, 'authenticated', `update public.rides set status='cancelled' where id=$1`, [r.id]), /permission denied/);
    await assert.rejects(asUser(p1.id, 'authenticated', `update public.profiles set role='driver' where id=$1`, [p1.id]), /permission denied/);
    await assert.rejects(asUser(p1.id, 'authenticated', `select public.accept_offer(gen_random_uuid(), $1)`, [d1.driverId]), /permission denied/);
    await assert.rejects(asUser(null, 'anon', 'select * from public.rides'), /permission denied/);
    // allowed: editing own name
    await asUser(p1.id, 'authenticated', `update public.profiles set full_name='New Name' where id=$1`, [p1.id]);
  });
});
