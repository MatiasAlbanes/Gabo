-- DON GABO BARBER STUDIO · Esquema principal
-- Todas las fechas se guardan como timestamptz (UTC). La zona horaria del negocio
-- (America/Argentina/Mendoza) se aplica al calcular días y horarios laborales.

create extension if not exists btree_gist;

-- ---------------------------------------------------------------------------
-- Utilidades
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Profesionales (la v1 usa uno solo; la arquitectura admite varios)
-- ---------------------------------------------------------------------------
create table public.barbers (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(btrim(name)) between 1 and 80),
  active      boolean not null default true,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Administradores autorizados (referencian a Supabase Auth)
-- ---------------------------------------------------------------------------
create table public.admin_users (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  role        text not null default 'admin' check (role in ('owner', 'admin')),
  created_at  timestamptz not null default now()
);

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admin_users where user_id = auth.uid());
$$;

-- ---------------------------------------------------------------------------
-- Configuración del negocio (fila única)
-- ---------------------------------------------------------------------------
create table public.business_settings (
  id                      smallint primary key default 1 check (id = 1),
  name                    text not null default 'DON GABO BARBER STUDIO',
  description             text,
  address                 text,
  whatsapp                text check (whatsapp is null or whatsapp ~ '^\+[1-9][0-9]{7,14}$'),
  instagram_url           text default 'https://www.instagram.com/dongabobarberstudio/',
  logo_url                text,
  cover_url               text,
  timezone                text not null default 'America/Argentina/Mendoza',
  slot_interval_minutes   integer not null default 30 check (slot_interval_minutes between 5 and 240),
  min_notice_minutes      integer not null default 60 check (min_notice_minutes >= 0),
  max_days_ahead          integer not null default 30 check (max_days_ahead between 1 and 365),
  cancel_notice_hours     integer not null default 2 check (cancel_notice_hours >= 0),
  max_active_per_phone    integer not null default 3 check (max_active_per_phone >= 1),
  booking_enabled         boolean not null default true,
  updated_at              timestamptz not null default now()
);
create trigger business_settings_touch before update on public.business_settings
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Servicios
-- ---------------------------------------------------------------------------
create table public.services (
  id                uuid primary key default gen_random_uuid(),
  name              text not null check (length(btrim(name)) between 1 and 80),
  description       text check (description is null or length(description) <= 300),
  price_ars         integer not null check (price_ars >= 0),
  duration_minutes  integer not null check (duration_minutes between 5 and 480),
  buffer_minutes    integer not null default 0 check (buffer_minutes between 0 and 120),
  active            boolean not null default true,
  sort_order        integer not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create trigger services_touch before update on public.services
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Horarios laborales: uno o más tramos por día (los huecos son los descansos).
-- weekday sigue ISO: 1 = lunes ... 7 = domingo. Un día sin tramos = cerrado.
-- ---------------------------------------------------------------------------
create table public.working_hours (
  id            uuid primary key default gen_random_uuid(),
  barber_id     uuid not null references public.barbers(id) on delete cascade,
  weekday       smallint not null check (weekday between 1 and 7),
  start_minute  integer not null check (start_minute between 0 and 1439),
  end_minute    integer not null check (end_minute between 1 and 1440),
  check (start_minute < end_minute),
  constraint working_hours_no_overlap
    exclude using gist (barber_id with =, weekday with =, int4range(start_minute, end_minute) with &&)
);

-- Días libres, feriados y vacaciones (días completos, fechas locales inclusivas)
create table public.time_off (
  id          uuid primary key default gen_random_uuid(),
  barber_id   uuid not null references public.barbers(id) on delete cascade,
  kind        text not null default 'day_off' check (kind in ('day_off', 'holiday', 'vacation')),
  start_date  date not null,
  end_date    date not null,
  reason      text check (reason is null or length(reason) <= 200),
  created_at  timestamptz not null default now(),
  check (end_date >= start_date)
);
create index time_off_range_idx on public.time_off (barber_id, start_date, end_date);

-- Bloqueos puntuales de horario
create table public.time_blocks (
  id          uuid primary key default gen_random_uuid(),
  barber_id   uuid not null references public.barbers(id) on delete cascade,
  start_at    timestamptz not null,
  end_at      timestamptz not null,
  reason      text check (reason is null or length(reason) <= 200),
  created_at  timestamptz not null default now(),
  check (end_at > start_at)
);
create index time_blocks_range_idx on public.time_blocks (barber_id, start_at, end_at);

-- ---------------------------------------------------------------------------
-- Turnos
--   * service_* y duration/buffer son una copia histórica del servicio al reservar.
--   * occupied_until = fin del servicio + tiempo de preparación/limpieza.
--   * token_hash = SHA-256 del token privado (el token en sí nunca se guarda).
--   * La restricción de exclusión impide, a nivel de base de datos, que dos turnos
--     activos del mismo profesional se superpongan, incluso ante solicitudes simultáneas.
-- ---------------------------------------------------------------------------
create table public.appointments (
  id                  uuid primary key default gen_random_uuid(),
  barber_id           uuid not null references public.barbers(id),
  service_id          uuid references public.services(id) on delete set null,
  service_name        text not null,
  service_price_ars   integer not null check (service_price_ars >= 0),
  duration_minutes    integer not null check (duration_minutes > 0),
  buffer_minutes      integer not null default 0 check (buffer_minutes >= 0),
  client_name         text not null check (length(btrim(client_name)) between 1 and 80),
  client_phone        text not null check (client_phone ~ '^\+[1-9][0-9]{7,14}$'),
  start_at            timestamptz not null,
  end_at              timestamptz not null,
  occupied_until      timestamptz not null,
  status              text not null default 'confirmed'
                        check (status in ('confirmed', 'completed', 'cancelled', 'no_show')),
  source              text not null default 'online' check (source in ('online', 'admin')),
  token_hash          text not null unique,
  notes               text check (notes is null or length(notes) <= 500),
  cancelled_at        timestamptz,
  cancelled_by        text check (cancelled_by is null or cancelled_by in ('client', 'admin')),
  reschedule_count    integer not null default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  check (end_at > start_at),
  check (occupied_until >= end_at),
  constraint appointments_no_overlap
    exclude using gist (barber_id with =, tstzrange(start_at, occupied_until, '[)') with &&)
    where (status in ('confirmed', 'completed'))
);
create index appointments_barber_start_idx on public.appointments (barber_id, start_at);
create index appointments_phone_idx on public.appointments (client_phone);
create index appointments_status_start_idx on public.appointments (status, start_at);
create trigger appointments_touch before update on public.appointments
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Límite de solicitudes (ventana fija, atómico entre instancias serverless)
-- ---------------------------------------------------------------------------
create table public.rate_limits (
  key           text not null,
  window_start  timestamptz not null,
  hits          integer not null default 0,
  primary key (key, window_start)
);

-- ---------------------------------------------------------------------------
-- Datos iniciales (no son datos comerciales: solo la estructura mínima)
-- ---------------------------------------------------------------------------
insert into public.barbers (name) values ('Gabo');
insert into public.business_settings (id) values (1);
