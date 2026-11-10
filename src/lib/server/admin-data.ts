import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { APPOINTMENT_COLUMNS, type Appointment, type BusinessSettings } from "@/lib/types";
import { addDays, formatTimeInTz, utcToZoned, zonedToUtcMs } from "@/lib/time";
import { formatPhone } from "@/lib/phone";
import { messages, waLink } from "@/lib/whatsapp";

/** Turno + campos ya calculados para mostrar en el panel. */
export type AdminAppt = Appointment & {
  date: string;
  time: string;
  endTime: string;
  phoneDisplay: string;
  waUrl: string;
};

export function toAdminView(a: Appointment, settings: Pick<BusinessSettings, "timezone" | "name">): AdminAppt {
  const start = Date.parse(a.start_at);
  const tz = settings.timezone;
  return {
    ...a,
    date: utcToZoned(start, tz).date,
    time: formatTimeInTz(start, tz),
    endTime: formatTimeInTz(Date.parse(a.end_at), tz),
    phoneDisplay: formatPhone(a.client_phone),
    waUrl: waLink(a.client_phone, messages.generic({ client_name: a.client_name, service_name: a.service_name, start_at: a.start_at }, settings.name)),
  };
}

/** Turnos cuyo inicio cae entre dos fechas locales (inclusive). */
export async function loadAppointmentsBetween(sb: SupabaseClient, from: string, to: string, tz: string, status?: string[]) {
  let q = sb
    .from("appointments")
    .select(APPOINTMENT_COLUMNS)
    .gte("start_at", new Date(zonedToUtcMs(from, 0, tz)).toISOString())
    .lt("start_at", new Date(zonedToUtcMs(addDays(to, 1), 0, tz)).toISOString())
    .order("start_at");
  if (status) q = q.in("status", status);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as Appointment[];
}

export async function loadSettingsFor(sb: SupabaseClient): Promise<BusinessSettings> {
  const { data, error } = await sb.from("business_settings").select("*").eq("id", 1).single();
  if (error || !data) throw new Error(error?.message ?? "Sin configuración");
  return data as BusinessSettings;
}
