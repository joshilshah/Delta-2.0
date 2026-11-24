import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb, createUser, placeDriver, resetState, PICKUP, DESTINATION, northKm } from './helpers/db.js';
import { createPgStore } from './helpers/pgStore.js';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config/index.js';

const config = loadConfig({});
const quiet = { error() {}, warn() {}, log() {} };
const verifyToken = async (token) => ({ id: token });
const routeService = { async getRoute() { return { distanceKm: 8, durationMinutes: 20, source: 'test' }; } };
let db, server, base, support, tracking, p1, p2, d1, d2;

async function call(method, path, user, body) {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(user ? { Authorization: `Bearer ${user.id ?? user}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
}

/** Book with p1 and have d1 (the only online driver) accept. Returns the ride id. */
async function matchedRide(passenger = p1, driver = d1, key = `k-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`) {
  await placeDriver(db, driver.driverId, { lat: northKm(1), lng: PICKUP.longitude });
  const booked = await call('POST', '/api/rides', passenger, { pickup: PICKUP, destination: DESTINATION, idempotencyKey: key });
  assert.equal(booked.status, 201);
  const offers = await call('GET', '/api/drivers/offers', driver);
  assert.equal(offers.body.offers.length, 1);
  const accepted = await call('POST', `/api/offers/${offers.body.offers[0].id}/accept`, driver);
  assert.equal(accepted.status, 200);
  return booked.body.ride.id;
}

describe('Phase 2', () => {
  before(async () => {
    db = await createTestDb();
    const built = createApp({ config, store: createPgStore(db), routeService, verifyToken, logger: quiet });
    support = built.supportService;
    tracking = built.trackingService;
    server = built.app.listen(0);
    base = `http://127.0.0.1:${server.address().port}`;
    [p1, p2] = await Promise.all([createUser(db), createUser(db)]);
    [d1, d2] = await Promise.all([1, 2].map(() => createUser(db, { role: 'driver', vehicle: 'Swift' })));
  });
  after(() => server.close());
  beforeEach(() => resetState(db));

  test('arrival: only the assigned driver, only before the trip, and the passenger gets one automated message', async () => {
    const id = await matchedRide();
    const before = await call('GET', `/api/rides/${id}`, d1);
    assert.ok(before.body.ride.allowed_actions.includes('arrive'));
    assert.equal(before.body.ride.eta.target, 'pickup');

    assert.equal((await call('POST', `/api/rides/${id}/arrived`, p1)).status, 403);
    assert.equal((await call('POST', `/api/rides/${id}/arrived`, d2)).status, 404);
    const arrived = await call('POST', `/api/rides/${id}/arrived`, d1);
    assert.equal(arrived.status, 200);
    assert.ok(arrived.body.ride.arrived_at);
    assert.ok(!arrived.body.ride.allowed_actions.includes('arrive'));
    await call('POST', `/api/rides/${id}/arrived`, d1); // idempotent

    const msgs = await call('GET', `/api/rides/${id}/messages`, p1);
    const system = msgs.body.messages.filter((m) => m.sender_role === 'system');
    assert.equal(system.length, 1);
    assert.match(system[0].body, /arrived at the pickup point/);
    assert.match(system[0].body, /Swift/);
    assert.equal((await call('GET', `/api/rides/${id}`, p1)).body.ride.arrived_at, arrived.body.ride.arrived_at);

    await call('POST', `/api/rides/${id}/start`, d1);
    assert.equal((await call('POST', `/api/rides/${id}/arrived`, d1)).status, 409); // too late
  });

  test('chat: participants only, active rides only, sender is derived from the session', async () => {
    const id = await matchedRide();
    const sent = await call('POST', `/api/rides/${id}/messages`, p1, { body: 'I am at gate 2' });
    assert.equal(sent.status, 201);
    assert.equal((await call('POST', `/api/rides/${id}/messages`, d1, { body: 'Coming in 2 min' })).status, 201);
    assert.equal((await call('POST', `/api/rides/${id}/messages`, p2, { body: 'hi' })).status, 404);
    assert.equal((await call('GET', `/api/rides/${id}/messages`, d2)).status, 404);
    assert.equal((await call('POST', `/api/rides/${id}/messages`, p1, { body: '   ' })).status, 400);
    assert.equal((await call('POST', `/api/rides/${id}/messages`, p1, { body: 'x', sender_role: 'driver' })).status, 400);

    const forDriver = await call('GET', `/api/rides/${id}/messages`, d1);
    assert.deepEqual(forDriver.body.messages.map((m) => [m.sender_role, m.mine]), [['passenger', false], ['driver', true]]);
    assert.equal(forDriver.body.can_send, true);

    await call('POST', `/api/rides/${id}/start`, d1);
    await call('POST', `/api/rides/${id}/complete`, d1);
    const closed = await call('GET', `/api/rides/${id}/messages`, p1);
    assert.equal(closed.body.can_send, false);
    assert.equal((await call('POST', `/api/rides/${id}/messages`, p1, { body: 'thanks' })).body.error.code, 'CHAT_CLOSED');
  });

  test('ride_log view: one readable row per booking, hidden from browser roles', async () => {
    const id = await matchedRide();
    const { rows: [row] } = await db.query('select * from public.ride_log where ride_id = $1', [id]);
    assert.equal(row.status, 'accepted');
    assert.equal(row.pickup_address, PICKUP.address);
    assert.equal(row.destination_address, DESTINATION.address);
    assert.equal(row.passenger_name, p1.name);
    assert.equal(row.passenger_phone, p1.phone);
    assert.equal(row.driver_name, d1.name);
    assert.equal(Number(row.offers_sent), 1);
    const { rows: [priv] } = await db.query(`select has_table_privilege('authenticated', 'public.ride_log', 'select') ok`);
    assert.equal(priv.ok, false);
  });

  test('tracking: throttled path writes, live ETA, and monitoring alerts for deviation and long stops', async () => {
    const id = await matchedRide();
    const post = (lat, lng) => call('POST', '/api/drivers/location', d1, { latitude: lat, longitude: lng });
    await post(northKm(0.5), PICKUP.longitude);
    await post(northKm(0.5) + 0.00005, PICKUP.longitude); // ~5 m: throttled
    let path = await call('GET', `/api/rides/${id}/path`, p1);
    assert.equal(path.body.points.length, 1);
    assert.equal((await call('GET', `/api/rides/${id}/path`, p2)).status, 404);

    await call('POST', `/api/rides/${id}/start`, d1);
    // 5 km north of the pickup -> destination line: a deviation alert, raised once.
    await post(northKm(5), PICKUP.longitude);
    await post(northKm(5.2), PICKUP.longitude);
    let alerts = (await call('GET', `/api/rides/${id}/alerts`, p1)).body.alerts;
    assert.deepEqual(alerts.map((a) => a.kind), ['route_deviation']);
    assert.equal((await call('GET', `/api/rides/${id}/alerts`, d1)).status, 403);

    // Long stop: back on route, stationary for 6 minutes (backdated events).
    const on = { latitude: PICKUP.latitude + 0.0003, longitude: PICKUP.longitude + 0.012 };
    await db.query('delete from public.ride_tracking_events where ride_id = $1', [id]);
    for (const minsAgo of [6, 4, 2]) {
      await db.query(`insert into public.ride_tracking_events (ride_id, latitude, longitude, ride_status, recorded_at)
                      values ($1,$2,$3,'in_progress', now() - make_interval(mins => $4))`, [id, on.latitude, on.longitude, minsAgo]);
    }
    const ride = (await db.query('select * from public.rides where id=$1', [id])).rows[0];
    ride.started_at = new Date(Date.now() - 10 * 60000).toISOString();
    await tracking.monitor(ride, on);
    alerts = (await call('GET', `/api/rides/${id}/alerts`, p1)).body.alerts;
    assert.deepEqual(alerts.map((a) => a.kind).sort(), ['long_stop', 'route_deviation']);

    // Passenger reviews: dismiss one, ask for help on the other (creates a safety ticket).
    const stop = alerts.find((a) => a.kind === 'long_stop');
    const dev = alerts.find((a) => a.kind === 'route_deviation');
    assert.equal((await call('POST', `/api/safety/alerts/${stop.id}`, p2, { action: 'dismiss' })).status, 404);
    assert.equal((await call('POST', `/api/safety/alerts/${stop.id}`, p1, { action: 'dismiss' })).body.alert.status, 'dismissed');
    const help = await call('POST', `/api/safety/alerts/${dev.id}`, p1, { action: 'help' });
    assert.equal(help.body.alert.status, 'help_requested');
    assert.equal(help.body.ticket.category, 'safety');
  });

  test('trip share links: passenger-only, unguessable, no phone numbers, revocable, dead after the trip', async () => {
    const id = await matchedRide();
    assert.equal((await call('POST', `/api/rides/${id}/shares`, d1)).status, 403);
    assert.equal((await call('POST', `/api/rides/${id}/shares`, p2)).status, 404);
    const made = await call('POST', `/api/rides/${id}/shares`, p1);
    assert.equal(made.status, 201);
    const { token } = made.body.share;
    assert.ok(token.length >= 30);

    const pub = await call('GET', `/api/public/share/${token}`);
    assert.equal(pub.status, 200);
    assert.equal(pub.body.trip.status, 'accepted');
    assert.equal(pub.body.trip.pickup.address, PICKUP.address);
    assert.ok(pub.body.trip.driver.location);
    assert.ok(!JSON.stringify(pub.body).includes(p1.phone));
    assert.ok(!JSON.stringify(pub.body).includes(d1.phone));
    const stored = await db.query('select token_hash from public.trip_shares');
    assert.notEqual(stored.rows[0].token_hash, token); // only the hash is stored

    assert.equal((await call('GET', '/api/public/share/not-a-real-token-at-all-xx')).status, 404);
    const list = await call('GET', `/api/rides/${id}/shares`, p1);
    assert.equal(list.body.shares.length, 1);
    assert.equal(list.body.shares[0].token_hash, undefined);

    await call('POST', `/api/rides/${id}/cancel`, p1);
    const ended = await call('GET', `/api/public/share/${token}`);
    assert.equal(ended.body.trip.status, 'cancelled');
    assert.equal(ended.body.trip.driver.location, null);

    assert.equal((await call('DELETE', `/api/shares/${made.body.share.id}`, p2)).status, 404);
    assert.equal((await call('DELETE', `/api/shares/${made.body.share.id}`, p1)).status, 200);
    assert.equal((await call('GET', `/api/public/share/${token}`)).status, 404);
  });

  test('emergency contacts and saved places are private to their owner', async () => {
    const c = await call('POST', '/api/safety/contacts', p1, { name: 'Mum', phone: '+91 98450 00000', relationship: 'Mother' });
    assert.equal(c.status, 201);
    assert.equal((await call('POST', '/api/safety/contacts', p1, { name: 'Dup', phone: '+91 98450 00000' })).status, 409);
    assert.equal((await call('POST', '/api/safety/contacts', p1, { name: 'Bad', phone: 'abc' })).status, 400);
    assert.equal((await call('GET', '/api/safety/contacts', p2)).body.contacts.length, 0);
    assert.equal((await call('PATCH', `/api/safety/contacts/${c.body.contact.id}`, p2, { name: 'X' })).status, 404);
    assert.equal((await call('DELETE', `/api/safety/contacts/${c.body.contact.id}`, p2)).status, 404);
    assert.equal((await call('PATCH', `/api/safety/contacts/${c.body.contact.id}`, p1, { name: 'Amma' })).body.contact.name, 'Amma');

    const home = { kind: 'home', label: 'Home', address: 'Koramangala, Bengaluru', latitude: 12.93, longitude: 77.62 };
    assert.equal((await call('POST', '/api/places/saved', p1, home)).status, 201);
    const again = await call('POST', '/api/places/saved', p1, { ...home, address: 'HSR Layout, Bengaluru' });
    assert.equal(again.body.replaced, true); // one Home per user
    const mine = await call('GET', '/api/places/saved', p1);
    assert.deepEqual(mine.body.places.map((p) => p.address), ['HSR Layout, Bengaluru']);
    assert.equal((await call('GET', '/api/places/saved', p2)).body.places.length, 0);
    assert.equal((await call('GET', '/api/places/saved', d1)).status, 403);
    assert.equal((await call('DELETE', `/api/places/saved/${again.body.place.id}`, p2)).status, 404);

    const ov = await call('GET', '/api/me/overview', p1);
    assert.equal(ov.body.emergency_contacts, 1);
    assert.equal(ov.body.saved_places, 1);
  });

  test('support tickets: stored, private, status tracked through updates', async () => {
    const id = await matchedRide();
    assert.equal((await call('POST', '/api/support/tickets', p2, { category: 'fare', subject: 'Fare', description: 'Charged too much here', ride_id: id })).status, 404);
    const made = await call('POST', '/api/support/tickets', p1, { category: 'lost_item', subject: 'Left my bag', description: 'Black backpack on the back seat', ride_id: id });
    assert.equal(made.status, 201);
    const tid = made.body.ticket.id;
    assert.equal((await call('GET', `/api/support/tickets/${tid}`, p2)).status, 404);
    assert.equal((await call('GET', '/api/support/tickets', p2)).body.tickets.length, 0);

    await db.query(`update public.support_tickets set updated_at = now() - interval '5 minutes' where id = $1`, [tid]);
    assert.equal(await support.autoTriage(), 1);
    assert.equal((await call('GET', `/api/support/tickets/${tid}`, p1)).body.ticket.status, 'in_review');
    await support.staffUpdate(tid, 'resolved', 'Driver has your bag.');
    await call('POST', `/api/support/tickets/${tid}/messages`, p1, { message: 'When can I collect it?' });
    const detail = await call('GET', `/api/support/tickets/${tid}`, p1);
    assert.equal(detail.body.ticket.status, 'open'); // reply re-opens
    assert.deepEqual(detail.body.updates.map((u) => u.author), ['system', 'support', 'support', 'user', 'system']);
    await call('POST', `/api/support/tickets/${tid}/close`, p1);
    assert.equal((await call('POST', `/api/support/tickets/${tid}/messages`, p1, { message: 'hi' })).status, 409);
  });
});
