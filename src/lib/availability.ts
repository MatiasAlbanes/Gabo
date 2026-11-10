// Motor de disponibilidad: lógica pura (sin acceso a base de datos), totalmente testeable.
// La base de datos vuelve a validar todo al reservar; este módulo calcula qué ofrecer.

import { MINUTE, addDays, diffDays, isoWeekday, minutesToHHMM, todayInTz, utcToZoned, zonedToUtcMs } from "./time";

export type WorkingInterval = { weekday: number; startMinute: number; endMinute: number };
export type TimeOffRange = { startDate: string; endDate: string };
export type BlockRange = { startMs: number; endMs: number };
/** Turno activo: ocupa desde su inicio hasta el fin + tiempo de preparación. */
export type BusyRange = { startMs: number; occupiedUntilMs: number };

export type ScheduleContext = {
  tz: string;
  workingHours: WorkingInterval[];
  timeOff: TimeOffRange[];
  blocks: BlockRange[];
};

export type AvailabilityInput = ScheduleContext & {
  nowMs: number;
  dates: string[];
  service: { durationMinutes: number; bufferMinutes: number };
  intervalMinutes: number;
  /** 0 para el panel administrativo. */
  minNoticeMinutes: number;
  /** null = sin límite (panel administrativo). */
  maxDaysAhead: number | null;
  busy: BusyRange[];
};

export type DayAvailability = { date: string; slots: string[] };

export function isDayOff(date: string, timeOff: TimeOffRange[]): boolean {
  return timeOff.some((t) => date >= t.startDate && date <= t.endDate);
}

export function intervalsForWeekday(workingHours: WorkingInterval[], weekday: number): WorkingInterval[] {
  return workingHours.filter((w) => w.weekday === weekday).sort((a, b) => a.startMinute - b.startMinute);
}

const overlaps = (aStart: number, aEnd: number, bStart: number, bEnd: number) => aStart < bEnd && bStart < aEnd;

export function computeAvailability(input: AvailabilityInput): DayAvailability[] {
  const { tz, nowMs, service, intervalMinutes } = input;
  const today = todayInTz(nowMs, tz);
  const earliest = nowMs + input.minNoticeMinutes * MINUTE;
  const durMs = service.durationMinutes * MINUTE;
  const occupyMs = (service.durationMinutes + service.bufferMinutes) * MINUTE;

  return input.dates.map((date) => {
    const empty = { date, slots: [] as string[] };
    if (date < today) return empty;
    if (input.maxDaysAhead !== null && diffDays(today, date) > input.maxDaysAhead) return empty;
    if (isDayOff(date, input.timeOff)) return empty;

    const slots = new Set<number>();
    for (const w of intervalsForWeekday(input.workingHours, isoWeekday(date))) {
      for (let m = w.startMinute; m + service.durationMinutes <= w.endMinute; m += intervalMinutes) {
        const startMs = zonedToUtcMs(date, m, tz);
        if (startMs <= nowMs || startMs < earliest) continue;
        if (input.blocks.some((b) => overlaps(startMs, startMs + durMs, b.startMs, b.endMs))) continue;
        if (input.busy.some((b) => overlaps(startMs, startMs + occupyMs, b.startMs, b.occupiedUntilMs))) continue;
        slots.add(m);
      }
    }
    return { date, slots: [...slots].sort((a, b) => a - b).map(minutesToHHMM) };
  });
}

/**
 * ¿Sigue encajando un turno existente en una configuración horaria propuesta?
 * Se usa para advertir qué reservas quedarían afectadas antes de reducir disponibilidad.
 */
export function appointmentFitsSchedule(appt: { startMs: number; endMs: number }, ctx: ScheduleContext): boolean {
  const start = utcToZoned(appt.startMs, ctx.tz);
  if (isDayOff(start.date, ctx.timeOff)) return false;
  const durationMin = Math.round((appt.endMs - appt.startMs) / MINUTE);
  const fits = ctx.workingHours.some(
    (w) => w.weekday === start.weekday && w.startMinute <= start.minutes && start.minutes + durationMin <= w.endMinute,
  );
  if (!fits) return false;
  return !ctx.blocks.some((b) => overlaps(appt.startMs, appt.endMs, b.startMs, b.endMs));
}

/** Fechas locales consecutivas desde `from`. */
export function dateRange(from: string, days: number): string[] {
  return Array.from({ length: days }, (_, i) => addDays(from, i));
}
