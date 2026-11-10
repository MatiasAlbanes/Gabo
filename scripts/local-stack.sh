#!/usr/bin/env bash
# Stack local compatible con Supabase (Postgres + GoTrue + PostgREST) usando Podman o Docker.
# Sirve para desarrollar y ejecutar las pruebas SIN cuenta de Supabase.
#   bash scripts/local-stack.sh up     -> crea el stack, aplica migraciones y arranca el gateway en :54321
#   bash scripts/local-stack.sh down   -> lo elimina
#   bash scripts/local-stack.sh reset  -> lo recrea desde cero
# Los datos son efímeros (se pierden al hacer down).
set -euo pipefail
cd "$(dirname "$0")/.."

CT="${CONTAINER_ENGINE:-podman}"
POD=gabo-stack
PGPW=postgres-local-pw
export PATH="$PATH"
KEYS_FILE=".stack-data/env"

psql_exec() { $CT exec -i "$POD-db" psql -v ON_ERROR_STOP=1 -U postgres -d postgres "$@"; }

down() {
  [ -f .stack-data/proxy.pid ] && kill "$(cat .stack-data/proxy.pid)" 2>/dev/null || true
  rm -f .stack-data/proxy.pid
  $CT pod rm -f "$POD" >/dev/null 2>&1 || true
}

up() {
  down
  mkdir -p .stack-data
  $CT pod create --name "$POD" -p 54322:5432 -p 54323:3000 -p 54324:9999 >/dev/null
  $CT run -d --pod "$POD" --name "$POD-db" -e POSTGRES_PASSWORD="$PGPW" docker.io/library/postgres:16-alpine >/dev/null
  echo -n "Esperando Postgres"
  until $CT exec "$POD-db" pg_isready -U postgres -h 127.0.0.1 >/dev/null 2>&1; do echo -n .; sleep 1; done
  sleep 2; echo " ok"

  eval "$(node scripts/stack-keys.mjs | sed 's/^/export /')"

  # Roles y esquema "auth" equivalentes a los de Supabase.
  psql_exec >/dev/null <<SQL
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;
create role authenticator login noinherit password '$PGPW';
grant anon, authenticated, service_role to authenticator;
create role supabase_auth_admin login noinherit createrole password '$PGPW';
create schema auth authorization supabase_auth_admin;
alter role supabase_auth_admin set search_path = auth;
grant usage on schema public to anon, authenticated, service_role;
grant all on schema public to service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
SQL

  $CT run -d --pod "$POD" --name "$POD-auth" \
    -e GOTRUE_API_HOST=0.0.0.0 -e GOTRUE_API_PORT=9999 -e API_EXTERNAL_URL=http://127.0.0.1:54321 \
    -e GOTRUE_DB_DRIVER=postgres -e "GOTRUE_DB_DATABASE_URL=postgres://supabase_auth_admin:$PGPW@127.0.0.1:5432/postgres" \
    -e DB_NAMESPACE=auth -e GOTRUE_SITE_URL=http://localhost:3000 \
    -e "GOTRUE_JWT_SECRET=$JWT_SECRET" -e GOTRUE_JWT_EXP=3600 -e GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated \
    -e GOTRUE_DISABLE_SIGNUP=false -e GOTRUE_MAILER_AUTOCONFIRM=true -e GOTRUE_EXTERNAL_EMAIL_ENABLED=true \
    docker.io/supabase/gotrue:v2.158.1 >/dev/null

  echo -n "Esperando GoTrue (migraciones de auth)"
  for _ in $(seq 1 60); do
    if psql_exec -tAc "select to_regclass('auth.users')" 2>/dev/null | grep -q users; then break; fi
    echo -n .; sleep 1
  done
  echo " ok"

  for f in supabase/migrations/*.sql; do
    echo "Aplicando $f"
    psql_exec -q < "$f" >/dev/null
  done
  psql_exec -qc "notify pgrst, 'reload schema'" >/dev/null || true

  $CT run -d --pod "$POD" --name "$POD-rest" \
    -e "PGRST_DB_URI=postgres://authenticator:$PGPW@127.0.0.1:5432/postgres" \
    -e PGRST_DB_SCHEMAS=public -e PGRST_DB_ANON_ROLE=anon -e "PGRST_JWT_SECRET=$JWT_SECRET" \
    docker.io/postgrest/postgrest:v12.2.3 >/dev/null
  sleep 3

  nohup node scripts/stack-proxy.mjs > .stack-data/proxy.log 2>&1 &
  echo $! > .stack-data/proxy.pid

  cat > "$KEYS_FILE" <<ENV
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=$ANON_KEY
SUPABASE_SERVICE_ROLE_KEY=$SERVICE_KEY
DATABASE_URL=postgres://postgres:$PGPW@127.0.0.1:54322/postgres
ENV
  echo "Stack listo. Variables en $KEYS_FILE"
}

case "${1:-}" in
  up) up ;;
  down) down ;;
  reset) down; up ;;
  *) echo "uso: $0 up|down|reset"; exit 1 ;;
esac
