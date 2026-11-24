-- =====================================================================
-- OPTIONAL development seed. DO NOT run against production.
--
-- Demo users must be created through Supabase Auth (passwords are hashed there),
-- so the primary seed is the script:   cd backend && npm run seed:demo
-- That script creates 1 demo passenger + 3 unverified demo drivers and sets their locations.
--
-- This SQL file only re-stamps demo driver locations around central Bengaluru,
-- useful from the SQL editor when the locations have gone stale (they expire after 2 minutes).
-- It does nothing if the demo drivers do not exist yet.
-- =====================================================================
insert into public.driver_locations (driver_id, latitude, longitude, updated_at)
select d.id, v.lat, v.lng, now()
from public.drivers d
join public.profiles p on p.id = d.profile_id
join (values
  ('driver1@demo.ridehail.test', 12.9738, 77.6010),
  ('driver2@demo.ridehail.test', 12.9610, 77.5890),
  ('driver3@demo.ridehail.test', 12.9990, 77.6400)
) as v(email, lat, lng) on v.email = p.email
on conflict (driver_id) do update
  set latitude = excluded.latitude, longitude = excluded.longitude, updated_at = now();

update public.drivers d set is_online = true
from public.profiles p
where p.id = d.profile_id and p.email like 'driver_@demo.ridehail.test';
