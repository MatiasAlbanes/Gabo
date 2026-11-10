# DON GABO BARBER STUDIO · Reservas de turnos

Aplicación web para que los clientes reserven turnos desde un enlace (Instagram) y para que Gabo administre su agenda desde el celular, sin depender de mensajes de WhatsApp.

- **Cliente:** una sola página → servicio → día → horario → nombre y WhatsApp → **Confirmar turno**. Sin cuentas ni contraseñas.
- **Gabo:** panel privado en `/admin` (Hoy, Agenda diaria/semanal/mensual, Turnos y búsqueda, Servicios, Horarios, Días libres y bloqueos, Datos del negocio).
- **Stack:** Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS 4 · Supabase (PostgreSQL + Auth) · Cloudflare Workers (gratis).

> Ningún dato comercial está inventado: servicios, precios, horarios, dirección y teléfono se cargan desde el panel. Ver [Datos pendientes de confirmar](#datos-pendientes-de-confirmar).

---

## 1. Cómo funciona (resumen técnico)

| Pieza | Dónde | Qué hace |
|---|---|---|
| Esquema y reglas | `supabase/migrations/` | Tablas, **restricción de exclusión** que impide turnos superpuestos, RLS, funciones transaccionales de reserva. |
| Motor de disponibilidad | `src/lib/availability.ts` | Lógica pura: horarios, descansos, duración + preparación, bloqueos, feriados/vacaciones, anticipación mínima, días máximos. |
| Reservas | `src/lib/server/appointments.ts` + SQL `book_appointment` / `move_appointment` / `cancel_appointment` | El servidor recalcula la disponibilidad y la base de datos **vuelve a validar** (horario laboral, día libre, bloqueo, pasado, superposición) dentro de una transacción con bloqueo por profesional. |
| Zona horaria | `src/lib/time.ts` | Todo se calcula en `America/Argentina/Mendoza`; en la base se guarda UTC (`timestamptz`). |
| API pública | `src/app/api/*` | Solo devuelve horarios libres. Nunca nombres ni teléfonos. Con límite de solicitudes (contador atómico en Postgres) y campo trampa anti-bots. |
| Enlace privado del turno | `/turno/[token]` | Token de 256 bits; en la base solo se guarda su hash SHA‑256. |
| Panel | `src/app/admin/*` | Supabase Auth + tabla `admin_users` + RLS. Cada acción del servidor revalida que sea administrador. |

Preparado para varios barberos: existe la tabla `barbers` y todo (horarios, bloqueos, turnos) cuelga de `barber_id`. La v1 usa un solo profesional.

---

## 2. Instalación para desarrollo

Requisitos: Node 20+ y npm.

```bash
npm install
cp .env.example .env.local   # completar con los valores de la sección 3
npm run dev                  # http://localhost:3000
```

### Sin cuenta de Supabase (stack local con Podman/Docker)

Para probar todo en tu máquina hay un stack equivalente (Postgres + GoTrue + PostgREST) que aplica las migraciones:

```bash
npm run stack:up                         # crea el stack y escribe .stack-data/env
cat .stack-data/env >> .env.local        # (o copiá esos valores a .env.local)
podman exec -i gabo-stack-db psql -U postgres < supabase/dev-seed.sql   # opcional: datos ILUSTRATIVOS de demostración
npm run create-admin -- gabo@ejemplo.com "UnaContraseñaLarga123"
npm run stack:down                       # lo elimina
```

`supabase/dev-seed.sql` contiene servicios y horarios **de ejemplo** y no debe ejecutarse en producción.

---

## 3. Conectar Supabase (producción)

1. Creá un proyecto en <https://supabase.com> (el plan gratuito alcanza para empezar). Elegí una región cercana (São Paulo).
2. **Base de datos:** aplicá las migraciones, en orden, de cualquiera de estas dos formas:
   - *Con la CLI:* `npx supabase login`, `npx supabase link --project-ref TU_REF`, `npx supabase db push`.
   - *Sin CLI:* en el **SQL Editor** de Supabase pegá y ejecutá, en este orden, el contenido de
     `supabase/migrations/20261109000001_schema.sql`, `…000002_security.sql`, `…000003_booking_functions.sql` y `…000004_service_role_grants.sql`.
3. **Claves** (Project Settings → API): copiá `Project URL`, `anon public` y `service_role` a las variables de entorno:

   | Variable | Valor | Notas |
   |---|---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | Project URL | pública |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | clave `anon` | pública; las políticas RLS limitan lo que puede leer |
   | `SUPABASE_SERVICE_ROLE_KEY` | clave `service_role` | **SECRETA**, solo servidor |
   | `NEXT_PUBLIC_SITE_URL` | `https://tu-dominio.com` | arma los enlaces privados de los turnos |
   | `RATE_LIMIT_SALT` | texto aleatorio largo | anonimiza las IP del límite de solicitudes |

4. **Auth:** en Authentication → Providers dejá activo solo *Email*. En Authentication → Sign In / Providers desactivá **“Allow new users to sign up”** (los administradores se crean con el script, no por registro libre).
5. **Crear el administrador** (una vez por persona, desde tu máquina con `.env.local` apuntando al proyecto):
   ```bash
   npm run create-admin -- gabo@ejemplo.com "ContraseñaLargaYÚnica" owner
   ```
   Crea el usuario en Supabase Auth y lo autoriza en `admin_users`. Para otro administrador usá el rol `admin`.

## 4. Desplegar (gratis) en Cloudflare Workers

Esta app necesita un servidor, así que **no sirve GitHub Pages**. Está adaptada para **Cloudflare Workers** (plan gratuito, permite uso comercial) mediante el adaptador OpenNext. El paquete comprimido pesa ~2,1 MB (límite gratuito: 3 MB).

**Opción A · Conectando GitHub (recomendada: cada `git push` publica solo)**
1. Subí el proyecto a un repositorio de GitHub.
2. En <https://dash.cloudflare.com> → *Workers & Pages* → *Create* → *Import a repository* → elegí el repo.
3. Comandos de build: **Build command** `npx opennextjs-cloudflare build` · **Deploy command** `npx wrangler deploy`.
4. Variables (*Settings → Variables and Secrets*):
   - Como **variables de build** (se incrustan al compilar): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SITE_URL`.
   - Como **secretos del Worker** (solo servidor): `SUPABASE_SERVICE_ROLE_KEY`, `RATE_LIMIT_SALT`.
   - Cargá también las tres públicas como variables del Worker (runtime) para que el servidor las lea.
5. Asigná tu dominio en *Settings → Domains & Routes* y poné ese enlace en la biografía de Instagram.

**Opción B · Desde tu computadora**
```bash
npx wrangler login
# creá un archivo .env.local con las variables (sección 3) y luego:
npm run cf:deploy
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
npx wrangler secret put RATE_LIMIT_SALT
```

**Probar localmente con el runtime de Cloudflare:** copiá `.env.local` a `.dev.vars` y ejecutá `npm run cf:preview` (http://localhost:8787).

> Verificado: la suite E2E completa (63 pruebas, proyecto móvil) pasó contra el runtime local de Cloudflare (`workerd`). **No** se ejecutó un despliegue real en tu cuenta de Cloudflare (no hay credenciales). El middleware Node de Next.js 16 (`src/proxy.ts`) figura como *experimental* en el adaptador; funciona en las pruebas y, además, cada página y acción del panel vuelve a comprobar en el servidor que seas administrador, así que no es la única barrera.
>
> *Alternativa:* Vercel también funciona (`next build`), pero su plan gratuito no admite uso comercial.

## 5. Primer uso (Gabo)

Entrá a `https://tu-dominio.com/admin` y cargá, en este orden: **Ajustes → Negocio** (nombre, WhatsApp, dirección, Instagram, logo), **Servicios**, **Ajustes → Horarios** y reglas de reserva. Hasta que haya al menos un servicio activo y un horario, la página pública muestra “Las reservas online todavía no están disponibles”. Guía completa en [`docs/ADMIN.md`](docs/ADMIN.md).

---

## 6. Pruebas

```bash
npm test            # unitarias (zona horaria, motor de disponibilidad, teléfonos, tokens)
npm run stack:up    # base de datos local real para las siguientes
npm run test:db     # integración contra Postgres real (concurrencia, exclusión, RLS de funciones)
npm run test:e2e    # extremo a extremo con Playwright (Chromium): móvil 390px y escritorio 1280px
npm run lint && npm run typecheck
```

Resultados verificados y su correspondencia con la lista de requisitos: [`docs/TESTING.md`](docs/TESTING.md).

## 7. WhatsApp

Hoy se usan enlaces `wa.me` con mensajes precompletados (contactar al local, contactar al cliente, compartir comprobante, avisar cancelaciones/reprogramaciones). **No hay envíos automáticos.** La integración futura con WhatsApp Business Platform está documentada en [`docs/WHATSAPP.md`](docs/WHATSAPP.md).

## 8. Datos pendientes de confirmar

- **Dirección exacta** del local (hoy no se muestra nada si no se carga).
- **WhatsApp del local**, **servicios, precios y duraciones**, **horarios de atención**, **políticas** (anticipación mínima, límite para cancelar): cargarlos en el panel.
- **Identidad visual real:** Instagram bloquea el acceso automático, por lo que no se pudo tomar el logo ni los colores. Se usa un diseño sobrio negro/blanco/gris. El logo se carga desde *Ajustes → Negocio* (enlace a la imagen).
- **Texto de privacidad** (`/privacidad`): redactado de forma breve y general; conviene que lo revise quien asesore al negocio.
- Valores por defecto configurables que elegí como punto de partida: turnos cada 30 min, anticipación mínima 60 min, 30 días de reserva futura, cancelación/reprogramación hasta 2 h antes, máximo 3 turnos activos por teléfono.

## 9. Límites conocidos / futuras versiones

- Una sola agenda/profesional en la interfaz (la base ya admite varios).
- Logo y portada se cargan por enlace (no hay subida de archivos todavía).
- Sin pagos/señas, fidelización, facturación ni estadísticas avanzadas (fuera del MVP).
- El horario de un turno se valida en la grilla de intervalo configurado; el panel no permite agendar fuera de horario laboral.
