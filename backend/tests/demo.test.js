// Demo autopilot: a whole trip with no human driver, driven by a simulated clock.
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb, createUser, placeDriver, resetState, PICKUP, DESTINATION, northKm } from './helpers/db.js';
import { createPgStore } from './helpers/pgStore.js';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config/index.js';

const AUTO_EMAIL = 'auto1@demo.ridehail.test';
const config = loadConfig({ DEMO_AUTOPILOT: 'on', DEMO_AUTOPILOT_EMAILS: AUTO_EMAIL });
const quiet = { error() {}, warn() {}, log() {} };
let db, server, base, demo, clock, rider, auto, manual;

const call = async (method, path, user, body) => {
  const res = await fetch(base + path, {
    method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${user.id}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
};
const book = (key) => call('POST', '/api/rides', rider, { pickup: PICKUP, destination: DESTINATION, idempotencyKey: key });
const ride = async (id) => (await call('GET', `/api/rides/${id}`, rider)).body.ride;
const isOnline = async (driverId) => (await db.query('select is_online from public.drivers where id=$1', [driverId])).rows[0].is_online;

describe('demo autopilot drivers', () => {
  before(async () => {
    db = await createTestDb();
    clock = Date.now();
    const built = createApp({
      config, store: createPgStore(db), logger: quiet, demoClock: () => clock,
      verifyToken: async (t) => ({ id: t }),
      routeService: { async getRoute() { return { distanceKm: 8, durationMinutes: 20, source: 'test' }; } },
    });
    demo = built.demoService;
    server = built.app.listen(0);
    base = `http://127.0.0.1:${server.address().port}`;
    rider = await createUser(db);
    auto = await createUser(db, { role: 'driver', name: 'Ravi (demo driver)', email: AUTO_EMAIL });
    manual = await createUser(db, { role: 'driver', name: 'Asha (demo driver)' });
  });
  after(() => server.close());
  beforeEach(async () => { await resetState(db); clock = Date.now(); });

  test('with nobody online, an autopilot driver appears near the pickup and runs the whole trip', async () => {
    const booked = await book('demo-full-trip-1');
    assert.equal(booked.status, 201);
    const id = booked.body.ride.id;
    assert.ok(await isOnline(auto.driverId), 'autopilot driver brought online');
    const offers = (await call('GET', '/api/drivers/offers', auto)).body.offers;
    assert.equal(offers.length, 1);
    assert.ok(offers[0].pickup_distance_km <= 1.5, 'placed about a kilometre from the pickup');

    await demo.tick();                       // too early: still thinking
    assert.equal((await ride(id)).status, 'searching');
    clock += 5_000; await demo.tick();       // accepts
    let r = await ride(id);
    assert.equal(r.status, 'accepted');
    assert.ok(r.driver.location);
    const hello = (await call('GET', `/api/rides/${id}/messages`, rider)).body.messages;
    assert.match(hello[0].body, /Ravi, on my way/);

    const startKm = r.eta.distance_km;
    clock += 15_000; await demo.tick();      // drives toward the pickup
    r = await ride(id);
    assert.ok(r.eta.distance_km < startKm, 'closer to the pickup');
    assert.equal(r.arrived_at, null);

    clock += 60_000; await demo.tick();      // arrives
    r = await ride(id);
    assert.ok(r.arrived_at, 'arrived');
    const msgs = (await call('GET', `/api/rides/${id}/messages`, rider)).body.messages;
    assert.ok(msgs.some((m) => m.sender_role === 'system' && /arrived/.test(m.body)));

    clock += 11_000; await demo.tick();      // starts after a short wait
    assert.equal((await ride(id)).status, 'in_progress');
    clock = Date.now();                      // started_at is stamped by the database's real clock: re-sync
    clock += 30_000; await demo.tick();      // part-way through the trip
    assert.equal((await ride(id)).status, 'in_progress');
    clock += 120_000; await demo.tick();     // done
    assert.equal((await ride(id)).status, 'completed');
    assert.ok((await call('GET', `/api/rides/${id}/path`, rider)).body.points.length >= 4, 'driven path recorded');

    clock += 25_000; await demo.tick();      // parks offline when idle
    assert.equal(await isOnline(auto.driverId), false);
  });

  test('a real (manual) driver nearby still gets the request first', async () => {
    await placeDriver(db, manual.driverId, { lat: northKm(2), lng: PICKUP.longitude });
    const booked = await book('demo-manual-first-1');
    assert.equal((await call('GET', '/api/drivers/offers', manual)).body.offers.length, 1);
    assert.equal(await isOnline(auto.driverId), false, 'autopilot stays parked');
    assert.equal(booked.body.ride.status, 'searching');
  });

  test('autopilot is off unless DEMO_AUTOPILOT=on', async () => {
    const off = loadConfig({});
    assert.equal(off.demo.enabled, false);
  });
});
