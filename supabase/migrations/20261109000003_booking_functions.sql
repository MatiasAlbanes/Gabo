-- Motor transaccional de reservas.
-- Estas funciones son la última línea de defensa: aunque el servidor web o el navegador
-- fallen, la base de datos rechaza turnos fuera de horario, en días libres, sobre
-- bloqueos o superpuestos con otro turno activo.
-- Solo el rol service_role (servidor Next.js) puede ejecutarlas.

-- ---------------------------------------------------------------------------
-- Validación de un horario concreto. Lanza excepciones con códigos legibles.
-- ---------------------------------------------------------------------------
create or replace function public._validate_slot(
  p_barber uuid,
  p_start timestamptz,
  p_duration integer,
  p_enforce_policy boolean
) returns void
language plpgsql security definer set search_path = public as $$
declare
  s public.business_settings;
  local_start timestamp;
  local_date date;
  wd integer;
  sm integer;
begin
  select * into s from public.business_settings where id = 1;

  if p_start <= now() then
    raise exception 'slot_in_past' using errcode = 'P0001';
  end if;

  if p_enforce_policy then
    if not s.booking_enabled then
      raise exception 'booking_disabled' using errcode = 'P0001';
    end if;
    if p_start < now() + make_interval(mins => s.min_notice_minutes) then
      raise exception 'too_soon' using errcode = 'P0001';
    end if;
    if (p_start at time zone s.timezone)::date > (now() at time zone s.timezone)::date + s.max_days_ahead then
      raise exception 'too_far' using errcode = 'P0001';
    end if;
  end if;

  local_start := p_start at time zone s.timezone;
  local_date  := local_start::date;
  wd          := extract(isodow from local_start)::integer;
  sm          := extract(hour from local_start)::integer * 60 + extract(minute from local_start)::integer;

  if exists (select 1 from public.time_off t
             where t.barber_id = p_barber and local_date between t.start_date and t.end_date) then
    raise exception 'closed_day' using errcode = 'P0001';
  end if;

  if not exists (select 1 from public.working_hours w
                 where w.barber_id = p_barber and w.weekday = wd
                   and w.start_minute <= sm and sm + p_duration <= w.end_minute) then
    raise exception 'outside_hours' using errcode = 'P0001';
  end if;

  if exists (select 1 from public.time_blocks b
             where b.barber_id = p_barber
               and tstzrange(b.start_at, b.end_at, '[)')
                   && tstzrange(p_start, p_start + make_interval(mins => p_duration), '[)')) then
    raise exception 'slot_blocked' using errcode = 'P0001';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Crear turno (cliente online o carga manual del administrador)
-- ---------------------------------------------------------------------------
create or replace function public.book_appointment(
  p_barber      uuid,
  p_service     uuid,
  p_name        text,
  p_phone       text,
  p_start       timestamptz,
  p_token_hash  text,
  p_source      text default 'online',
  p_notes       text default null
) returns public.appointments
language plpgsql security definer set search_path = public as $$
declare
  sv public.services;
  s public.business_settings;
  a public.appointments;
  active_count integer;
begin
  -- Serializa las reservas de un mismo profesional: nadie más escribe mientras validamos.
  perform pg_advisory_xact_lock(hashtextextended(p_barber::text, 0));

  select * into s from public.business_settings where id = 1;
  select * into sv from public.services where id = p_service and active;
  if not found then
    raise exception 'service_unavailable' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.barbers where id = p_barber and active) then
    raise exception 'barber_unavailable' using errcode = 'P0001';
  end if;

  if p_source = 'online' then
    select count(*) into active_count from public.appointments
      where client_phone = p_phone and status = 'confirmed' and end_at > now();
    if active_count >= s.max_active_per_phone then
      raise exception 'too_many_active' using errcode = 'P0001';
    end if;
  end if;

  perform public._validate_slot(p_barber, p_start, sv.duration_minutes, p_source = 'online');

  begin
    insert into public.appointments (
      barber_id, service_id, service_name, service_price_ars, duration_minutes, buffer_minutes,
      client_name, client_phone, start_at, end_at, occupied_until, source, token_hash, notes
    ) values (
      p_barber, sv.id, sv.name, sv.price_ars, sv.duration_minutes, sv.buffer_minutes,
      btrim(p_name), p_phone, p_start,
      p_start + make_interval(mins => sv.duration_minutes),
      p_start + make_interval(mins => sv.duration_minutes + sv.buffer_minutes),
      p_source, p_token_hash, nullif(btrim(coalesce(p_notes, '')), '')
    ) returning * into a;
  exception when exclusion_violation then
    raise exception 'slot_taken' using errcode = 'P0001';
  end;

  return a;
end $$;

-- ---------------------------------------------------------------------------
-- Reprogramar (atómico: o se mueve completo, o no cambia nada)
-- p_by = 'client' aplica las políticas del negocio (anticipación, límite para modificar)
-- ---------------------------------------------------------------------------
create or replace function public.move_appointment(
  p_id         uuid,
  p_new_start  timestamptz,
  p_by         text default 'client'
) returns public.appointments
language plpgsql security definer set search_path = public as $$
declare
  a public.appointments;
  s public.business_settings;
  v_barber uuid;
begin
  select barber_id into v_barber from public.appointments where id = p_id;
  if v_barber is null then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_barber::text, 0));

  select * into a from public.appointments where id = p_id for update;
  select * into s from public.business_settings where id = 1;

  if a.status <> 'confirmed' then
    raise exception 'not_editable' using errcode = 'P0001';
  end if;
  if p_by = 'client' and a.start_at < now() + make_interval(hours => s.cancel_notice_hours) then
    raise exception 'too_late_to_change' using errcode = 'P0001';
  end if;

  perform public._validate_slot(a.barber_id, p_new_start, a.duration_minutes, p_by = 'client');

  begin
    update public.appointments set
      start_at = p_new_start,
      end_at = p_new_start + make_interval(mins => a.duration_minutes),
      occupied_until = p_new_start + make_interval(mins => a.duration_minutes + a.buffer_minutes),
      reschedule_count = a.reschedule_count + 1
    where id = p_id
    returning * into a;
  exception when exclusion_violation then
    raise exception 'slot_taken' using errcode = 'P0001';
  end;

  return a;
end $$;

-- ---------------------------------------------------------------------------
-- Cancelar (conserva el registro como historial)
-- ---------------------------------------------------------------------------
create or replace function public.cancel_appointment(
  p_id  uuid,
  p_by  text default 'client'
) returns public.appointments
language plpgsql security definer set search_path = public as $$
declare
  a public.appointments;
  s public.business_settings;
begin
  select * into a from public.appointments where id = p_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  select * into s from public.business_settings where id = 1;

  if a.status <> 'confirmed' then
    raise exception 'not_editable' using errcode = 'P0001';
  end if;
  if p_by = 'client' and a.start_at < now() + make_interval(hours => s.cancel_notice_hours) then
    raise exception 'too_late_to_change' using errcode = 'P0001';
  end if;

  update public.appointments
    set status = 'cancelled', cancelled_at = now(), cancelled_by = p_by
    where id = p_id
    returning * into a;
  return a;
end $$;

-- ---------------------------------------------------------------------------
-- Límite de solicitudes: devuelve true si la solicitud está permitida
-- ---------------------------------------------------------------------------
create or replace function public.check_rate_limit(
  p_key             text,
  p_limit           integer,
  p_window_seconds  integer
) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  w timestamptz;
  n integer;
begin
  w := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  insert into public.rate_limits as r (key, window_start, hits) values (p_key, w, 1)
    on conflict (key, window_start) do update set hits = r.hits + 1
    returning hits into n;
  if random() < 0.02 then
    delete from public.rate_limits where window_start < now() - interval '2 days';
  end if;
  return n <= p_limit;
end $$;

-- ---------------------------------------------------------------------------
-- Reemplazo completo de los horarios semanales en una sola transacción.
-- Se ejecuta con los permisos del administrador (RLS aplica).
-- ---------------------------------------------------------------------------
create or replace function public.save_working_hours(p_barber uuid, p_hours jsonb)
returns void
language plpgsql security invoker set search_path = public as $$
begin
  delete from public.working_hours where barber_id = p_barber;
  insert into public.working_hours (barber_id, weekday, start_minute, end_minute)
  select p_barber, (e->>'weekday')::smallint, (e->>'start_minute')::integer, (e->>'end_minute')::integer
  from jsonb_array_elements(p_hours) e;
end $$;

-- Solo el servidor (service_role) ejecuta el motor de reservas.
revoke all on function public._validate_slot(uuid, timestamptz, integer, boolean) from public, anon, authenticated;
revoke all on function public.book_appointment(uuid, uuid, text, text, timestamptz, text, text, text) from public, anon, authenticated;
revoke all on function public.move_appointment(uuid, timestamptz, text) from public, anon, authenticated;
revoke all on function public.cancel_appointment(uuid, text) from public, anon, authenticated;
revoke all on function public.check_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public._validate_slot(uuid, timestamptz, integer, boolean) to service_role;
grant execute on function public.book_appointment(uuid, uuid, text, text, timestamptz, text, text, text) to service_role;
grant execute on function public.move_appointment(uuid, timestamptz, text) to service_role;
grant execute on function public.cancel_appointment(uuid, text) to service_role;
grant execute on function public.check_rate_limit(text, integer, integer) to service_role;

-- save_working_hours: administradores autenticados (RLS decide si pueden escribir)
revoke all on function public.save_working_hours(uuid, jsonb) from public, anon;
grant execute on function public.save_working_hours(uuid, jsonb) to authenticated;
