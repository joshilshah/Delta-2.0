// DEVELOPMENT ONLY. Creates 1 demo passenger + 3 UNVERIFIED demo drivers via the Supabase Auth admin API,
// puts the drivers online around central Bengaluru, and (re)stamps their locations.
//
//   npm run seed:demo             create/refresh once
//   npm run seed:demo -- --watch  keep demo driver locations fresh every 30 s (locations go stale after 2 min)
//
// Phone numbers are obviously fake placeholders. Never run this against a production project.
import { createClient } from '@supabase/supabase-js';
import { loadConfig } from '../src/config/index.js';

const config = loadConfig();
if (config.nodeEnv === 'production') {
  console.error('Refusing to seed demo data when NODE_ENV=production.');
  process.exit(1);
}
const { url, secretKey } = config.supabase;
if (!url || !secretKey) {
  console.error('Set SUPABASE_URL and SUPABASE_SECRET_KEY in backend/.env first.');
  process.exit(1);
}

const PASSWORD = process.env.DEMO_PASSWORD || 'DemoPass#2025';
const db = createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });

const PASSENGER = { email: 'passenger@demo.ridehail.test', full_name: 'Demo Passenger', phone: '+91 00000 00000' };
const DRIVERS = [
  { email: 'driver1@demo.ridehail.test', full_name: 'Asha (demo driver)',  phone: '+91 00000 00001', vehicle_model: 'Maruti Swift Dzire (demo)', vehicle_registration: 'KA01 DEMO 0001', lat: 12.9738, lng: 77.6010 },
  { email: 'driver2@demo.ridehail.test', full_name: 'Ravi (demo driver)',  phone: '+91 00000 00002', vehicle_model: 'Hyundai Aura (demo)',       vehicle_registration: 'KA01 DEMO 0002', lat: 12.9610, lng: 77.5890 },
  { email: 'driver3@demo.ridehail.test', full_name: 'Meera (demo driver)', phone: '+91 00000 00003', vehicle_model: 'Toyota Etios (demo)',       vehicle_registration: 'KA01 DEMO 0003', lat: 12.9990, lng: 77.6400 },
];

async function ensureUser({ email, ...meta }, role) {
  const { data, error } = await db.auth.admin.createUser({
    email, password: PASSWORD, email_confirm: true,
    user_metadata: { role, full_name: meta.full_name, phone: meta.phone,
                     vehicle_model: meta.vehicle_model, vehicle_registration: meta.vehicle_registration },
  });
  if (!error) return data.user.id;
  // Already exists: look it up through the profiles table (the signup trigger created it).
  const { data: profile } = await db.from('profiles').select('id').eq('email', email).maybeSingle();
  if (profile) return profile.id;
  throw new Error(`Could not create ${email}: ${error.message}`);
}

async function refreshDrivers(driverIds) {
  for (const d of DRIVERS) {
    const driverId = driverIds[d.email];
    await db.from('drivers').update({ is_online: true }).eq('id', driverId);
    const { error } = await db.from('driver_locations').upsert({
      driver_id: driverId, latitude: d.lat, longitude: d.lng, updated_at: new Date().toISOString(),
    });
    if (error) throw error;
  }
}

// --watch mode: keep demo drivers that are STILL ONLINE from going stale. It only bumps the timestamp:
// it never moves a driver or flips them back online, so it can't fight a browser that shares a real location
// or a driver who switched themselves offline.
async function keepFresh(driverIds) {
  const { data: online, error } = await db.from('drivers').select('id').in('id', Object.values(driverIds)).eq('is_online', true);
  if (error) throw error;
  if (!online.length) return;
  const { error: e2 } = await db.from('driver_locations').update({ updated_at: new Date().toISOString() })
    .in('driver_id', online.map((d) => d.id));
  if (e2) throw e2;
}

async function main() {
  await ensureUser(PASSENGER, 'passenger');
  const driverIds = {};
  for (const d of DRIVERS) {
    const profileId = await ensureUser(d, 'driver');
    await db.from('profiles').update({ full_name: d.full_name }).eq('id', profileId); // keep demo names current
    const { data } = await db.from('drivers').select('id').eq('profile_id', profileId).single();
    driverIds[d.email] = data.id;
  }
  await refreshDrivers(driverIds);

  console.log('\nDemo accounts ready (all drivers are UNVERIFIED demo drivers):');
  console.log(`  passenger: ${PASSENGER.email}`);
  DRIVERS.forEach((d) => console.log(`  driver:    ${d.email}  (${d.vehicle_model})`));
  console.log(`  password:  ${PASSWORD}`);

  if (process.argv.includes('--watch')) {
    console.log('\nWatching: keeping online demo drivers fresh every 30 s (timestamp only). Ctrl+C to stop.');
    setInterval(() => keepFresh(driverIds).catch((e) => console.error(e.message)), 30_000);
  }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
