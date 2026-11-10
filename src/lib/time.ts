// Utilidades de fecha/hora con zona horaria explícita (sin dependencias).
// Las fechas "locales" son cadenas YYYY-MM-DD en la zona del negocio.

export const DEFAULT_TZ = "America/Argentina/Mendoza";
export const MINUTE = 60_000;

const dtfCache = new Map<string, Intl.DateTimeFormat>();
function dtf(tz: string): Intl.DateTimeFormat {
  let f = dtfCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    });
    dtfCache.set(tz, f);
  }
  return f;
}

/** Offset (minutos) de `tz` respecto de UTC en el instante dado. Mendoza = -180. */
export function getOffsetMinutes(utcMs: number, tz: string): number {
  const parts = dtf(tz).formatToParts(new Date(utcMs));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUtc - Math.floor(utcMs / 1000) * 1000) / MINUTE);
}

export function parseDate(date: string): { y: number; m: number; d: number } {
  const [y, m, d] = date.split("-").map(Number);
  return { y, m, d };
}

export function isValidDateStr(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const { y, m, d } = parseDate(s);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** Convierte (fecha local, minutos desde medianoche local) a milisegundos UTC. */
export function zonedToUtcMs(date: string, minutesOfDay: number, tz: string): number {
  const { y, m, d } = parseDate(date);
  const naive = Date.UTC(y, m - 1, d, 0, minutesOfDay, 0);
  let guess = naive - getOffsetMinutes(naive, tz) * MINUTE;
  guess = naive - getOffsetMinutes(guess, tz) * MINUTE;
  return guess;
}

export type Zoned = { date: string; minutes: number; weekday: number };

/** Descompone un instante UTC en fecha local, minutos del día y día ISO (1=lunes..7=domingo). */
export function utcToZoned(utcMs: number, tz: string): Zoned {
  const local = new Date(utcMs + getOffsetMinutes(utcMs, tz) * MINUTE);
  const date = local.toISOString().slice(0, 10);
  return { date, minutes: local.getUTCHours() * 60 + local.getUTCMinutes(), weekday: isoWeekday(date) };
}

export function todayInTz(nowMs: number, tz: string): string {
  return utcToZoned(nowMs, tz).date;
}

export function addDays(date: string, n: number): string {
  const { y, m, d } = parseDate(date);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export function diffDays(a: string, b: string): number {
  const pa = parseDate(a);
  const pb = parseDate(b);
  return Math.round((Date.UTC(pb.y, pb.m - 1, pb.d) - Date.UTC(pa.y, pa.m - 1, pa.d)) / 86_400_000);
}

/** 1 = lunes ... 7 = domingo */
export function isoWeekday(date: string): number {
  const { y, m, d } = parseDate(date);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return wd === 0 ? 7 : wd;
}

export function startOfWeek(date: string): string {
  return addDays(date, -(isoWeekday(date) - 1));
}

export function startOfMonth(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

export function daysInMonth(date: string): number {
  const { y, m } = parseDate(date);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function minutesToHHMM(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function hhmmToMinutes(s: string): number {
  const [h, m] = s.split(":").map(Number);
  return h * 60 + m;
}

export function isValidHHMM(s: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
}

export function formatTimeInTz(utcMs: number, tz: string): string {
  return minutesToHHMM(utcToZoned(utcMs, tz).minutes);
}

const WEEKDAYS_LONG = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];
const WEEKDAYS_SHORT = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"];
const MONTHS_LONG = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const MONTHS_SHORT = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

export const weekdayName = (iso: number, short = false) => (short ? WEEKDAYS_SHORT : WEEKDAYS_LONG)[iso - 1];
export const monthName = (m: number, short = false) => (short ? MONTHS_SHORT : MONTHS_LONG)[m - 1];

/** "martes 12 de noviembre" (sin Intl para que servidor y cliente coincidan exactamente). */
export function formatDateLong(date: string, withYear = false): string {
  const { y, m, d } = parseDate(date);
  const base = `${weekdayName(isoWeekday(date))} ${d} de ${monthName(m)}`;
  return withYear ? `${base} de ${y}` : base;
}

export function formatDateShort(date: string): string {
  const { m, d } = parseDate(date);
  return `${weekdayName(isoWeekday(date), true)} ${d} ${monthName(m, true)}`;
}

export function formatPriceArs(amount: number): string {
  return `$${amount.toLocaleString("es-AR")}`;
}

export function formatDuration(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const r = min % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
}
