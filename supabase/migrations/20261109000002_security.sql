-- Seguridad a nivel de base de datos: RLS en todas las tablas + permisos mínimos.
-- Los clientes anónimos NUNCA pueden leer turnos, bloqueos, días libres ni administradores.

alter table public.barbers           enable row level security;
alter table public.admin_users       enable row level security;
alter table public.business_settings enable row level security;
alter table public.services          enable row level security;
alter table public.working_hours     enable row level security;
alter table public.time_off          enable row level security;
alter table public.time_blocks       enable row level security;
alter table public.appointments      enable row level security;
alter table public.rate_limits       enable row level security;

-- Partimos de cero: nada para anon/authenticated salvo lo que se otorga abajo.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;

-- Lectura pública: solo información comercial no sensible.
grant select on public.barbers, public.business_settings, public.services, public.working_hours to anon, authenticated;
create policy barbers_public_read on public.barbers for select using (active);
create policy settings_public_read on public.business_settings for select using (true);
create policy services_public_read on public.services for select using (active);
create policy working_hours_public_read on public.working_hours for select using (true);

-- Administradores autenticados (fila en admin_users): control total de la agenda.
grant select, insert, update, delete on
  public.barbers, public.business_settings, public.services, public.working_hours,
  public.time_off, public.time_blocks, public.appointments to authenticated;
grant select on public.admin_users to authenticated;

create policy barbers_admin_all on public.barbers for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy settings_admin_all on public.business_settings for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy services_admin_all on public.services for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy working_hours_admin_all on public.working_hours for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy time_off_admin_all on public.time_off for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy time_blocks_admin_all on public.time_blocks for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy appointments_admin_all on public.appointments for all to authenticated using (public.is_admin()) with check (public.is_admin());
-- Cada usuario solo puede ver su propia fila de admin_users (sirve para comprobar su rol).
create policy admin_users_self_read on public.admin_users for select to authenticated using (user_id = auth.uid());

-- rate_limits: sin políticas ni permisos -> únicamente service_role (que ignora RLS).

-- is_admin() la usan las políticas, así que debe poder ejecutarse.
grant execute on function public.is_admin() to anon, authenticated;
