import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb, createUser, placeDriver, resetState, PICKUP, DESTINATION, northKm } from './helpers/db.js';
import { createPgStore } from './helpers/pgStore.js';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config/index.js';

const config = loadConfig({ DEMO_AUTOPILOT: 'on', DEMO_AUTOPILOT_EMAILS: 'auto9@demo.ridehail.test' });
const quiet = { error() {}, warn() {}, log() {} };
let db, server, base, boss, rider, driver;

const call = async (method, path, user, body) => {
  const res = await fetch(base + path, {
    method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${user.id}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
};

describe('admin dashboard API', () => {
  before(async () => {
    db = await createTestDb();
    const built = createApp({
      config, store: createPgStore(db), logger: quiet, verifyToken: async (t) => ({ id: t }),
      routeService: { async getRoute() { return { distanceKm: 8, durationMinutes: 20, source: 'test' }; } },
    });
    server = built.app.listen(0);
    base = `http://127.0.0.1:${server.address().port}`;
    [boss, rider] = await Promise.all([createUser(db, { name: 'Boss' }), createUser(db)]);
    driver = await createUser(db, { role: 'driver' });
    await createUser(db, { role: 'driver', name: 'Auto (demo driver)', email: 'auto9@demo.ridehail.test' });
  });
  after(() => server.close());
  beforeEach(() => resetState(db));

  test('only accounts in app_admins get in; /me says who is an admin', async () => {
    assert.equal((await call('GET', '/api/admin/overview', boss)).status, 403);
    assert.equal((await call('GET', '/api/me', boss)).body.user.is_admin, false);
    await db.query('insert into public.app_admins (user_id) values ($1) on conflict do nothing', [boss.id]);
    assert.equal((await call('GET', '/api/me', boss)).body.user.is_admin, true);
    for (const path of ['/api/admin/overview', '/api/admin/rides', '/api/admin/drivers', '/api/admin/users', '/api/admin/support/tickets', '/api/admin/settings']) {
      assert.equal((await call('GET', path, boss)).status, 200, path);
      assert.equal((await call('GET', path, rider)).status, 403, path);
      assert.equal((await call('GET', path, driver)).status, 403, path);
    }
    assert.equal((await call('PUT', '/api/admin/settings/autopilot', rider, { enabled: false })).status, 403);
    const { privileges } = (await db.query(`select has_table_privilege('authenticated', 'public.app_admins', 'select') privileges`)).rows[0];
    assert.equal(privileges, false, 'browsers cannot read the admin list');
  });

  test('overview counts, and the autopilot switch persists and overrides the env default', async () => {
    const ov = (await call('GET', '/api/admin/overview', boss)).body;
    assert.ok(ov.users.riders >= 2);
    assert.ok(ov.users.drivers >= 2);
    assert.equal(ov.autopilot.enabled, true);
    assert.equal(ov.autopilot.source, 'env');
    assert.equal(ov.autopilot.drivers.length, 1);

    const off = await call('PUT', '/api/admin/settings/autopilot', boss, { enabled: false });
    assert.equal(off.body.autopilot.enabled, false);
    assert.equal(off.body.autopilot.source, 'admin');
    const row = (await db.query(`select value, updated_by from public.app_settings where key='demo_autopilot'`)).rows[0];
    assert.deepEqual(row.value, { enabled: false });
    assert.equal(row.updated_by, boss.id);
    // With autopilot off and nobody online, a booking goes unmatched instead of summoning a demo driver.
    const r = await call('POST', '/api/rides', rider, { pickup: PICKUP, destination: DESTINATION, idempotencyKey: 'admin-off-0001' });
    assert.equal(r.body.ride.status, 'unmatched');
    assert.equal((await call('PUT', '/api/admin/settings/autopilot', boss, { enabled: true })).body.autopilot.enabled, true);
    assert.equal((await call('PUT', '/api/admin/settings/autopilot', boss, { enabled: 'yes' })).status, 400);
  });

  test('rides: live list, cancel a stuck ride, complete only trips in progress', async () => {
    await placeDriver(db, driver.driverId, { lat: northKm(1), lng: PICKUP.longitude });
    const booked = await call('POST', '/api/rides', rider, { pickup: PICKUP, destination: DESTINATION, idempotencyKey: 'admin-ride-0001' });
    const id = booked.body.ride.id;
    const live = (await call('GET', '/api/admin/rides?filter=live', boss)).body.rides;
    assert.ok(live.some((x) => x.ride_id === id && x.passenger_email && x.pickup_address === PICKUP.address));
    assert.equal((await call('POST', `/api/admin/rides/${id}/action`, boss, { action: 'complete' })).status, 409);
    const cancelled = await call('POST', `/api/admin/rides/${id}/action`, boss, { action: 'cancel' });
    assert.equal(cancelled.body.ride.status, 'cancelled');
    assert.equal(cancelled.body.ride.cancelled_by, 'system');
    assert.equal((await call('GET', '/api/drivers/offers', driver)).body.offers.length, 0, 'pending offer withdrawn');
    assert.equal((await call('GET', '/api/admin/rides?filter=nope', boss)).status, 400);
  });

  test('drivers list and force offline; users list marks admins', async () => {
    await placeDriver(db, driver.driverId, { lat: northKm(1), lng: PICKUP.longitude });
    const ds = (await call('GET', '/api/admin/drivers', boss)).body.drivers;
    const me = ds.find((d) => d.id === driver.driverId);
    assert.equal(me.is_online, true);
    assert.ok(ds.some((d) => d.autopilot));
    await call('POST', `/api/admin/drivers/${driver.driverId}/offline`, boss);
    assert.equal((await db.query('select is_online from public.drivers where id=$1', [driver.driverId])).rows[0].is_online, false);
    const users = (await call('GET', '/api/admin/users', boss)).body.users;
    assert.equal(users.find((u) => u.id === boss.id).is_admin, true);
    assert.equal(users.find((u) => u.id === rider.id).is_admin, false);
  });

  test('support inbox: admin replies and resolves; the user sees it on their request', async () => {
    const t = (await call('POST', '/api/support/tickets', rider, { category: 'fare', subject: 'Charged twice', description: 'I was charged two times for one ride.' })).body.ticket;
    const inbox = (await call('GET', '/api/admin/support/tickets', boss)).body.tickets;
    assert.ok(inbox.some((x) => x.id === t.id && x.user.email));
    assert.equal((await call('POST', `/api/admin/support/tickets/${t.id}/respond`, boss, {})).status, 400);
    await call('POST', `/api/admin/support/tickets/${t.id}/respond`, boss, { message: 'Refund issued.', status: 'resolved' });
    const mine = (await call('GET', `/api/support/tickets/${t.id}`, rider)).body;
    assert.equal(mine.ticket.status, 'resolved');
    assert.ok(mine.updates.some((u) => u.author === 'support' && u.message === 'Refund issued.'));
    await call('POST', `/api/admin/support/tickets/${t.id}/respond`, boss, { status: 'closed' });
    assert.equal((await call('GET', `/api/support/tickets/${t.id}`, rider)).body.ticket.status, 'closed');
  });
});
