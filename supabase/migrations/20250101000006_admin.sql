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
