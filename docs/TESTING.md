# Resultados de pruebas

Ejecutadas en esta máquina contra un stack local real (Postgres 16 + GoTrue + PostgREST con las migraciones del proyecto). **No se probó contra un proyecto Supabase en la nube ni contra un despliegue real en Cloudflare/Vercel** (no hay credenciales).

| Suite | Comando | Resultado |
|---|---|---|
| Unitarias (zona horaria, disponibilidad, teléfonos, tokens) | `npm test` | **39 / 39 OK** |
| Integración en Postgres real (restricciones, concurrencia, políticas) | `npm run test:db` | **19 / 19 OK** |
| Extremo a extremo, Chromium (móvil 390px + escritorio 1280px) | `npm run test:e2e` | **111 OK, 15 omitidas** (las 15 son las pruebas de tamaños, que corren solo en el proyecto “mobile” porque recorren 5 anchos dentro de la prueba) |
| E2E contra el runtime de Cloudflare (`workerd`, proyecto móvil) | `npm run cf:preview` + `E2E_BASE_URL=http://localhost:8787 npx playwright test --project=mobile` | **63 / 63 OK** |
| Lint / tipos / build de producción | `npm run lint`, `npm run typecheck`, `npm run build` | OK |

## Correspondencia con la lista de verificación

| # | Requisito | Dónde se verifica |
|---|---|---|
| 1 | Un cliente puede reservar | e2e `public-booking` · reserva completa en una sola página |
| 2 | Se guarda en la base | mismo test (consulta SQL de la fila, copia histórica del servicio) |
| 3 | Aparece en el panel | e2e `public-booking` · “el turno aparece en el panel” |
| 4 | El horario deja de estar disponible | e2e `public-booking` (UI y API) |
| 5 | No hay reservas superpuestas | db: superposición parcial/total, inserción directa (restricción de exclusión), **20 solicitudes simultáneas → 1 confirmada**; e2e: 6 simultáneas por HTTP → 1×201 y 5×409 |
| 6 | Distintas duraciones | unit `availability` (30/60/90 min, buffer) · db · e2e (servicio de 60 min bloquea dos horarios) |
| 7 | Gabo crea reservas manuales | e2e `admin` · “crea un turno manual” |
| 8 | Gabo bloquea horarios | e2e `admin` · “bloquea un horario y un día libre” |
| 9 | Los bloqueos afectan la disponibilidad pública | mismo test + e2e `public-booking` |
| 10 | El cliente cancela con su enlace | e2e `manage-link` · cancelación (libera horario, conserva historial) |
| 11 | El cliente reprograma sin conflictos | e2e `manage-link` · reprogramar; destino ocupado → 409 y el original no cambia; db: atómico y concurrente |
| 12 | Los datos persisten al recargar | e2e (recargas en panel y enlace privado; todo vive en Postgres) |
| 13 | Sin sesión no se entra al panel | e2e `admin` · acceso (7 rutas redirigen), credenciales erróneas, usuario válido que no es admin |
| 14 | No se ven reservas ajenas | e2e `manage-link` (tokens inventados/secuenciales/alterados) y `security` (RLS anónimo y autenticado no-admin) |
| 15 | Funciona en celulares | e2e en **Chromium con emulación móvil** (390×844, táctil) y anchos 320/360/390/768/1280. **No** se probó en iPhone/Android reales ni en Safari/Firefox |
| 16 | Nada fuera del horario laboral | unit · db (`outside_hours`, descanso, cruce de descanso) · e2e (HTTP directo con horas inválidas) |
| 17 | Zona horaria argentina | unit (UTC‑3, cambio de día) · e2e (10:00 locales = 13:00 UTC en la base) |
| 18 | Cambios de servicios visibles en la página pública | e2e `admin` (crear/editar/ordenar/desactivar) y `public-booking` |
| 19 | Errores de conexión | e2e `security` · peticiones abortadas: mensaje + reintento; confirmación fallida ⇒ no se muestra confirmado y no se guarda nada |
| 20 | Distintos tamaños de pantalla | e2e `layout` · sin desbordes, 7 días siempre visibles, botones ≥ 44 px, campos de 16 px (sin zoom en iOS) — público y panel |

## Seguridad verificada
- Anónimo: no lee `appointments`, `time_off`, `time_blocks`, `admin_users`, `rate_limits`; no inserta ni ejecuta `book_appointment`; no modifica servicios.
- Usuario autenticado **que no es administrador**: 0 filas de turnos, no modifica nada.
- La API de disponibilidad devuelve solo `{date, slots}`; la clave `service_role` y `token_hash` no aparecen en lo que recibe el navegador.
- Límite de solicitudes (429), honeypot, validación de entradas, límite de turnos activos por teléfono, cabeceras de seguridad, enlaces privados con `noindex`/`no-store`.
- La política de cancelación se hace cumplir en el servidor y la base (no solo ocultando botones).

## Hallazgos corregidos durante las pruebas
- Una función de UI de cliente se invocaba desde páginas de servidor del panel (fallaba la agenda) → movida a un módulo neutro.
- Cerrar sesión invalidaba la sesión en **todos** los dispositivos → ahora cierra solo el actual.
- Un horario que desaparecía mientras el cliente completaba el formulario ocultaba el formulario sin explicación → ahora avisa “se acaba de ocupar”.
- Con las reservas pausadas la API aún ofrecía horarios → ahora no ofrece ninguno.

## No cubierto (por honestidad)
- Nube real de Supabase y despliegue real en Cloudflare; cabeceras HTTPS reales de producción.
- Navegadores WebKit/Firefox y dispositivos físicos; pruebas con lector de pantalla (se usaron roles/etiquetas ARIA, `<dialog>` nativo y foco visible, pero no hay auditoría de accesibilidad formal).
- Pruebas de carga.
- `npm audit` reporta una advertencia moderada solo en dependencias de desarrollo (lint), sin impacto en producción.
