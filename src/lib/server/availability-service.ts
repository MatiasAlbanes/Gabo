import "server-only";
import { computeAvailability, dateRange, type DayAvailability, type WorkingInterval } from "@/lib/availability";
import { addDays, todayInTz, zonedToUtcMs } from "@/lib/time";
import type { BusinessSettings, Service } from "@/lib/types";
import { serviceClient } from "@/lib/supabase/service";
import { AppError, mapDbError } from "./errors";

export async function loadSettings(): Promise<BusinessSettings> {
  const { data, error } = await serviceClient().from("business_settings").select("*").eq("id", 1).single();
  if (error || !data) throw mapDbError(error);
  return data as BusinessSettings;
}

/** v1: un solo profesional. La tabla `barbers` permite sumar más sin cambiar el esquema. */
export async function loadBarberId(): Promise<string> {
  const { data, error } = await serviceClient()
    .from("barbers")
    .select("id")
    .eq("active", true)
    .order("sort_order")
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (error) throw mapDbError(error);
  if (!data) throw new AppError("barber_unavailable");
  return data.id as string;
}

export async function loadActiveService(id: string): Promise<Service> {
  const { data, error } = await serviceClient().from("services").select("*").eq("id", id).eq("active", true).maybeSingle();
  if (error) throw mapDbError(error);
  if (!data) throw new AppError("service_unavailable");
  return data as Service;
}

export type AvailabilityParams = {
  service: { durationMinutes: number; bufferMinutes: number };
  from: string;
  days: number;
  /** public: aplica anticipación mínima y días máximos. admin: sin esos límites. */
  mode: "public" | "admin";
  excludeAppointmentId?: string;
  nowMs?: number;
};

export async function getAvailability(p: AvailabilityParams): Promise<{ days: DayAvailability[]; settings: BusinessSettings }> {
  const sb = serviceClient();
  const settings = await loadSettings();
  const nowMs = p.nowMs ?? Date.now();
  const tz = settings.timezone;
  if (p.mode === "public" && !settings.booking_enabled) {
    // Reservas pausadas: no se ofrece ningún horario.
    return { days: dateRange(p.from, p.days).map((date) => ({ date, slots: [] })), settings };
  }
  const barberId = await loadBarberId();

  const today = todayInTz(nowMs, tz);
  const from = p.from < today ? today : p.from;
  const dates = dateRange(from, p.days);
  const to = dates[dates.length - 1];
  const winStart = new Date(zonedToUtcMs(from, 0, tz)).toISOString();
  const winEnd = new Date(zonedToUtcMs(addDays(to, 1), 0, tz)).toISOString();

  let busyQ = sb
    .from("appointments")
    .select("start_at,occupied_until")
    .eq("barber_id", barberId)
    .in("status", ["confirmed", "completed"])
    .lt("start_at", winEnd)
    .gt("occupied_until", winStart);
  if (p.excludeAppointmentId) busyQ = busyQ.neq("id", p.excludeAppointmentId);

  const [hours, off, blocks, busy] = await Promise.all([
    sb.from("working_hours").select("weekday,start_minute,end_minute").eq("barber_id", barberId),
    sb.from("time_off").select("start_date,end_date").eq("barber_id", barberId).lte("start_date", to).gte("end_date", from),
    sb.from("time_blocks").select("start_at,end_at").eq("barber_id", barberId).lt("start_at", winEnd).gt("end_at", winStart),
    busyQ,
  ]);
  for (const r of [hours, off, blocks, busy]) if (r.error) throw mapDbError(r.error);

  const workingHours: WorkingInterval[] = (hours.data ?? []).map((h) => ({ weekday: h.weekday, startMinute: h.start_minute, endMinute: h.end_minute }));

  const result = computeAvailability({
    tz,
    nowMs,
    dates,
    service: p.service,
    intervalMinutes: settings.slot_interval_minutes,
    minNoticeMinutes: p.mode === "public" ? settings.min_notice_minutes : 0,
    maxDaysAhead: p.mode === "public" ? settings.max_days_ahead : null,
    workingHours,
    timeOff: (off.data ?? []).map((t) => ({ startDate: t.start_date, endDate: t.end_date })),
    blocks: (blocks.data ?? []).map((b) => ({ startMs: Date.parse(b.start_at), endMs: Date.parse(b.end_at) })),
    busy: (busy.data ?? []).map((b) => ({ startMs: Date.parse(b.start_at), occupiedUntilMs: Date.parse(b.occupied_until) })),
  });
  return { days: result, settings };
}
