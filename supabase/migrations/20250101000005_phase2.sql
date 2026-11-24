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
