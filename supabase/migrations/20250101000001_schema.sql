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
