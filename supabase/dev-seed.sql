-- ⚠️ DATOS DE DEMOSTRACIÓN — SOLO PARA DESARROLLO Y PRUEBAS LOCALES.
-- Los servicios, precios y horarios de abajo son ILUSTRATIVOS, no los reales de Don Gabo.
-- No ejecutar en producción: Gabo carga sus datos reales desde el panel /admin.
truncate public.appointments, public.time_off, public.time_blocks, public.working_hours, public.services restart identity cascade;

insert into public.services (name, description, price_ars, duration_minutes, buffer_minutes, sort_order) values
  ('Corte de pelo', null, 10000, 30, 0, 1),
  ('Corte + barba', null, 15000, 60, 0, 2),
  ('Barba', null, 7000, 30, 0, 3);

insert into public.working_hours (barber_id, weekday, start_minute, end_minute)
select b.id, d.wd, h.s, h.e
from public.barbers b,
     (values (2),(3),(4),(5),(6)) as d(wd),
     (values (540, 780), (960, 1260)) as h(s, e);

update public.business_settings set
  whatsapp = '+5492615550000',
  address = 'Mendoza (dirección a confirmar)',
  min_notice_minutes = 60, max_days_ahead = 30, cancel_notice_hours = 2;
