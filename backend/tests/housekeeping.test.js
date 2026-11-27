// Serverless mode (Vercel): no background timers. Offer expiry and re-dispatch must still happen,
// driven by ordinary API requests.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb, createUser, placeDriver, lapseOffer, PICKUP, DESTINATION, northKm } from './helpers/db.js';
import { createPgStore } from './helpers/pgStore.js';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config/index.js';

const config = loadConfig({ WORKER_INTERVAL_MS: '0' });
const quiet = { error() {}, warn() {}, log() {} };
let db, server, base, p1, d1, d2;

const call = async (method, path, user, body) => {
  const res = await fetch(base + path, {
    method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${user.id}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
};

describe('serverless housekeeping', () => {
  before(async () => {
    db = await createTestDb();
    const built = createApp({
      config, store: createPgStore(db), logger: quiet, housekeeping: true,
      verifyToken: async (t) => ({ id: t }),
      routeService: { async getRoute() { return { distanceKm: 8, durationMinutes: 20, source: 'test' }; } },
    });
    server = built.app.listen(0);
    base = `http://127.0.0.1:${server.address().port}`;
    p1 = await createUser(db);
    [d1, d2] = await Promise.all([1, 2].map(() => createUser(db, { role: 'driver' })));
  });
  after(() => server.close());

  test('a lapsed offer moves to the next driver on the next API request, with no worker running', async () => {
    await placeDriver(db, d1.driverId, { lat: northKm(1), lng: PICKUP.longitude });
    await placeDriver(db, d2.driverId, { lat: northKm(3), lng: PICKUP.longitude });
    const booked = await call('POST', '/api/rides', p1, { pickup: PICKUP, destination: DESTINATION, idempotencyKey: 'hk-test-0001' });
    assert.equal(booked.status, 201);
    const first = (await call('GET', '/api/drivers/offers', d1)).body.offers;
    assert.equal(first.length, 1); // nearest driver asked first

    await lapseOffer(db, first[0].id);
    // Any request (here: the rider polling the ride) runs the sweep before being handled.
    await call('GET', `/api/rides/${booked.body.ride.id}`, p1);
    assert.equal((await call('GET', '/api/drivers/offers', d1)).body.offers.length, 0);
    assert.equal((await call('GET', '/api/drivers/offers', d2)).body.offers.length, 1);
  });
});
