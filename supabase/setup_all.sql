-- =====================================================================
-- DELTA: complete database setup in ONE file (for a brand-new Supabase project).
-- Generated from supabase/migrations/ (all files, in order). Edit those files, not this one.
-- How: Supabase -> SQL Editor -> New query -> paste ALL of this -> Run.
-- =====================================================================

-- >>>>>>>>>>>>>>>>>>>> 20250101000001_schema.sql >>>>>>>>>>>>>>>>>>>>

-- =====================================================================
-- Phase 1 schema: profiles, drivers, driver_locations, rides, ride_offers
-- Identity comes from Supabase Auth (auth.users). No passwords are stored here.
-- =====================================================================

-- ---------- profiles ----------
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  full_name   text        not null check (char_length(full_name) between 1 and 100),
  email       text        not null,
  phone       text        not null check (char_length(phone) between 6 and 20),
  role        text        not null check (role in ('passenger', 'driver')),
  created_at  timestamptz not null default now()
);

-- ---------- drivers ----------
create table public.drivers (
  id                    uuid primary key default gen_random_uuid(),
  profile_id            uuid        not null unique references public.profiles (id) on delete cascade,
  vehicle_model         text        not null check (char_length(vehicle_model) between 1 and 80),
  vehicle_registration  text        not null check (char_length(vehicle_registration) between 1 and 20),
  is_online             boolean     not null default false,
  -- Phase 1 has NO driver verification. This is always false and the UI labels drivers "unverified demo".
  is_verified           boolean     not null default false,
  created_at            timestamptz not null default now()
);
create index drivers_online_idx on public.drivers (is_online) where is_online;

-- ---------- driver_locations (latest known position only) ----------
create table public.driver_locations (
  driver_id   uuid primary key references public.drivers (id) on delete cascade,
  latitude    double precision not null check (latitude  between -90  and 90),
  longitude   double precision not null check (longitude between -180 and 180),
  updated_at  timestamptz      not null default now()
);
create index driver_locations_updated_idx on public.driver_locations (updated_at);

-- ---------- rides ----------
create table public.rides (
  id                     uuid primary key default gen_random_uuid(),
  passenger_id           uuid not null references public.profiles (id),
  driver_id              uuid references public.drivers (id),
  request_key            text,  -- client idempotency key (one per booking attempt)

  pickup_address         text             not null check (char_length(pickup_address) between 1 and 300),
  pickup_latitude        double precision not null check (pickup_latitude  between -90  and 90),
  pickup_longitude       double precision not null check (pickup_longitude between -180 and 180),
  destination_address    text             not null check (char_length(destination_address) between 1 and 300),
  destination_latitude   double precision not null check (destination_latitude  between -90  and 90),
  destination_longitude  double precision not null check (destination_longitude between -180 and 180),

  distance_km            numeric(8, 2)  not null check (distance_km >= 0),
  duration_minutes       numeric(8, 2)  not null check (duration_minutes >= 0),
  estimated_fare         numeric(10, 2) not null check (estimated_fare >= 0),
  fare_breakdown         jsonb,         -- rates used, kept so old rides stay explainable

  status        text not null default 'requested'
                check (status in ('requested', 'searching', 'accepted', 'in_progress',
                                  'completed', 'cancelled', 'unmatched')),
  cancelled_by  text check (cancelled_by in ('passenger', 'driver', 'system')),

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  accepted_at   timestamptz,
  started_at    timestamptz,
  completed_at  timestamptz,
  cancelled_at  timestamptz,

  constraint rides_driver_required
    check (status not in ('accepted', 'in_progress', 'completed') or driver_id is not null),
  constraint rides_request_key_unique unique (passenger_id, request_key)
);

-- A driver can never hold two active rides (the core double-booking guard).
create unique index rides_one_active_per_driver
  on public.rides (driver_id) where status in ('accepted', 'in_progress');
-- A passenger can have only one open ride (blocks duplicate creation from repeated clicks).
create unique index rides_one_open_per_passenger
  on public.rides (passenger_id) where status in ('requested', 'searching', 'accepted', 'in_progress');
create index rides_passenger_created_idx on public.rides (passenger_id, created_at desc);
create index rides_driver_idx            on public.rides (driver_id) where driver_id is not null;
create index rides_status_updated_idx    on public.rides (status, updated_at);

-- ---------- ride_offers ----------
create table public.ride_offers (
  id            uuid primary key default gen_random_uuid(),
  ride_id       uuid not null references public.rides (id) on delete cascade,
  driver_id     uuid not null references public.drivers (id) on delete cascade,
  status        text not null default 'pending'
                check (status in ('pending', 'accepted', 'rejected', 'expired', 'cancelled')),
  offered_at    timestamptz not null default now(),
  expires_at    timestamptz not null,
  responded_at  timestamptz
);
-- Never offer the same ride to the same driver twice.
create unique index ride_offers_ride_driver_key on public.ride_offers (ride_id, driver_id);
-- Sequential dispatch: only one pending offer per ride...
create unique index ride_offers_one_pending_per_ride   on public.ride_offers (ride_id)   where status = 'pending';
-- ...and a driver only ever sees one pending offer at a time.
create unique index ride_offers_one_pending_per_driver on public.ride_offers (driver_id) where status = 'pending';
create index ride_offers_driver_status_idx on public.ride_offers (driver_id, status, expires_at);
create index ride_offers_pending_expiry_idx on public.ride_offers (expires_at) where status = 'pending';

-- =====================================================================
-- Triggers
-- =====================================================================

-- Keep updated_at fresh and enforce the ride state machine at the database level.
create function public.rides_before_update() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();

  if new.passenger_id <> old.passenger_id or new.estimated_fare <> old.estimated_fare then
    raise exception 'RIDE_IMMUTABLE_FIELD';
  end if;

  if new.status <> old.status and not (
       (old.status = 'requested'   and new.status in ('searching', 'cancelled'))
    or (old.status = 'searching'   and new.status in ('accepted', 'unmatched', 'cancelled'))
    or (old.status = 'accepted'    and new.status in ('in_progress', 'cancelled'))
    or (old.status = 'in_progress' and new.status = 'completed')
  ) then
    raise exception 'INVALID_TRANSITION';
  end if;

  return new;
end $$;

create trigger rides_before_update
  before update on public.rides
  for each row execute function public.rides_before_update();

-- Account role is chosen at signup and can never change afterwards.
create function public.profiles_prevent_role_change() returns trigger
language plpgsql as $$
begin
  if new.role <> old.role then
    raise exception 'ROLE_IMMUTABLE';
  end if;
  if new.id <> old.id then
    raise exception 'ID_IMMUTABLE';
  end if;
  return new;
end $$;

create trigger profiles_prevent_role_change
  before update on public.profiles
  for each row execute function public.profiles_prevent_role_change();

-- Create profile (+ driver row) automatically when a Supabase Auth user is created.
-- Values come from the metadata passed to supabase.auth.signUp({ options: { data } }).
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  meta   jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_role text  := coalesce(meta ->> 'role', 'passenger');
begin
  if v_role not in ('passenger', 'driver') then
    v_role := 'passenger';
  end if;

  insert into public.profiles (id, full_name, email, phone, role)
  values (
    new.id,
    left(coalesce(nullif(trim(meta ->> 'full_name'), ''), 'Unnamed user'), 100),
    new.email,
    left(coalesce(nullif(trim(meta ->> 'phone'), ''), '0000000'), 20),
    v_role
  );

  if v_role = 'driver' then
    insert into public.drivers (profile_id, vehicle_model, vehicle_registration)
    values (
      new.id,
      left(coalesce(nullif(trim(meta ->> 'vehicle_model'), ''), 'Unknown'), 80),
      left(coalesce(nullif(trim(meta ->> 'vehicle_registration'), ''), 'UNKNOWN'), 20)
    );
  end if;

  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- >>>>>>>>>>>>>>>>>>>> 20250101000002_dispatch_functions.sql >>>>>>>>>>>>>>>>>>>>

-- =====================================================================
-- Server-controlled dispatch operations. Every function here is atomic
-- (one transaction) and executable ONLY by the service_role (the backend).
--
-- Lock order everywhere: ride -> offer -> driver (prevents deadlocks).
-- Errors are raised with a stable machine-readable message (e.g. OFFER_EXPIRED)
-- which the backend maps to HTTP responses.
-- =====================================================================

-- Great-circle distance in km (Haversine). Straight-line, NOT road distance.
create function public.haversine_km(lat1 double precision, lon1 double precision,
                                    lat2 double precision, lon2 double precision)
returns double precision
language sql immutable parallel safe as $$
  select 2 * 6371.0088 * asin(sqrt(least(1.0,
    power(sin(radians(lat2 - lat1) / 2), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lon2 - lon1) / 2), 2)
  )));
$$;

-- ---------------------------------------------------------------------
-- Eligible drivers within a radius, nearest first.
-- Excludes: offline, stale/missing location, active ride, live pending offer, explicit exclusions.
-- ---------------------------------------------------------------------
create function public.find_eligible_drivers(
  p_lat double precision, p_lng double precision, p_radius_km double precision,
  p_stale_seconds integer, p_exclude uuid[] default '{}'
)
returns table (driver_id uuid, profile_id uuid, distance_km double precision,
               latitude double precision, longitude double precision, location_updated_at timestamptz)
language sql stable as $$
  select d.id, d.profile_id, h.dist, l.latitude, l.longitude, l.updated_at
  from public.drivers d
  join public.driver_locations l on l.driver_id = d.id
  cross join lateral (select public.haversine_km(p_lat, p_lng, l.latitude, l.longitude) as dist) h
  where d.is_online
    and l.updated_at > now() - make_interval(secs => p_stale_seconds)
    and h.dist <= p_radius_km
    and not (d.id = any (coalesce(p_exclude, '{}')))
    and not exists (select 1 from public.rides r
                    where r.driver_id = d.id and r.status in ('accepted', 'in_progress'))
    and not exists (select 1 from public.ride_offers o
                    where o.driver_id = d.id and o.status = 'pending' and o.expires_at > now())
  order by h.dist, d.id;
$$;

-- ---------------------------------------------------------------------
-- Create a pending offer. Returns {ok:true, offer} or {ok:false, reason}.
-- ---------------------------------------------------------------------
create function public.create_offer(p_ride_id uuid, p_driver_id uuid, p_ttl_seconds integer)
returns jsonb
language plpgsql as $$
declare
  v_ride  public.rides;
  v_offer public.ride_offers;
begin
  select * into v_ride from public.rides where id = p_ride_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'RIDE_NOT_FOUND');
  end if;
  if v_ride.status not in ('requested', 'searching') then
    return jsonb_build_object('ok', false, 'reason', 'RIDE_NOT_SEARCHING');
  end if;

  -- Retire lapsed offers so they cannot block the unique "one pending" indexes.
  update public.ride_offers set status = 'expired'
   where status = 'pending' and expires_at <= now()
     and (ride_id = p_ride_id or driver_id = p_driver_id);

  if exists (select 1 from public.ride_offers where ride_id = p_ride_id and status = 'pending') then
    return jsonb_build_object('ok', false, 'reason', 'RIDE_HAS_PENDING');
  end if;
  if exists (select 1 from public.ride_offers where ride_id = p_ride_id and driver_id = p_driver_id) then
    return jsonb_build_object('ok', false, 'reason', 'ALREADY_OFFERED');
  end if;

  perform 1 from public.drivers where id = p_driver_id and is_online for update;
  if not found
     or exists (select 1 from public.rides where driver_id = p_driver_id
                and status in ('accepted', 'in_progress')) then
    return jsonb_build_object('ok', false, 'reason', 'DRIVER_UNAVAILABLE');
  end if;

  begin
    insert into public.ride_offers (ride_id, driver_id, expires_at)
    values (p_ride_id, p_driver_id, now() + make_interval(secs => p_ttl_seconds))
    returning * into v_offer;
  exception when unique_violation then
    -- driver got another pending offer from a concurrent dispatch
    return jsonb_build_object('ok', false, 'reason', 'DRIVER_UNAVAILABLE');
  end;

  if v_ride.status = 'requested' then
    update public.rides set status = 'searching' where id = p_ride_id;
  end if;

  return jsonb_build_object('ok', true, 'offer', to_jsonb(v_offer));
end $$;

-- ---------------------------------------------------------------------
-- Accept an offer: validates everything and assigns driver + ride atomically.
-- Idempotent for the same driver re-sending an already successful accept.
-- ---------------------------------------------------------------------
create function public.accept_offer(p_offer_id uuid, p_driver_id uuid)
returns jsonb
language plpgsql as $$
declare
  v_ride_id uuid;
  v_ride    public.rides;
  v_offer   public.ride_offers;
begin
  select ride_id into v_ride_id from public.ride_offers where id = p_offer_id;
  if not found then raise exception 'OFFER_NOT_FOUND'; end if;

  select * into v_ride  from public.rides        where id = v_ride_id for update;
  select * into v_offer from public.ride_offers  where id = p_offer_id for update;

  if v_offer.driver_id <> p_driver_id then
    raise exception 'OFFER_NOT_FOUND';              -- do not reveal other drivers' offers
  end if;

  if v_offer.status = 'accepted' and v_ride.driver_id = p_driver_id then
    return to_jsonb(v_ride);                         -- idempotent retry
  end if;
  if v_offer.status <> 'pending' then
    raise exception 'OFFER_NOT_PENDING';
  end if;
  if v_offer.expires_at <= now() then
    raise exception 'OFFER_EXPIRED';
  end if;
  if v_ride.status <> 'searching' then
    raise exception 'RIDE_NOT_AVAILABLE';
  end if;

  perform 1 from public.drivers where id = p_driver_id and is_online for update;
  if not found then raise exception 'DRIVER_OFFLINE'; end if;
  if exists (select 1 from public.rides where driver_id = p_driver_id
             and status in ('accepted', 'in_progress')) then
    raise exception 'DRIVER_BUSY';
  end if;

  update public.ride_offers set status = 'accepted', responded_at = now() where id = p_offer_id;
  update public.rides
     set status = 'accepted', driver_id = p_driver_id, accepted_at = now()
   where id = v_ride_id
   returning * into v_ride;

  return to_jsonb(v_ride);
end $$;

-- ---------------------------------------------------------------------
-- Reject an offer. Returns {ride_id, status}. Idempotent.
-- ---------------------------------------------------------------------
create function public.reject_offer(p_offer_id uuid, p_driver_id uuid)
returns jsonb
language plpgsql as $$
declare
  v_ride_id uuid;
  v_offer   public.ride_offers;
begin
  select ride_id into v_ride_id from public.ride_offers where id = p_offer_id;
  if not found then raise exception 'OFFER_NOT_FOUND'; end if;

  perform 1 from public.rides where id = v_ride_id for update;
  select * into v_offer from public.ride_offers where id = p_offer_id for update;

  if v_offer.driver_id <> p_driver_id then raise exception 'OFFER_NOT_FOUND'; end if;

  if v_offer.status = 'rejected' then
    return jsonb_build_object('ride_id', v_ride_id, 'status', 'rejected', 'changed', false);
  end if;
  if v_offer.status <> 'pending' then raise exception 'OFFER_NOT_PENDING'; end if;

  update public.ride_offers set status = 'rejected', responded_at = now() where id = p_offer_id;
  return jsonb_build_object('ride_id', v_ride_id, 'status', 'rejected', 'changed', true);
end $$;

-- ---------------------------------------------------------------------
-- Expire lapsed offers (called by the backend worker). Returns what it expired.
-- ---------------------------------------------------------------------
create function public.expire_stale_offers()
returns table (offer_id uuid, ride_id uuid)
language sql as $$
  update public.ride_offers
     set status = 'expired'
   where status = 'pending' and expires_at <= now()
  returning id, ride_id;
$$;

-- ---------------------------------------------------------------------
-- Driver availability. Going offline withdraws pending offers; refused during an active ride.
-- Returns {is_online, affected_ride_ids}.
-- ---------------------------------------------------------------------
create function public.set_driver_online(p_driver_id uuid, p_online boolean)
returns jsonb
language plpgsql as $$
declare
  v_ids uuid[] := '{}';
begin
  perform 1 from public.drivers where id = p_driver_id for update;
  if not found then raise exception 'DRIVER_NOT_FOUND'; end if;

  if not p_online then
    if exists (select 1 from public.rides where driver_id = p_driver_id
               and status in ('accepted', 'in_progress')) then
      raise exception 'DRIVER_HAS_ACTIVE_RIDE';
    end if;
    with c as (
      update public.ride_offers set status = 'cancelled', responded_at = now()
       where driver_id = p_driver_id and status = 'pending'
      returning ride_id)
    select coalesce(array_agg(ride_id), '{}') into v_ids from c;
  end if;

  update public.drivers set is_online = p_online where id = p_driver_id;
  return jsonb_build_object('is_online', p_online, 'affected_ride_ids', to_jsonb(v_ids));
end $$;

-- ---------------------------------------------------------------------
-- Give up on a ride: searching -> unmatched (only if nothing is pending).
-- ---------------------------------------------------------------------
create function public.mark_ride_unmatched(p_ride_id uuid)
returns jsonb
language plpgsql as $$
declare
  v_ride public.rides;
begin
  select * into v_ride from public.rides where id = p_ride_id for update;
  if not found then raise exception 'RIDE_NOT_FOUND'; end if;

  if v_ride.status in ('requested', 'searching')
     and not exists (select 1 from public.ride_offers
                     where ride_id = p_ride_id and status = 'pending' and expires_at > now()) then
    if v_ride.status = 'requested' then
      update public.rides set status = 'searching' where id = p_ride_id;
    end if;
    update public.ride_offers set status = 'expired'
     where ride_id = p_ride_id and status = 'pending';
    update public.rides set status = 'unmatched' where id = p_ride_id returning * into v_ride;
  end if;
  return to_jsonb(v_ride);
end $$;

-- ---------------------------------------------------------------------
-- Ride lifecycle transitions. p_driver_id must be the assigned driver.
-- Drivers are "released" automatically: availability is derived from ride status.
-- ---------------------------------------------------------------------
create function public.start_ride(p_ride_id uuid, p_driver_id uuid)
returns jsonb
language plpgsql as $$
declare v_ride public.rides;
begin
  select * into v_ride from public.rides where id = p_ride_id for update;
  if not found then raise exception 'RIDE_NOT_FOUND'; end if;
  if v_ride.driver_id is distinct from p_driver_id then raise exception 'NOT_ASSIGNED_DRIVER'; end if;
  if v_ride.status <> 'accepted' then raise exception 'INVALID_TRANSITION'; end if;
  update public.rides set status = 'in_progress', started_at = now()
   where id = p_ride_id returning * into v_ride;
  return to_jsonb(v_ride);
end $$;

create function public.complete_ride(p_ride_id uuid, p_driver_id uuid)
returns jsonb
language plpgsql as $$
declare v_ride public.rides;
begin
  select * into v_ride from public.rides where id = p_ride_id for update;
  if not found then raise exception 'RIDE_NOT_FOUND'; end if;
  if v_ride.driver_id is distinct from p_driver_id then raise exception 'NOT_ASSIGNED_DRIVER'; end if;
  if v_ride.status <> 'in_progress' then raise exception 'INVALID_TRANSITION'; end if;
  update public.rides set status = 'completed', completed_at = now()
   where id = p_ride_id returning * into v_ride;
  return to_jsonb(v_ride);
end $$;

-- p_actor_role = 'passenger' (p_actor_id = profile id) or 'driver' (p_actor_id = drivers.id).
-- Passenger: requested / searching / accepted.  Driver: accepted only (before the trip starts).
create function public.cancel_ride(p_ride_id uuid, p_actor_role text, p_actor_id uuid)
returns jsonb
language plpgsql as $$
declare v_ride public.rides;
begin
  select * into v_ride from public.rides where id = p_ride_id for update;
  if not found then raise exception 'RIDE_NOT_FOUND'; end if;

  if p_actor_role = 'passenger' then
    if v_ride.passenger_id <> p_actor_id then raise exception 'NOT_PARTICIPANT'; end if;
  elsif p_actor_role = 'driver' then
    if v_ride.driver_id is distinct from p_actor_id then raise exception 'NOT_PARTICIPANT'; end if;
  else
    raise exception 'NOT_PARTICIPANT';
  end if;

  if v_ride.status = 'cancelled' and v_ride.cancelled_by = p_actor_role then
    return to_jsonb(v_ride);                         -- idempotent
  end if;
  if v_ride.status not in ('requested', 'searching', 'accepted')
     or (p_actor_role = 'driver' and v_ride.status <> 'accepted') then
    raise exception 'INVALID_TRANSITION';
  end if;

  update public.ride_offers set status = 'cancelled', responded_at = now()
   where ride_id = p_ride_id and status = 'pending';
  update public.rides
     set status = 'cancelled', cancelled_by = p_actor_role, cancelled_at = now()
   where id = p_ride_id returning * into v_ride;
  return to_jsonb(v_ride);
end $$;

-- =====================================================================
-- Lock these functions down: service_role (backend) only.
-- =====================================================================
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('find_eligible_drivers', 'create_offer', 'accept_offer', 'reject_offer',
                        'expire_stale_offers', 'set_driver_online', 'mark_ride_unmatched',
                        'start_ride', 'complete_ride', 'cancel_ride')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end $$;


-- >>>>>>>>>>>>>>>>>>>> 20250101000003_rls.sql >>>>>>>>>>>>>>>>>>>>

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


-- >>>>>>>>>>>>>>>>>>>> 20250101000004_oauth_onboarding.sql >>>>>>>>>>>>>>>>>>>>

-- =====================================================================
-- Social sign-in (Google) support.
-- A Google account arrives with no role or phone number. The signup trigger marks such profiles
-- `needs_onboarding`, and the user completes registration once (role, phone, vehicle for drivers)
-- through the backend. After that the role is immutable, exactly as for email signups.
-- Safe to run on a project that already has migrations 1-3 applied.
-- =====================================================================

alter table public.profiles add column if not exists needs_onboarding boolean not null default false;

-- Role may change ONLY while onboarding is still pending (the one-time registration step).
create or replace function public.profiles_prevent_role_change() returns trigger
language plpgsql as $$
begin
  if new.role <> old.role and not old.needs_onboarding then
    raise exception 'ROLE_IMMUTABLE';
  end if;
  if new.id <> old.id then
    raise exception 'ID_IMMUTABLE';
  end if;
  return new;
end $$;

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  meta     jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_chosen text  := meta ->> 'role';
  v_role   text;
  v_needs  boolean;
begin
  -- Email signups pass a role. Social sign-ins do not, so they must finish onboarding.
  v_needs := v_chosen is null or v_chosen not in ('passenger', 'driver');
  v_role  := case when v_needs then 'passenger' else v_chosen end;

  insert into public.profiles (id, full_name, email, phone, role, needs_onboarding)
  values (
    new.id,
    left(coalesce(nullif(trim(meta ->> 'full_name'), ''), nullif(trim(meta ->> 'name'), ''), 'Unnamed user'), 100),
    coalesce(new.email, ''),
    left(coalesce(nullif(trim(meta ->> 'phone'), ''), '0000000'), 20),
    v_role,
    v_needs
  );

  if v_role = 'driver' then
    insert into public.drivers (profile_id, vehicle_model, vehicle_registration)
    values (
      new.id,
      left(coalesce(nullif(trim(meta ->> 'vehicle_model'), ''), 'Unknown'), 80),
      left(coalesce(nullif(trim(meta ->> 'vehicle_registration'), ''), 'UNKNOWN'), 20)
    );
  end if;
  return new;
end $$;

-- One-time completion of registration for social sign-ins. Atomic; backend (service_role) only.
create or replace function public.complete_onboarding(
  p_user uuid, p_role text, p_phone text, p_vehicle_model text, p_vehicle_registration text
) returns jsonb
language plpgsql as $$
declare
  v_profile public.profiles;
begin
  if p_role not in ('passenger', 'driver') then raise exception 'INVALID_ROLE'; end if;

  select * into v_profile from public.profiles where id = p_user for update;
  if not found then raise exception 'PROFILE_NOT_FOUND'; end if;
  if not v_profile.needs_onboarding then raise exception 'ALREADY_ONBOARDED'; end if;

  update public.profiles
     set role = p_role, phone = p_phone, needs_onboarding = false
   where id = p_user
   returning * into v_profile;

  if p_role = 'driver' then
    insert into public.drivers (profile_id, vehicle_model, vehicle_registration)
    values (p_user, p_vehicle_model, p_vehicle_registration)
    on conflict (profile_id) do update
      set vehicle_model = excluded.vehicle_model, vehicle_registration = excluded.vehicle_registration;
  end if;

  return to_jsonb(v_profile);
end $$;

revoke all on function public.complete_onboarding(uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.complete_onboarding(uuid, text, text, text, text) to service_role;

-- Keep the backend's access in place for the new column (table-level grant already covers it).
grant all on public.profiles to service_role;


-- >>>>>>>>>>>>>>>>>>>> 20250101000005_phase2.sql >>>>>>>>>>>>>>>>>>>>

-- =====================================================================
-- Phase 2: live tracking, safety, support, saved places.
-- Safe to run on a project that already has migrations 1-4 applied.
--
-- Same security model as Phase 1:
--   * every write goes through the backend (service_role), which authorises it;
--   * browser clients (authenticated) get read-only access to their OWN rows, which is what
--     Supabase Realtime needs to push changes to them.
-- =====================================================================

-- ---------- rides: driver arrival at pickup ----------
-- Arrival is a milestone inside the 'accepted' state (not a new state), so the Phase 1 state machine is unchanged.
alter table public.rides add column if not exists arrived_at timestamptz;

-- ---------- ride_messages: in-app chat between passenger and driver (+ automated system messages) ----------
create table if not exists public.ride_messages (
  id           uuid primary key default gen_random_uuid(),
  ride_id      uuid not null references public.rides (id) on delete cascade,
  sender_role  text not null check (sender_role in ('passenger', 'driver', 'system')),
  sender_id    uuid references public.profiles (id) on delete set null,
  body         text not null check (char_length(body) between 1 and 500),
  created_at   timestamptz not null default now()
);
create index if not exists ride_messages_ride_idx on public.ride_messages (ride_id, created_at);

-- Marking arrival also sends the passenger an automated message, in the same transaction.
create or replace function public.mark_arrived(p_ride_id uuid, p_driver_id uuid)
returns jsonb
language plpgsql as $$
declare
  v_ride public.rides;
  v_car  text;
begin
  select * into v_ride from public.rides where id = p_ride_id for update;
  if not found then raise exception 'RIDE_NOT_FOUND'; end if;
  if v_ride.driver_id is distinct from p_driver_id then raise exception 'NOT_ASSIGNED_DRIVER'; end if;
  if v_ride.status <> 'accepted' then raise exception 'INVALID_TRANSITION'; end if;
  if v_ride.arrived_at is null then
    update public.rides set arrived_at = now() where id = p_ride_id returning * into v_ride;
    select d.vehicle_model || ' · ' || d.vehicle_registration into v_car from public.drivers d where d.id = p_driver_id;
    insert into public.ride_messages (ride_id, sender_role, body)
    values (p_ride_id, 'system', left(
      'Your driver has arrived at the pickup point (' || v_ride.pickup_address || '). Look for ' || coalesce(v_car, 'your car') || '.',
      500));
  end if;
  return to_jsonb(v_ride); -- idempotent: arriving twice sends one message
end $$;
revoke all on function public.mark_arrived(uuid, uuid) from public, anon, authenticated;
grant execute on function public.mark_arrived(uuid, uuid) to service_role;

-- ---------- ride_log: one readable row per booking, for the project owner ----------
-- Open it in Supabase: Table Editor -> ride_log (or `select * from ride_log;` in the SQL editor).
-- Shows who booked, from where to where, which driver took it, the status and every timestamp.
-- It contains contact details, so browser roles get NO access; only the dashboard/backend can read it.
create or replace view public.ride_log with (security_invoker = true) as
select
  r.created_at              as booked_at,
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
  r.accepted_at,
  r.arrived_at,
  r.started_at,
  r.completed_at,
  r.cancelled_at,
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
revoke all on public.ride_log from public, anon, authenticated;
grant select on public.ride_log to service_role;

-- ---------- ride_tracking_events: the driver's path during a ride ----------
-- Written by the backend (throttled: only when the driver moved or enough time passed), and pushed to the
-- ride's passenger over Realtime. Also used for trip monitoring and to draw the driven path afterwards.
create table if not exists public.ride_tracking_events (
  id           uuid primary key default gen_random_uuid(),
  ride_id      uuid not null references public.rides (id) on delete cascade,
  kind         text not null default 'location' check (kind in ('location', 'arrived')),
  latitude     double precision not null check (latitude  between -90  and 90),
  longitude    double precision not null check (longitude between -180 and 180),
  ride_status  text not null,
  recorded_at  timestamptz not null default now()
);
create index if not exists ride_tracking_events_ride_idx on public.ride_tracking_events (ride_id, recorded_at desc);

-- ---------- safety_alerts: possible route deviations / long stops ----------
create table if not exists public.safety_alerts (
  id           uuid primary key default gen_random_uuid(),
  ride_id      uuid not null references public.rides (id) on delete cascade,
  kind         text not null check (kind in ('route_deviation', 'long_stop')),
  message      text not null check (char_length(message) between 1 and 300),
  latitude     double precision,
  longitude    double precision,
  status       text not null default 'open' check (status in ('open', 'dismissed', 'help_requested')),
  created_at   timestamptz not null default now(),
  resolved_at  timestamptz
);
create index if not exists safety_alerts_ride_idx on public.safety_alerts (ride_id, created_at desc);

-- ---------- saved_places: Home, Work and other favourites ----------
create table if not exists public.saved_places (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  kind        text not null default 'other' check (kind in ('home', 'work', 'other')),
  label       text not null check (char_length(label) between 1 and 40),
  address     text not null check (char_length(address) between 1 and 300),
  latitude    double precision not null check (latitude  between -90  and 90),
  longitude   double precision not null check (longitude between -180 and 180),
  created_at  timestamptz not null default now()
);
create index if not exists saved_places_user_idx on public.saved_places (user_id, created_at);
-- At most one Home and one Work per user.
create unique index if not exists saved_places_one_home_work on public.saved_places (user_id, kind) where kind in ('home', 'work');

-- ---------- emergency_contacts ----------
create table if not exists public.emergency_contacts (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles (id) on delete cascade,
  name          text not null check (char_length(name) between 1 and 80),
  phone         text not null check (char_length(phone) between 6 and 20),
  relationship  text check (relationship is null or char_length(relationship) between 1 and 40),
  created_at    timestamptz not null default now(),
  constraint emergency_contacts_unique_phone unique (user_id, phone)
);

-- ---------- trip_shares: revocable, expiring links to follow one trip ----------
-- Only a SHA-256 hash of the link token is stored; the token itself is shown to the passenger once.
create table if not exists public.trip_shares (
  id          uuid primary key default gen_random_uuid(),
  ride_id     uuid not null references public.rides (id) on delete cascade,
  created_by  uuid not null references public.profiles (id) on delete cascade,
  token_hash  text not null unique,
  expires_at  timestamptz not null,
  revoked_at  timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists trip_shares_ride_idx on public.trip_shares (ride_id);

-- ---------- support_tickets + their status timeline ----------
create table if not exists public.support_tickets (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles (id) on delete cascade,
  ride_id      uuid references public.rides (id) on delete set null,
  category     text not null check (category in ('ride_issue', 'fare', 'driver', 'lost_item', 'safety', 'general')),
  subject      text not null check (char_length(subject) between 3 and 120),
  description  text not null check (char_length(description) between 10 and 2000),
  status       text not null default 'open' check (status in ('open', 'in_review', 'resolved', 'closed')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists support_tickets_user_idx on public.support_tickets (user_id, created_at desc);
create index if not exists support_tickets_status_idx on public.support_tickets (status, updated_at);

create table if not exists public.support_ticket_updates (
  id          uuid primary key default gen_random_uuid(),
  ticket_id   uuid not null references public.support_tickets (id) on delete cascade,
  author      text not null check (author in ('user', 'support', 'system')),
  status      text check (status is null or status in ('open', 'in_review', 'resolved', 'closed')),
  message     text not null check (char_length(message) between 1 and 2000),
  created_at  timestamptz not null default now()
);
create index if not exists support_ticket_updates_ticket_idx on public.support_ticket_updates (ticket_id, created_at);

-- =====================================================================
-- Row Level Security
-- =====================================================================
alter table public.ride_messages          enable row level security;
alter table public.ride_tracking_events   enable row level security;
alter table public.safety_alerts          enable row level security;
alter table public.saved_places           enable row level security;
alter table public.emergency_contacts     enable row level security;
alter table public.trip_shares            enable row level security;
alter table public.support_tickets        enable row level security;
alter table public.support_ticket_updates enable row level security;

grant all on public.ride_messages, public.ride_tracking_events, public.safety_alerts, public.saved_places, public.emergency_contacts,
             public.trip_shares, public.support_tickets, public.support_ticket_updates to service_role;
revoke all on public.ride_messages, public.ride_tracking_events, public.safety_alerts, public.saved_places, public.emergency_contacts,
              public.trip_shares, public.support_tickets, public.support_ticket_updates from anon, authenticated;
grant select on public.ride_messages, public.ride_tracking_events, public.safety_alerts, public.saved_places, public.emergency_contacts,
                public.trip_shares, public.support_tickets, public.support_ticket_updates to authenticated;

-- Helper: is the signed-in user a participant (passenger or assigned driver) of this ride?
create or replace function public.is_ride_participant(p_ride_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.rides r
     where r.id = p_ride_id
       and (r.passenger_id = auth.uid() or r.driver_id = public.current_driver_id())
  );
$$;
revoke all on function public.is_ride_participant(uuid) from public, anon;
grant execute on function public.is_ride_participant(uuid) to authenticated, service_role;

drop policy if exists ride_messages_select_participants on public.ride_messages;
create policy ride_messages_select_participants on public.ride_messages
  for select to authenticated using ((select public.is_ride_participant(ride_id)));

drop policy if exists ride_tracking_events_select_participants on public.ride_tracking_events;
create policy ride_tracking_events_select_participants on public.ride_tracking_events
  for select to authenticated using ((select public.is_ride_participant(ride_id)));

-- Safety alerts are for the passenger of the ride.
drop policy if exists safety_alerts_select_passenger on public.safety_alerts;
create policy safety_alerts_select_passenger on public.safety_alerts
  for select to authenticated
  using (exists (select 1 from public.rides r where r.id = ride_id and r.passenger_id = (select auth.uid())));

drop policy if exists saved_places_select_own on public.saved_places;
create policy saved_places_select_own on public.saved_places
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists emergency_contacts_select_own on public.emergency_contacts;
create policy emergency_contacts_select_own on public.emergency_contacts
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists trip_shares_select_own on public.trip_shares;
create policy trip_shares_select_own on public.trip_shares
  for select to authenticated using (created_by = (select auth.uid()));

drop policy if exists support_tickets_select_own on public.support_tickets;
create policy support_tickets_select_own on public.support_tickets
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists support_ticket_updates_select_own on public.support_ticket_updates;
create policy support_ticket_updates_select_own on public.support_ticket_updates
  for select to authenticated
  using (exists (select 1 from public.support_tickets t where t.id = ticket_id and t.user_id = (select auth.uid())));

-- =====================================================================
-- Realtime: live driver path, safety alerts and support status changes.
-- =====================================================================
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['ride_messages', 'ride_tracking_events', 'safety_alerts', 'support_tickets', 'support_ticket_updates'] loop
      if not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;


-- >>>>>>>>>>>>>>>>>>>> 20250101000006_admin.sql >>>>>>>>>>>>>>>>>>>>

-- =====================================================================
-- Admin dashboard: who is an admin, live app settings, and an admin-only ride cancel.
-- Safe to run on a project that already has migrations 1-5 applied.
--
-- Browsers get NO access to these tables. The backend checks app_admins on every admin request.
-- =====================================================================

-- ---------- app_admins: accounts allowed into /admin ----------
create table if not exists public.app_admins (
  user_id     uuid primary key references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now()
);

-- ---------- app_settings: switches the admin can flip at runtime (e.g. demo autopilot) ----------
create table if not exists public.app_settings (
  key         text primary key check (char_length(key) between 1 and 60),
  value       jsonb not null,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.profiles (id) on delete set null
);

alter table public.app_admins   enable row level security;
alter table public.app_settings enable row level security;
grant all on public.app_admins, public.app_settings to service_role;
revoke all on public.app_admins, public.app_settings from anon, authenticated;
-- No policies for browser roles: only the backend (service_role) can read or write these.

-- ---------- admin_cancel_ride: cancel any ride that hasn't started (stuck or test rides) ----------
create or replace function public.admin_cancel_ride(p_ride_id uuid)
returns jsonb
language plpgsql as $$
declare v_ride public.rides;
begin
  select * into v_ride from public.rides where id = p_ride_id for update;
  if not found then raise exception 'RIDE_NOT_FOUND'; end if;
  if v_ride.status not in ('requested', 'searching', 'accepted') then raise exception 'INVALID_TRANSITION'; end if;
  update public.ride_offers set status = 'cancelled', responded_at = now()
   where ride_id = p_ride_id and status = 'pending';
  update public.rides set status = 'cancelled', cancelled_by = 'system', cancelled_at = now()
   where id = p_ride_id returning * into v_ride;
  return to_jsonb(v_ride);
end $$;
revoke all on function public.admin_cancel_ride(uuid) from public, anon, authenticated;
grant execute on function public.admin_cancel_ride(uuid) to service_role;

-- =====================================================================
-- MAKE YOURSELF AN ADMIN (run once, after you have signed up in the app):
--   insert into public.app_admins (user_id)
--   select id from auth.users where email = 'you@example.com'
--   on conflict do nothing;
-- =====================================================================


-- >>>>>>>>>>>>>>>>>>>> 20250101000007_ist_times.sql >>>>>>>>>>>>>>>>>>>>

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

