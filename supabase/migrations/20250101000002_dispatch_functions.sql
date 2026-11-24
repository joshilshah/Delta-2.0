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
