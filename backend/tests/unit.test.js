import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { calculateFare } from '../src/services/fareService.js';
import { createRouteService } from '../src/services/routeService.js';
import { loadConfig } from '../src/config/index.js';
import { haversineKm } from '../src/matching/geo.js';
import { rankDrivers, registerStrategy } from '../src/matching/ranker.js';
import {
  TRANSITIONS, canTransition, assertTransition, canCancel, allowedActions,
} from '../src/services/rideStateMachine.js';
import { AppError } from '../src/errors.js';

const pricing = loadConfig({}).pricing;

describe('fare calculation', () => {
  test('matches the spec example: 8 km, 20 min => ₹176', () => {
    const fare = calculateFare({ distanceKm: 8, durationMinutes: 20 }, pricing);
    assert.equal(fare.estimated_fare, 176);
    assert.deepEqual(fare.breakdown, {
      base_fare: 40, distance_charge: 96, time_charge: 40, per_km_rate: 12, per_minute_rate: 2,
    });
    assert.equal(fare.currency, 'INR');
  });

  test('defaults are base 40, 12/km, 2/min', () => {
    assert.deepEqual(pricing, { currency: 'INR', baseFare: 40, perKmRate: 12, perMinuteRate: 2 });
  });

  test('rates are configurable through the environment', () => {
    const p = loadConfig({ BASE_FARE: '50', PER_KM_RATE: '10', PER_MINUTE_RATE: '1' }).pricing;
    assert.equal(calculateFare({ distanceKm: 5, durationMinutes: 10 }, p).estimated_fare, 110);
  });

  test('rounds duration up to whole minutes and fare to the nearest rupee', () => {
    const fare = calculateFare({ distanceKm: 3.456, durationMinutes: 10.2 }, pricing);
    assert.equal(fare.duration_minutes, 11);
    assert.equal(fare.distance_km, 3.46);
    assert.equal(fare.estimated_fare, Math.round(40 + 3.46 * 12 + 11 * 2));
  });

  test('a zero-length route still costs the base fare', () => {
    assert.equal(calculateFare({ distanceKm: 0, durationMinutes: 0 }, pricing).estimated_fare, 40);
  });

  test('rejects invalid route values', () => {
    for (const bad of [{ distanceKm: -1, durationMinutes: 5 }, { distanceKm: NaN, durationMinutes: 5 },
      { distanceKm: 1, durationMinutes: Infinity }]) {
      assert.throws(() => calculateFare(bad, pricing), (e) => e instanceof AppError && e.status === 422);
    }
  });
});

describe('route service (Google Routes API)', () => {
  const okResponse = (body, status = 200) => async () => new Response(JSON.stringify(body), { status });
  const coords = { latitude: 12.97, longitude: 77.59 };

  test('parses distance and duration from the Routes API response', async () => {
    const svc = createRouteService({ apiKey: 'k', fetchImpl: okResponse({ routes: [{ distanceMeters: 8000, duration: '1200s' }] }) });
    assert.deepEqual(await svc.getRoute(coords, coords), { distanceKm: 8, durationMinutes: 20, source: 'google' });
  });

  test('sends the key and field mask as headers (server side)', async () => {
    let seen;
    const svc = createRouteService({
      apiKey: 'secret', fetchImpl: async (url, init) => { seen = { url, init }; return okResponse({ routes: [{ distanceMeters: 1, duration: '60s' }] })(); },
    });
    await svc.getRoute(coords, coords);
    assert.match(seen.url, /routes\.googleapis\.com/);
    assert.equal(seen.init.headers['X-Goog-Api-Key'], 'secret');
    assert.equal(seen.init.headers['X-Goog-FieldMask'], 'routes.distanceMeters,routes.duration');
  });

  test('no route => 422 NO_ROUTE', async () => {
    const svc = createRouteService({ apiKey: 'k', fetchImpl: okResponse({}) });
    await assert.rejects(svc.getRoute(coords, coords), (e) => e.status === 422 && e.code === 'NO_ROUTE');
  });

  test('API / network failure => 502 ROUTING_UNAVAILABLE', async () => {
    const down = createRouteService({ apiKey: 'k', fetchImpl: async () => { throw new Error('offline'); } });
    await assert.rejects(down.getRoute(coords, coords), (e) => e.status === 502 && e.code === 'ROUTING_UNAVAILABLE');
    const denied = createRouteService({ apiKey: 'k', fetchImpl: okResponse({ error: 'denied' }, 403) });
    await assert.rejects(denied.getRoute(coords, coords), (e) => e.status === 502);
  });

  test('missing key => 503 ROUTING_NOT_CONFIGURED', async () => {
    const svc = createRouteService({ apiKey: '' });
    await assert.rejects(svc.getRoute(coords, coords), (e) => e.status === 503 && e.code === 'ROUTING_NOT_CONFIGURED');
  });
});

describe('haversine and driver ranking', () => {
  test('known distance: ~111.2 km per degree of latitude', () => {
    assert.ok(Math.abs(haversineKm(0, 0, 1, 0) - 111.195) < 0.05);
    assert.equal(haversineKm(12.97, 77.59, 12.97, 77.59), 0);
  });

  test('sorts by proximity, with deterministic tie-breaks', () => {
    const ranked = rankDrivers([
      { driver_id: 'b', distance_km: 2, location_updated_at: '2025-01-01T00:00:00Z' },
      { driver_id: 'a', distance_km: 2, location_updated_at: '2025-01-01T00:00:00Z' },
      { driver_id: 'c', distance_km: 1, location_updated_at: '2025-01-01T00:00:00Z' },
      { driver_id: 'd', distance_km: 2, location_updated_at: '2025-01-01T00:00:30Z' },
    ]);
    assert.deepEqual(ranked.map((d) => d.driver_id), ['c', 'd', 'a', 'b']);
  });

  test('does not mutate its input and supports pluggable strategies (future ETA ranking)', () => {
    const input = [{ driver_id: 'x', distance_km: 1, eta: 9 }, { driver_id: 'y', distance_km: 2, eta: 1 }];
    registerStrategy('eta', (a, b) => a.eta - b.eta);
    assert.deepEqual(rankDrivers(input, { strategy: 'eta' }).map((d) => d.driver_id), ['y', 'x']);
    assert.equal(input[0].driver_id, 'x');
    assert.throws(() => rankDrivers(input, { strategy: 'nope' }));
  });
});

describe('ride state machine', () => {
  test('the documented flow is allowed', () => {
    for (const [from, to] of [['requested', 'searching'], ['searching', 'accepted'], ['accepted', 'in_progress'],
      ['in_progress', 'completed'], ['searching', 'unmatched'], ['requested', 'cancelled'],
      ['searching', 'cancelled'], ['accepted', 'cancelled']]) {
      assert.ok(canTransition(from, to), `${from} -> ${to}`);
    }
  });

  test('terminal states can never return to an active state', () => {
    for (const terminal of ['completed', 'cancelled', 'unmatched']) {
      assert.deepEqual(TRANSITIONS[terminal], []);
      for (const to of Object.keys(TRANSITIONS)) assert.equal(canTransition(terminal, to), false);
    }
  });

  test('skipping steps is rejected', () => {
    for (const [from, to] of [['requested', 'accepted'], ['requested', 'completed'], ['accepted', 'completed'],
      ['searching', 'in_progress'], ['in_progress', 'cancelled'], ['in_progress', 'accepted']]) {
      assert.equal(canTransition(from, to), false, `${from} -> ${to}`);
      assert.throws(() => assertTransition(from, to), (e) => e.status === 409);
    }
  });

  test('cancellation rules by role', () => {
    assert.ok(canCancel('passenger', 'requested') && canCancel('passenger', 'searching') && canCancel('passenger', 'accepted'));
    assert.equal(canCancel('passenger', 'in_progress'), false);
    assert.equal(canCancel('driver', 'accepted'), true);
    assert.equal(canCancel('driver', 'searching'), false);
    assert.equal(canCancel('driver', 'in_progress'), false);
  });

  test('allowed actions per role and status', () => {
    assert.deepEqual(allowedActions('driver', 'accepted'), ['cancel', 'start']);
    assert.deepEqual(allowedActions('driver', 'in_progress'), ['complete']);
    assert.deepEqual(allowedActions('passenger', 'searching'), ['cancel']);
    assert.deepEqual(allowedActions('passenger', 'completed'), []);
  });
});
