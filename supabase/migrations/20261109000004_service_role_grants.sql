-- Permisos explícitos para el rol del servidor (service_role).
-- Los proyectos nuevos de Supabase ya NO otorgan permisos automáticos sobre las tablas
-- creadas en el esquema public: sin esto, el servidor recibe "permission denied".
-- Es seguro: service_role solo lo usa el servidor (clave secreta), nunca el navegador.

grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;

-- Tablas y funciones que se creen más adelante también quedan accesibles para el servidor.
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;
alter default privileges in schema public grant execute on functions to service_role;
