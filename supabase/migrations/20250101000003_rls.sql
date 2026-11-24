-- =====================================================================
-- Row Level Security.
-- The backend uses the service_role key (bypasses RLS) for every write and for
-- every read that includes another user's contact details. Browser clients
-- (anon / authenticated roles) get read-only access to their OWN rows, which is
-- what Supabase Realtime needs to push change notifications.
-- =====================================================================

alter table public.profiles         enable row level security;
alter table public.drivers          enable row level security;
alter table public.driver_locations enable row level security;
alter table public.rides            enable row level security;
alter table public.ride_offers      enable row level security;

-- Helper: the drivers.id belonging to the signed-in user (null for passengers).
create function public.current_driver_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.drivers where profile_id = auth.uid();
$$;
revoke all on function public.current_driver_id() from public, anon;
grant execute on function public.current_driver_id() to authenticated, service_role;

-- The backend connects as service_role. Newer Supabase projects no longer auto-grant table
-- privileges, so grant them explicitly (service_role bypasses RLS but still needs privileges).
grant usage on schema public to service_role;
grant all on public.profiles, public.drivers, public.driver_locations,
             public.rides, public.ride_offers to service_role;

-- Start from zero privileges for browser roles, then grant narrowly.
revoke all on public.profiles, public.drivers, public.driver_locations,
              public.rides, public.ride_offers from anon, authenticated;
grant select on public.profiles, public.drivers, public.driver_locations,
                public.rides, public.ride_offers to authenticated;
-- Users may edit only these profile columns (role/email/id are not editable).
grant update (full_name, phone) on public.profiles to authenticated;

create policy profiles_select_own on public.profiles
  for select to authenticated using (id = (select auth.uid()));
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy drivers_select_own on public.drivers
  for select to authenticated using (profile_id = (select auth.uid()));

create policy driver_locations_select_own on public.driver_locations
  for select to authenticated using (driver_id = (select public.current_driver_id()));

-- Passengers: their own rides.  Drivers: rides assigned to them.
create policy rides_select_participants on public.rides
  for select to authenticated
  using (passenger_id = (select auth.uid()) or driver_id = (select public.current_driver_id()));

-- Drivers: only offers addressed to them.
create policy ride_offers_select_own on public.ride_offers
  for select to authenticated using (driver_id = (select public.current_driver_id()));

-- No INSERT/UPDATE/DELETE policies on rides, offers, drivers or locations:
-- all of those writes are server-controlled.

-- =====================================================================
-- Realtime: broadcast ride and offer changes (RLS still filters per user).
-- =====================================================================
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'rides') then
      alter publication supabase_realtime add table public.rides;
    end if;
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'ride_offers') then
      alter publication supabase_realtime add table public.ride_offers;
    end if;
  end if;
end $$;
