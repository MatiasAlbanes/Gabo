"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { appointmentFitsSchedule, type ScheduleContext } from "@/lib/availability";
import { normalizePhone } from "@/lib/phone";
import { hhmmToMinutes, todayInTz, zonedToUtcMs } from "@/lib/time";
import { generateToken, hashToken } from "@/lib/token";
import { APPOINTMENT_COLUMNS, type Appointment } from "@/lib/types";
import { adminBookingSchema, dateStr, timeStr, uuid } from "@/lib/validation";
import { messages, waLink } from "@/lib/whatsapp";
import { sessionClient } from "@/lib/supabase/server";
import { getAdmin, requireAdminAction } from "@/lib/server/admin";
import { toAdminView } from "@/lib/server/admin-data";
import { createBooking, rescheduleAppointment } from "@/lib/server/appointments";
import { AppError, mapDbError } from "@/lib/server/errors";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { siteUrlFromHeaders } from "@/lib/server/http";
import { getAvailability, loadActiveService, loadBarberId, loadSettings } from "@/lib/server/availability-service";
import type { DayAvailability } from "@/lib/availability";

// ---------------------------------------------------------------------------
// Tipos y utilidades
// ---------------------------------------------------------------------------
export type NoticeLink = { label: string; url: string };
export type ConflictItem = { id: string; clientName: string; phoneDisplay: string; serviceName: string; date: string; time: string };
export type ActionResult<T = undefined> =
  | { ok: true; data?: T; notices?: NoticeLink[] }
  | { ok: false; error: string; conflicts?: ConflictItem[] };
export type Resolutions = Record<string, "keep" | "cancel">;

async function run<T>(fn: () => Promise<{ data?: T; notices?: NoticeLink[] } | void>): Promise<ActionResult<T>> {
  try {
    const out = (await fn()) ?? {};
    revalidatePath("/admin", "layout");
    return { ok: true, data: out.data, notices: out.notices };
  } catch (e) {
    if (e instanceof AppError) return { ok: false, error: e.message };
    if (e instanceof z.ZodError) return { ok: false, error: e.issues[0]?.message ?? "Revisá los datos ingresados." };
    console.error("[admin-action]", e);
    return { ok: false, error: "Algo salió mal. Probá de nuevo." };
  }
}

const dbThrow = (error: { message?: string; code?: string } | null) => {
  if (error) throw mapDbError(error);
};

// ---------------------------------------------------------------------------
// Sesión
// ---------------------------------------------------------------------------
export async function loginAction(_prev: { error?: string } | null, form: FormData): Promise<{ error?: string }> {
  const email = String(form.get("email") ?? "").trim();
  const password = String(form.get("password") ?? "");
  try {
    await enforceRateLimit(await headers(), "login", 10, 900);
  } catch {
    return { error: "Demasiados intentos. Esperá unos minutos." };
  }
  if (!email || !password) return { error: "Ingresá tu correo y contraseña." };
  const sb = await sessionClient();
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) return { error: "Correo o contraseña incorrectos." };
  if (!(await getAdmin())) {
    await sb.auth.signOut({ scope: "local" }); // solo este dispositivo
    return { error: "Esta cuenta no tiene acceso al panel." };
  }
  redirect("/admin");
}

export async function logoutAction() {
  const sb = await sessionClient();
  await sb.auth.signOut({ scope: "local" }); // solo este dispositivo
  redirect("/admin/login");
}

// ---------------------------------------------------------------------------
// Disponibilidad para el panel (sin anticipación mínima ni límite de días)
// ---------------------------------------------------------------------------
export async function adminSlotsAction(input: { serviceId?: string; appointmentId?: string; from: string; days: number }): Promise<ActionResult<DayAvailability[]>> {
  return run(async () => {
    const { sb } = await requireAdminAction();
    const p = z.object({ serviceId: uuid.optional(), appointmentId: uuid.optional(), from: dateStr, days: z.number().int().min(1).max(92) }).parse(input);
    let service: { durationMinutes: number; bufferMinutes: number };
    if (p.appointmentId) {
      const { data, error } = await sb.from("appointments").select("duration_minutes,buffer_minutes").eq("id", p.appointmentId).single();
      dbThrow(error);
      service = { durationMinutes: data!.duration_minutes, bufferMinutes: data!.buffer_minutes };
    } else if (p.serviceId) {
      const s = await loadActiveService(p.serviceId);
      service = { durationMinutes: s.duration_minutes, bufferMinutes: s.buffer_minutes };
    } else throw new AppError("invalid");
    const { days } = await getAvailability({ service, from: p.from, days: p.days, mode: "admin", excludeAppointmentId: p.appointmentId });
    return { data: days };
  });
}

// ---------------------------------------------------------------------------
// Turnos
// ---------------------------------------------------------------------------
export async function createAppointmentAction(input: z.infer<typeof adminBookingSchema>): Promise<ActionResult> {
  return run(async () => {
    await requireAdminAction();
    const body = adminBookingSchema.parse(input);
    const { appointment, token } = await createBooking({ ...body, source: "admin" });
    const settings = await loadSettings();
    const url = `${siteUrlFromHeaders(await headers())}/turno/${token}`;
    const link = waLink(appointment.client_phone, messages.confirmation(appointment, settings.timezone, settings.name, url));
    return { notices: [{ label: `Enviar confirmación a ${appointment.client_name} por WhatsApp`, url: link }] };
  });
}

async function loadAppointment(id: string): Promise<Appointment> {
  const { sb } = await requireAdminAction();
  const { data, error } = await sb.from("appointments").select(APPOINTMENT_COLUMNS).eq("id", id).maybeSingle();
  dbThrow(error);
  if (!data) throw new AppError("not_found");
  return data as Appointment;
}

export async function setStatusAction(input: { id: string; status: "confirmed" | "completed" | "cancelled" | "no_show" }): Promise<ActionResult> {
  return run(async () => {
    const { sb } = await requireAdminAction();
    const p = z.object({ id: uuid, status: z.enum(["confirmed", "completed", "cancelled", "no_show"]) }).parse(input);
    const patch =
      p.status === "cancelled"
        ? { status: p.status, cancelled_at: new Date().toISOString(), cancelled_by: "admin" }
        : { status: p.status, cancelled_at: null, cancelled_by: null };
    const { data, error } = await sb.from("appointments").update(patch).eq("id", p.id).select(APPOINTMENT_COLUMNS).single();
    dbThrow(error);
    if (p.status === "cancelled") {
      const settings = await loadSettings();
      const a = data as Appointment;
      return { notices: [{ label: `Avisar a ${a.client_name} por WhatsApp`, url: waLink(a.client_phone, messages.cancelled(a, settings.timezone, settings.name)) }] };
    }
  });
}

export async function rescheduleAction(input: { id: string; date: string; time: string }): Promise<ActionResult> {
  return run(async () => {
    const p = z.object({ id: uuid, date: dateStr, time: timeStr }).parse(input);
    const appt = await loadAppointment(p.id);
    const updated = await rescheduleAppointment(appt, p.date, p.time, "admin");
    const settings = await loadSettings();
    return { notices: [{ label: `Avisar a ${updated.client_name} por WhatsApp`, url: waLink(updated.client_phone, messages.rescheduled(updated, settings.timezone, settings.name)) }] };
  });
}

export async function updateNotesAction(input: { id: string; notes: string }): Promise<ActionResult> {
  return run(async () => {
    const { sb } = await requireAdminAction();
    const p = z.object({ id: uuid, notes: z.string().max(500) }).parse(input);
    const { error } = await sb.from("appointments").update({ notes: p.notes.trim() || null }).eq("id", p.id);
    dbThrow(error);
  });
}

/** El token real nunca se guarda: para entregar de nuevo el enlace se genera uno nuevo (invalida el anterior). */
export async function regenerateLinkAction(input: { id: string }): Promise<ActionResult<{ url: string; waUrl: string }>> {
  return run(async () => {
    const { sb } = await requireAdminAction();
    const id = uuid.parse(input.id);
    const token = generateToken();
    const { data, error } = await sb.from("appointments").update({ token_hash: hashToken(token) }).eq("id", id).select(APPOINTMENT_COLUMNS).single();
    dbThrow(error);
    const settings = await loadSettings();
    const url = `${siteUrlFromHeaders(await headers())}/turno/${token}`;
    const a = data as Appointment;
    return { data: { url, waUrl: waLink(a.client_phone, messages.confirmation(a, settings.timezone, settings.name, url)) } };
  });
}

// ---------------------------------------------------------------------------
// Conflictos: nunca se eliminan reservas en silencio
// ---------------------------------------------------------------------------
async function loadScheduleContext(sb: Awaited<ReturnType<typeof sessionClient>>, barberId: string, tz: string): Promise<ScheduleContext> {
  const today = todayInTz(Date.now(), tz);
  const [h, o, b] = await Promise.all([
    sb.from("working_hours").select("weekday,start_minute,end_minute").eq("barber_id", barberId),
    sb.from("time_off").select("start_date,end_date").eq("barber_id", barberId).gte("end_date", today),
    sb.from("time_blocks").select("start_at,end_at").eq("barber_id", barberId).gt("end_at", new Date().toISOString()),
  ]);
  for (const r of [h, o, b]) dbThrow(r.error);
  return {
    tz,
    workingHours: (h.data ?? []).map((x) => ({ weekday: x.weekday, startMinute: x.start_minute, endMinute: x.end_minute })),
    timeOff: (o.data ?? []).map((x) => ({ startDate: x.start_date, endDate: x.end_date })),
    blocks: (b.data ?? []).map((x) => ({ startMs: Date.parse(x.start_at), endMs: Date.parse(x.end_at) })),
  };
}

/**
 * Aplica un cambio de agenda protegiendo los turnos confirmados.
 * 1) Calcula qué turnos futuros dejarían de encajar. 2) Si hay alguno sin resolución explícita
 * (mantener / cancelar), devuelve la lista y NO cambia nada. 3) Si no, aplica el cambio y cancela
 * solo los que se pidió cancelar, devolviendo enlaces para avisarles por WhatsApp.
 */
async function guardedScheduleChange(
  propose: (current: ScheduleContext) => ScheduleContext,
  apply: () => Promise<void>,
  resolutions: Resolutions | undefined,
): Promise<ActionResult> {
  const { sb } = await requireAdminAction();
  const settings = await loadSettings();
  const barberId = await loadBarberId();
  const current = await loadScheduleContext(sb, barberId, settings.timezone);
  const proposed = propose(current);

  const { data, error } = await sb.from("appointments").select(APPOINTMENT_COLUMNS).eq("status", "confirmed").gt("end_at", new Date().toISOString());
  dbThrow(error);
  const affected = ((data ?? []) as Appointment[]).filter((a) => {
    const r = { startMs: Date.parse(a.start_at), endMs: Date.parse(a.end_at) };
    return appointmentFitsSchedule(r, current) && !appointmentFitsSchedule(r, proposed);
  });

  if (affected.some((a) => !resolutions?.[a.id])) {
    return {
      ok: false,
      error: "Hay turnos confirmados que quedarían afectados. Elegí qué hacer con cada uno.",
      conflicts: affected.map((a) => {
        const v = toAdminView(a, settings);
        return { id: a.id, clientName: a.client_name, phoneDisplay: v.phoneDisplay, serviceName: a.service_name, date: v.date, time: v.time };
      }),
    };
  }

  await apply();

  const notices: NoticeLink[] = [];
  for (const a of affected.filter((x) => resolutions?.[x.id] === "cancel")) {
    const { error: e } = await sb.from("appointments").update({ status: "cancelled", cancelled_at: new Date().toISOString(), cancelled_by: "admin" }).eq("id", a.id);
    dbThrow(e);
    notices.push({ label: `Avisar a ${a.client_name} por WhatsApp`, url: waLink(a.client_phone, messages.cancelled(a, settings.timezone, settings.name)) });
  }
  revalidatePath("/admin", "layout");
  return { ok: true, notices };
}

const resolutionsSchema = z.record(z.string(), z.enum(["keep", "cancel"])).optional();

async function guarded(fn: () => Promise<ActionResult>): Promise<ActionResult> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof AppError) return { ok: false, error: e.message };
    if (e instanceof z.ZodError) return { ok: false, error: e.issues[0]?.message ?? "Revisá los datos ingresados." };
    console.error("[admin-action]", e);
    return { ok: false, error: "Algo salió mal. Probá de nuevo." };
  }
}

// ---------------------------------------------------------------------------
// Horarios semanales
// ---------------------------------------------------------------------------
const hoursSchema = z.array(
  z.object({ weekday: z.number().int().min(1).max(7), startMinute: z.number().int().min(0).max(1439), endMinute: z.number().int().min(1).max(1440) }).refine((h) => h.startMinute < h.endMinute, "La hora de cierre debe ser posterior a la de apertura."),
);

export async function saveWorkingHoursAction(input: { hours: z.infer<typeof hoursSchema>; resolutions?: Resolutions }): Promise<ActionResult> {
  return guarded(async () => {
    const { sb } = await requireAdminAction();
    const hours = hoursSchema.parse(input.hours);
    const resolutions = resolutionsSchema.parse(input.resolutions);
    for (let wd = 1; wd <= 7; wd++) {
      const day = hours.filter((h) => h.weekday === wd).sort((a, b) => a.startMinute - b.startMinute);
      for (let i = 1; i < day.length; i++) if (day[i].startMinute < day[i - 1].endMinute) throw new AppError("invalid", "Hay tramos horarios que se superponen en un mismo día.");
    }
    const barberId = await loadBarberId();
    return guardedScheduleChange(
      (cur) => ({ ...cur, workingHours: hours }),
      async () => {
        const { error } = await sb.rpc("save_working_hours", {
          p_barber: barberId,
          p_hours: hours.map((h) => ({ weekday: h.weekday, start_minute: h.startMinute, end_minute: h.endMinute })),
        });
        dbThrow(error);
      },
      resolutions,
    );
  });
}

const policySchema = z.object({
  slot_interval_minutes: z.number().int().min(5).max(240),
  min_notice_minutes: z.number().int().min(0).max(60 * 24 * 30),
  max_days_ahead: z.number().int().min(1).max(365),
  cancel_notice_hours: z.number().int().min(0).max(24 * 30),
  max_active_per_phone: z.number().int().min(1).max(20),
  booking_enabled: z.boolean(),
});

export async function savePoliciesAction(input: z.infer<typeof policySchema>): Promise<ActionResult> {
  return run(async () => {
    const { sb } = await requireAdminAction();
    const p = policySchema.parse(input);
    const { error } = await sb.from("business_settings").update(p).eq("id", 1);
    dbThrow(error);
  });
}

// ---------------------------------------------------------------------------
// Días libres, feriados, vacaciones y bloqueos
// ---------------------------------------------------------------------------
export async function addTimeOffAction(input: { kind: "day_off" | "holiday" | "vacation"; startDate: string; endDate: string; reason?: string; resolutions?: Resolutions }): Promise<ActionResult> {
  return guarded(async () => {
    const { sb } = await requireAdminAction();
    const p = z.object({ kind: z.enum(["day_off", "holiday", "vacation"]), startDate: dateStr, endDate: dateStr, reason: z.string().max(200).optional() }).parse(input);
    if (p.endDate < p.startDate) throw new AppError("invalid", "La fecha final no puede ser anterior a la inicial.");
    const barberId = await loadBarberId();
    return guardedScheduleChange(
      (cur) => ({ ...cur, timeOff: [...cur.timeOff, { startDate: p.startDate, endDate: p.endDate }] }),
      async () => {
        const { error } = await sb.from("time_off").insert({ barber_id: barberId, kind: p.kind, start_date: p.startDate, end_date: p.endDate, reason: p.reason?.trim() || null });
        dbThrow(error);
      },
      resolutionsSchema.parse(input.resolutions),
    );
  });
}

export async function deleteTimeOffAction(input: { id: string }): Promise<ActionResult> {
  return run(async () => {
    const { sb } = await requireAdminAction();
    const { error } = await sb.from("time_off").delete().eq("id", uuid.parse(input.id));
    dbThrow(error);
  });
}

export async function addBlockAction(input: { date: string; start: string; end: string; reason?: string; resolutions?: Resolutions }): Promise<ActionResult> {
  return guarded(async () => {
    const { sb } = await requireAdminAction();
    const p = z.object({ date: dateStr, start: timeStr, end: timeStr, reason: z.string().max(200).optional() }).parse(input);
    if (hhmmToMinutes(p.end) <= hhmmToMinutes(p.start)) throw new AppError("invalid", "La hora final debe ser posterior a la inicial.");
    const settings = await loadSettings();
    const barberId = await loadBarberId();
    const startMs = zonedToUtcMs(p.date, hhmmToMinutes(p.start), settings.timezone);
    const endMs = zonedToUtcMs(p.date, hhmmToMinutes(p.end), settings.timezone);
    if (endMs <= Date.now()) throw new AppError("invalid", "Ese bloqueo está en el pasado.");
    return guardedScheduleChange(
      (cur) => ({ ...cur, blocks: [...cur.blocks, { startMs, endMs }] }),
      async () => {
        const { error } = await sb.from("time_blocks").insert({ barber_id: barberId, start_at: new Date(startMs).toISOString(), end_at: new Date(endMs).toISOString(), reason: p.reason?.trim() || null });
        dbThrow(error);
      },
      resolutionsSchema.parse(input.resolutions),
    );
  });
}

export async function deleteBlockAction(input: { id: string }): Promise<ActionResult> {
  return run(async () => {
    const { sb } = await requireAdminAction();
    const { error } = await sb.from("time_blocks").delete().eq("id", uuid.parse(input.id));
    dbThrow(error);
  });
}

// ---------------------------------------------------------------------------
// Servicios
// ---------------------------------------------------------------------------
const serviceSchema = z.object({
  id: uuid.optional(),
  name: z.string().trim().min(1, "Poné un nombre.").max(80),
  description: z.string().trim().max(300).optional(),
  priceArs: z.number().int().min(0, "El precio no puede ser negativo.").max(100_000_000),
  durationMinutes: z.number().int().min(5, "La duración mínima es 5 minutos.").max(480),
  bufferMinutes: z.number().int().min(0).max(120),
  active: z.boolean(),
});

export async function saveServiceAction(input: z.infer<typeof serviceSchema>): Promise<ActionResult> {
  return run(async () => {
    const { sb } = await requireAdminAction();
    const p = serviceSchema.parse(input);
    const row = { name: p.name, description: p.description || null, price_ars: p.priceArs, duration_minutes: p.durationMinutes, buffer_minutes: p.bufferMinutes, active: p.active };
    if (p.id) {
      const { error } = await sb.from("services").update(row).eq("id", p.id);
      dbThrow(error);
    } else {
      const { data } = await sb.from("services").select("sort_order").order("sort_order", { ascending: false }).limit(1);
      const { error } = await sb.from("services").insert({ ...row, sort_order: (data?.[0]?.sort_order ?? 0) + 1 });
      dbThrow(error);
    }
  });
}

export async function moveServiceAction(input: { id: string; direction: "up" | "down" }): Promise<ActionResult> {
  return run(async () => {
    const { sb } = await requireAdminAction();
    const { data, error } = await sb.from("services").select("id,sort_order").order("sort_order").order("created_at");
    dbThrow(error);
    const list = data ?? [];
    const i = list.findIndex((s) => s.id === input.id);
    const j = input.direction === "up" ? i - 1 : i + 1;
    if (i < 0 || j < 0 || j >= list.length) return;
    // Reasigna posiciones consecutivas para evitar empates.
    const order = list.map((s) => s.id);
    [order[i], order[j]] = [order[j], order[i]];
    for (let k = 0; k < order.length; k++) {
      const { error: e } = await sb.from("services").update({ sort_order: k + 1 }).eq("id", order[k]);
      dbThrow(e);
    }
  });
}

// ---------------------------------------------------------------------------
// Datos del negocio
// ---------------------------------------------------------------------------
const optionalUrl = z
  .string()
  .trim()
  .max(500)
  .refine((v) => v === "" || /^https?:\/\//i.test(v), "Los enlaces deben empezar con http:// o https://");

const businessSchema = z.object({
  name: z.string().trim().min(1, "Poné el nombre del negocio.").max(80),
  description: z.string().trim().max(500),
  address: z.string().trim().max(200),
  whatsapp: z.string().trim().max(30),
  instagramUrl: optionalUrl,
  logoUrl: optionalUrl,
  coverUrl: optionalUrl,
});

export async function saveBusinessAction(input: z.infer<typeof businessSchema>): Promise<ActionResult> {
  return run(async () => {
    const { sb } = await requireAdminAction();
    const p = businessSchema.parse(input);
    let whatsapp: string | null = null;
    if (p.whatsapp) {
      whatsapp = normalizePhone(p.whatsapp);
      if (!whatsapp) throw new AppError("invalid", "El número de WhatsApp no es válido. Ej: 261 5123456");
    }
    const { error } = await sb
      .from("business_settings")
      .update({
        name: p.name,
        description: p.description || null,
        address: p.address || null,
        whatsapp,
        instagram_url: p.instagramUrl || null,
        logo_url: p.logoUrl || null,
        cover_url: p.coverUrl || null,
      })
      .eq("id", 1);
    dbThrow(error);
    revalidatePath("/");
  });
}
