// DEVELOPMENT ONLY. End-to-end check of the Phase 2 ride flow against the running backend (localhost:3000)
// using the seeded demo accounts:  node --env-file=.env scripts/e2e-demo.js
import { createClient } from '@supabase/supabase-js';

const API = process.env.E2E_API ?? 'http://localhost:3000/api';
const PASSWORD = process.env.DEMO_PASSWORD || 'DemoPass#2025';
const url = process.env.SUPABASE_URL;
const admin = createClient(url, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });

async function login(email) {
  const c = createClient(url, process.env.SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
  const { data, error } = await c.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`${email}: ${error.message}`);
  return data.session.access_token;
}
const call = async (token, method, path, body) => {
  const res = await fetch(API + path, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${json.error?.code}: ${json.error?.message}`);
  return json;
};
const ok = (cond, msg) => { if (!cond) throw new Error(`FAILED: ${msg}`); console.log(`  ok  ${msg}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const P = await login('passenger@demo.ridehail.test');
const D = await login('driver1@demo.ridehail.test');
const at = { latitude: 12.9738, longitude: 77.601 };

// Clean slate: cancel any ride the demo passenger still has open.
const open = (await call(P, 'GET', '/rides/active')).ride;
if (open) await call(P, 'POST', `/rides/${open.id}/cancel`).catch(() => {});
const dActive = (await call(D, 'GET', '/rides/active')).ride;
if (dActive?.status === 'accepted') await call(D, 'POST', `/rides/${dActive.id}/cancel`);
if (dActive?.status === 'in_progress') await call(D, 'POST', `/rides/${dActive.id}/complete`);

await call(D, 'PATCH', '/drivers/availability', { is_online: true });
await call(D, 'POST', '/drivers/location', at);

console.log('Booking');
const booked = await call(P, 'POST', '/rides', {
  pickup: { address: 'MG Road Metro, Bengaluru (E2E test)', latitude: at.latitude + 0.002, longitude: at.longitude + 0.002 },
  destination: { address: 'Indiranagar 100 Ft Rd, Bengaluru (E2E test)', latitude: 12.9784, longitude: 77.6408 },
  idempotencyKey: `e2e-${Date.now()}`,
});
const id = booked.ride.id;
ok(['searching', 'requested'].includes(booked.ride.status), `ride created (${booked.ride.status})`);

let offer;
for (let i = 0; i < 15 && !offer; i += 1) { offer = (await call(D, 'GET', '/drivers/offers')).offers.find((o) => o.ride_id === id); if (!offer) await sleep(1000); }
ok(offer, 'driver1 received the offer');
await call(D, 'POST', `/offers/${offer.id}/accept`);
ok((await call(P, 'GET', `/rides/${id}`)).ride.status === 'accepted', 'passenger sees "accepted"');

const { data: log } = await admin.from('ride_log').select('*').eq('ride_id', id).single();
ok(log.passenger_email === 'passenger@demo.ridehail.test' && log.driver_name?.startsWith('Asha') && log.pickup_address.startsWith('MG Road'),
  `ride_log row: ${log.passenger_name} | ${log.pickup_address} -> ${log.destination_address} | ${log.driver_name} | ${log.status}`);

await call(P, 'POST', `/rides/${id}/messages`, { body: 'Hi, I am at the metro gate' });
await call(D, 'POST', `/rides/${id}/messages`, { body: 'Coming in 2 minutes' });
ok((await call(D, 'GET', `/rides/${id}/messages`)).messages.length === 2, 'chat both ways');

await call(D, 'POST', '/drivers/location', { latitude: at.latitude + 0.001, longitude: at.longitude + 0.001 });
const live = (await call(P, 'GET', `/rides/${id}`)).ride;
ok(live.driver?.location && live.eta?.target === 'pickup', `passenger sees driver location + ETA ~${live.eta?.minutes} min`);

const arrived = await call(D, 'POST', `/rides/${id}/arrived`);
ok(arrived.ride.arrived_at, 'driver marked arrived');
const msgs = (await call(P, 'GET', `/rides/${id}/messages`)).messages;
const sys = msgs.find((m) => m.sender_role === 'system');
ok(sys, `automated message to passenger: "${sys?.body}"`);

await call(D, 'POST', `/rides/${id}/start`);
await call(D, 'POST', `/rides/${id}/complete`);
const { data: done } = await admin.from('ride_log').select('status, arrived_at_ist, completed_at_ist, messages').eq('ride_id', id).single();
ok(done.status === 'completed' && done.arrived_at_ist && Number(done.messages) === 3,
  `ride_log shows completed (IST ${done.completed_at_ist}) with arrival time and 3 messages`);
console.log('\nAll good.');
