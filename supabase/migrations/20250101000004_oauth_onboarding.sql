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
