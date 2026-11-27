-- =====================================================================
-- Show times in India Standard Time (IST, UTC+05:30).
-- Safe to run on a project that already has migrations 1-6 applied.
--
-- Nothing about how times are STORED changes: every timestamptz is an exact instant (kept internally in UTC),
-- so data stays correct everywhere. This only changes how times are DISPLAYED:
--   1. Your Supabase dashboard sessions (the `postgres` role: SQL Editor, Table Editor) print times in IST.
--      The app's own API connects with a different role and keeps using UTC, so nothing in the app changes.
--   2. The ride_log report shows plain IST clock times (columns ending in _ist), whoever opens it.
-- =====================================================================

-- 1. Dashboard display: new dashboard sessions show IST (reload the dashboard after running this).
alter role postgres set timezone to 'Asia/Kolkata';

-- 2. ride_log with IST clock times. (A view's column types can't be changed in place, so drop and recreate it.)
drop view if exists public.ride_log;
create view public.ride_log with (security_invoker = true) as
select
  (r.created_at   at time zone 'Asia/Kolkata')::timestamp(0) as booked_at_ist,
  r.status,
  p.full_name               as passenger_name,
  p.email                   as passenger_email,
  p.phone                   as passenger_phone,
  r.pickup_address,
  r.destination_address,
  r.distance_km,
  r.duration_minutes        as est_minutes,
  r.estimated_fare          as fare_inr,
  dp.full_name              as driver_name,
  dp.phone                  as driver_phone,
  d.vehicle_model,
  d.vehicle_registration,
  (r.accepted_at  at time zone 'Asia/Kolkata')::timestamp(0) as accepted_at_ist,
  (r.arrived_at   at time zone 'Asia/Kolkata')::timestamp(0) as arrived_at_ist,
  (r.started_at   at time zone 'Asia/Kolkata')::timestamp(0) as started_at_ist,
  (r.completed_at at time zone 'Asia/Kolkata')::timestamp(0) as completed_at_ist,
  (r.cancelled_at at time zone 'Asia/Kolkata')::timestamp(0) as cancelled_at_ist,
  r.cancelled_by,
  (select count(*) from public.ride_offers o where o.ride_id = r.id)     as offers_sent,
  (select count(*) from public.ride_messages m where m.ride_id = r.id)   as messages,
  r.id                      as ride_id,
  r.pickup_latitude, r.pickup_longitude, r.destination_latitude, r.destination_longitude
from public.rides r
join public.profiles p        on p.id = r.passenger_id
left join public.drivers d    on d.id = r.driver_id
left join public.profiles dp  on dp.id = d.profile_id
order by r.created_at desc;

comment on view public.ride_log is 'One row per booking. All *_ist columns are India Standard Time (UTC+05:30).';
revoke all on public.ride_log from public, anon, authenticated;
grant select on public.ride_log to service_role;
