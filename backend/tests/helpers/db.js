// Test database: a real PostgreSQL (PGlite, WASM) running the project's actual migrations,
// with a minimal stand-in for the parts of Supabase the migrations depend on.
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';

const MIGRATIONS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../supabase/migrations');

const SUPABASE_SHIM = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  grant usage on schema public to anon, authenticated, service_role;
  create schema auth;
  grant usage on schema auth to anon, authenticated, service_role;
  create table auth.users (
    id uuid primary key default gen_random_uuid(),
    email text,
    raw_user_meta_data jsonb
  );
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  grant execute on function auth.uid() to anon, authenticated, service_role;
  create publication supabase_realtime;
`;

export async function createTestDb() {
  const db = new PGlite();
  await db.exec(SUPABASE_SHIM);
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) await db.exec(readFileSync(path.join(MIGRATIONS, file), 'utf8'));
  return db;
}

let counter = 0;

/** Create a Supabase-Auth user; the real signup trigger creates the profile (+ driver row). */
export async function createUser(db, { role = 'passenger', name, phone, vehicle } = {}) {
  counter += 1;
  const meta = {
    role,
    full_name: name ?? `${role} ${counter}`,
    phone: phone ?? `+91 90000 ${String(counter).padStart(5, '0')}`,
    ...(role === 'driver' ? { vehicle_model: vehicle ?? 'Test Car', vehicle_registration: `KA00 T ${counter}` } : {}),
  };
  const { rows: [user] } = await db.query(
    'insert into auth.users (email, raw_user_meta_data) values ($1, $2::jsonb) returning id',
    [`u${counter}@test.local`, JSON.stringify(meta)],
  );
  if (role === 'passenger') return { id: user.id, role, phone: meta.phone, name: meta.full_name };
  const { rows: [driver] } = await db.query('select id from public.drivers where profile_id = $1', [user.id]);
  return { id: user.id, driverId: driver.id, role, phone: meta.phone, name: meta.full_name };
}

/** A Google-style signup: Supabase gives name/email metadata but NO role or phone. */
export async function createOAuthUser(db, name = 'Google Person') {
  counter += 1;
  const { rows: [user] } = await db.query(
    'insert into auth.users (email, raw_user_meta_data) values ($1, $2::jsonb) returning id',
    [`g${counter}@gmail.test`, JSON.stringify({ name, full_name: name, avatar_url: 'https://example.test/a.png' })],
  );
  return { id: user.id };
}

/** Put a driver online at a location. ageSeconds makes the location stale. */
export async function placeDriver(db, driverId, { lat, lng, online = true, ageSeconds = 0 }) {
  await db.query('update public.drivers set is_online = $2 where id = $1', [driverId, online]);
  if (lat !== undefined) {
    await db.query(
      `insert into public.driver_locations (driver_id, latitude, longitude, updated_at)
       values ($1, $2, $3, now() - make_interval(secs => $4))
       on conflict (driver_id) do update
         set latitude = excluded.latitude, longitude = excluded.longitude, updated_at = excluded.updated_at`,
      [driverId, lat, lng, ageSeconds],
    );
  }
}

export async function resetState(db) {
  await db.exec('truncate public.ride_offers, public.rides, public.driver_locations cascade');
  await db.exec('update public.drivers set is_online = false');
}

/** Make an offer's expiry lapse right now (simulates 30 s passing). */
export async function lapseOffer(db, offerId) {
  await db.query(`update public.ride_offers set expires_at = now() - interval '1 second' where id = $1`, [offerId]);
}

// Central Bengaluru pickup; 0.01 degrees of latitude is about 1.11 km.
export const PICKUP = { address: 'MG Road, Bengaluru', latitude: 12.9756, longitude: 77.6068 };
export const DESTINATION = { address: 'Indiranagar, Bengaluru', latitude: 12.9784, longitude: 77.6408 };
export const northKm = (km) => PICKUP.latitude + km / 111.19;
