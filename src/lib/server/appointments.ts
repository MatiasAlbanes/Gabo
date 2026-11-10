import "server-only";
import { APPOINTMENT_COLUMNS, type Appointment, type PublicAppointment } from "@/lib/types";
import { MINUTE, formatTimeInTz, utcToZoned, zonedToUtcMs, hhmmToMinutes } from "@/lib/time";
import { normalizePhone } from "@/lib/phone";
import { generateToken, hashToken, TOKEN_PATTERN } from "@/lib/token";
import { serviceClient } from "@/lib/supabase/service";
import { AppError, mapDbError } from "./errors";
import { getAvailability, loadActiveService, loadBarberId, loadSettings } from "./availability-service";

/** Quita campos internos (p. ej. token_hash) de una fila devuelta por las funciones SQL. */
export function sanitize(row: Record<string, unknown>): Appointment {
  const out: Record<string, unknown> = {};
  for (const c of APPOINTMENT_COLUMNS.split(",")) out[c] = row[c];
  return out as Appointment;
}

export function toPublic(a: Appointment, tz: string): PublicAppointment {
  const start = Date.parse(a.start_at);
  const z = utcToZoned(start, tz);
  return {
    serviceName: a.service_name,
    priceArs: a.service_price_ars,
    durationMinutes: a.duration_minutes,
    clientName: a.client_name,
    date: z.date,
    time: formatTimeInTz(start, tz),
    endTime: formatTimeInTz(Date.parse(a.end_at), tz),
    startAt: a.start_at,
    status: a.status,
  };
}

export type NewBooking = { serviceId: string; date: string; time: string; name: string; phone: string; source: "online" | "admin"; notes?: string };

export async function createBooking(input: NewBooking): Promise<{ appointment: Appointment; token: string }> {
  const phone = normalizePhone(input.phone);
  if (!phone) throw new AppError("invalid", "El número de WhatsApp no es válido. Probá con código de área, por ejemplo 261 5123456.");

  const [service, settings, barberId] = await Promise.all([loadActiveService(input.serviceId), loadSettings(), loadBarberId()]);
  const mode = input.source === "admin" ? "admin" : "public";

  // 1) El servidor recalcula la disponibilidad real: el horario debe estar en la grilla ofrecida.
  const { days } = await getAvailability({
    service: { durationMinutes: service.duration_minutes, bufferMinutes: service.buffer_minutes },
    from: input.date,
    days: 1,
    mode,
  });
  if (days[0]?.date !== input.date || !days[0].slots.includes(input.time)) throw new AppError("slot_unavailable");

  // 2) La base de datos vuelve a validar y escribe de forma transaccional.
  const token = generateToken();
  const startIso = new Date(zonedToUtcMs(input.date, hhmmToMinutes(input.time), settings.timezone)).toISOString();
  const { data, error } = await serviceClient().rpc("book_appointment", {
    p_barber: barberId,
    p_service: service.id,
    p_name: input.name,
    p_phone: phone,
    p_start: startIso,
    p_token_hash: hashToken(token),
    p_source: input.source,
    p_notes: input.notes ?? null,
  });
  if (error || !data) throw mapDbError(error);
  return { appointment: sanitize(data as Record<string, unknown>), token };
}

export async function findByToken(token: string): Promise<Appointment | null> {
  if (!TOKEN_PATTERN.test(token)) return null;
  const { data, error } = await serviceClient().from("appointments").select(APPOINTMENT_COLUMNS).eq("token_hash", hashToken(token)).maybeSingle();
  if (error) throw mapDbError(error);
  return (data as Appointment | null) ?? null;
}

export async function cancelByToken(token: string): Promise<Appointment> {
  const a = await findByToken(token);
  if (!a) throw new AppError("not_found");
  const { data, error } = await serviceClient().rpc("cancel_appointment", { p_id: a.id, p_by: "client" });
  if (error || !data) throw mapDbError(error);
  return sanitize(data as Record<string, unknown>);
}

export async function availabilityForAppointment(a: Appointment, from: string, days: number, mode: "public" | "admin") {
  return getAvailability({
    service: { durationMinutes: a.duration_minutes, bufferMinutes: a.buffer_minutes },
    from,
    days,
    mode,
    excludeAppointmentId: a.id,
  });
}

export async function rescheduleAppointment(a: Appointment, date: string, time: string, by: "client" | "admin"): Promise<Appointment> {
  const settings = await loadSettings();
  const { days } = await availabilityForAppointment(a, date, 1, by === "client" ? "public" : "admin");
  if (days[0]?.date !== date || !days[0].slots.includes(time)) throw new AppError("slot_unavailable");
  const startIso = new Date(zonedToUtcMs(date, hhmmToMinutes(time), settings.timezone)).toISOString();
  const { data, error } = await serviceClient().rpc("move_appointment", { p_id: a.id, p_new_start: startIso, p_by: by });
  if (error || !data) throw mapDbError(error);
  return sanitize(data as Record<string, unknown>);
}

/** ¿Puede el cliente modificar/cancelar este turno según la política vigente? */
export function clientCanModify(a: Appointment, cancelNoticeHours: number, nowMs = Date.now()): boolean {
  return a.status === "confirmed" && Date.parse(a.start_at) >= nowMs + cancelNoticeHours * 60 * MINUTE;
}
