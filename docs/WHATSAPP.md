# WhatsApp

## Qué hay hoy (sin credenciales ni costos)
Enlaces `https://wa.me/<número>?text=<mensaje>` con el mensaje ya escrito:

| Dónde | Para qué |
|---|---|
| Cabecera de la página pública | El cliente escribe al local. |
| Confirmación del turno | El cliente comparte su comprobante. |
| Turno en el panel | Gabo escribe al cliente. |
| Tras crear / cancelar / reprogramar | Gabo envía confirmación o aviso con un toque. |
| Cambios de agenda que cancelan turnos | Un enlace de aviso por cada cliente afectado. |

Los textos están en `src/lib/whatsapp.ts` (`messages`). Los números se normalizan a E.164 y, para Argentina, a formato móvil `+549…` (el que exige WhatsApp).

**No hay envíos automáticos.** Cada mensaje lo envía una persona al tocar el enlace.

## Integración futura: WhatsApp Business Platform (pendiente)
Requiere una cuenta de Meta Business, un número verificado, plantillas de mensaje aprobadas y un token. Nada de eso existe todavía, por eso no se implementó ni se simuló.

Puntos de extensión ya preparados:
- Interfaz `WhatsAppNotifier` (`src/lib/whatsapp.ts`): `sendConfirmation`, `sendReminder`, `sendCancellation`, `sendReschedule`.
- Los lugares donde hoy se genera un enlace de aviso (`src/app/admin/actions.ts`: crear, cancelar, reprogramar, conflictos de agenda; `src/app/api/bookings/route.ts` para la confirmación) son los puntos donde llamar al notificador.
- Recordatorios: crear una función programada (Vercel Cron o Supabase `pg_cron`) que consulte turnos `confirmed` con `start_at` en las próximas 24 h y llame a `sendReminder`. Conviene agregar una columna `reminder_sent_at` en `appointments` para no duplicar envíos.
- Variables previstas: `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_WEBHOOK_VERIFY_TOKEN`.
