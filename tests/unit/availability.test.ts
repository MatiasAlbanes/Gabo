import { describe, expect, it } from "vitest";
import { appointmentFitsSchedule, computeAvailability, dateRange, type AvailabilityInput } from "@/lib/availability";
import { DEFAULT_TZ, zonedToUtcMs } from "@/lib/time";

const tz = DEFAULT_TZ;
// "Hoy" en los tests: domingo 2026-11-08 08:00 hora de Mendoza.
const NOW = zonedToUtcMs("2026-11-08", 8 * 60, tz);
const at = (date: string, hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return zonedToUtcMs(date, h * 60 + m, tz);
};
// Horario de PRUEBA (no es el del negocio): martes y miércoles 09-13 y 16-21.
const hours = [2, 3].flatMap((weekday) => [
  { weekday, startMinute: 9 * 60, endMinute: 13 * 60 },
  { weekday, startMinute: 16 * 60, endMinute: 21 * 60 },
]);

const base = (over: Partial<AvailabilityInput> = {}): AvailabilityInput => ({
  tz,
  nowMs: NOW,
  dates: ["2026-11-10"], // martes
  service: { durationMinutes: 30, bufferMinutes: 0 },
  intervalMinutes: 30,
  minNoticeMinutes: 60,
  maxDaysAhead: 30,
  workingHours: hours,
  timeOff: [],
  blocks: [],
  busy: [],
  ...over,
});
const slots = (over: Partial<AvailabilityInput> = {}) => computeAvailability(base(over))[0].slots;

describe("motor de disponibilidad", () => {
  it("genera horarios dentro de los tramos laborales y respeta el descanso", () => {
    const s = slots();
    expect(s[0]).toBe("09:00");
    expect(s).toContain("12:30");
    expect(s).not.toContain("13:00");
    expect(s).not.toContain("15:30");
    expect(s[s.indexOf("12:30") + 1]).toBe("16:00");
    expect(s.at(-1)).toBe("20:30");
  });

  it("los días no laborales no tienen horarios", () => {
    expect(computeAvailability(base({ dates: ["2026-11-09"] }))[0].slots).toEqual([]); // lunes
  });

  it("respeta la duración completa del servicio dentro del tramo", () => {
    const s = slots({ service: { durationMinutes: 90, bufferMinutes: 0 } });
    expect(s).toContain("11:30");
    expect(s).not.toContain("12:00"); // terminaría 13:30
    expect(s.at(-1)).toBe("19:30");
  });

  it("servicios de distinta duración ocupan distinto espacio", () => {
    const busy = [{ startMs: at("2026-11-10", "10:00"), occupiedUntilMs: at("2026-11-10", "10:30") }];
    const corto = slots({ busy });
    expect(corto).not.toContain("10:00");
    expect(corto).toContain("09:30");
    const largo = slots({ busy, service: { durationMinutes: 60, bufferMinutes: 0 } });
    expect(largo).not.toContain("09:30"); // 09:30-10:30 pisa el turno de las 10:00
    expect(largo).toContain("09:00");
    expect(largo).toContain("10:30");
  });

  it("el tiempo de preparación del turno existente bloquea el horario siguiente", () => {
    const busy = [{ startMs: at("2026-11-10", "10:00"), occupiedUntilMs: at("2026-11-10", "10:45") }];
    const s = slots({ busy });
    expect(s).not.toContain("10:30");
    expect(s).toContain("11:00");
  });

  it("el tiempo de preparación del servicio nuevo también cuenta contra turnos siguientes", () => {
    const busy = [{ startMs: at("2026-11-10", "10:30"), occupiedUntilMs: at("2026-11-10", "11:00") }];
    const s = slots({ busy, service: { durationMinutes: 30, bufferMinutes: 15 } });
    expect(s).not.toContain("10:00"); // ocuparía hasta 10:45
    expect(s).toContain("09:30");
  });

  it("los bloqueos quitan horarios", () => {
    const s = slots({ blocks: [{ startMs: at("2026-11-10", "17:00"), endMs: at("2026-11-10", "18:00") }] });
    expect(s).not.toContain("17:00");
    expect(s).not.toContain("17:30");
    expect(s).toContain("16:30");
    expect(s).toContain("18:00");
  });

  it("días libres, feriados y vacaciones cierran el día completo", () => {
    expect(slots({ timeOff: [{ startDate: "2026-11-10", endDate: "2026-11-10" }] })).toEqual([]);
    expect(slots({ timeOff: [{ startDate: "2026-11-01", endDate: "2026-11-30" }] })).toEqual([]);
  });

  it("respeta la anticipación mínima", () => {
    const hoy = computeAvailability(base({ nowMs: at("2026-11-10", "09:10"), dates: ["2026-11-10"], minNoticeMinutes: 60 }))[0].slots;
    expect(hoy[0]).toBe("10:30"); // >= 10:10
    const sinMin = computeAvailability(base({ nowMs: at("2026-11-10", "09:10"), minNoticeMinutes: 0 }))[0].slots;
    expect(sinMin[0]).toBe("09:30");
  });

  it("prohíbe horarios pasados y fechas anteriores a hoy", () => {
    expect(computeAvailability(base({ nowMs: at("2026-11-10", "23:00") }))[0].slots).toEqual([]);
    expect(computeAvailability(base({ nowMs: at("2026-11-11", "08:00") }))[0].slots).toEqual([]);
  });

  it("respeta la cantidad de días futuros habilitados", () => {
    const r = computeAvailability(base({ dates: ["2026-12-08", "2026-12-15"], maxDaysAhead: 30 })); // hoy 11-08: +30 y +37
    expect(r[0].slots.length).toBeGreaterThan(0);
    expect(r[1].slots).toEqual([]);
    expect(computeAvailability(base({ dates: ["2026-12-15"], maxDaysAhead: null }))[0].slots.length).toBeGreaterThan(0);
  });

  it("el intervalo entre turnos define la grilla", () => {
    const s = slots({ intervalMinutes: 60 });
    expect(s.slice(0, 4)).toEqual(["09:00", "10:00", "11:00", "12:00"]);
  });

  it("dateRange genera fechas consecutivas", () => {
    expect(dateRange("2026-12-30", 3)).toEqual(["2026-12-30", "2026-12-31", "2027-01-01"]);
  });
});

describe("turnos afectados por cambios de agenda", () => {
  const ctx = { tz, workingHours: hours, timeOff: [], blocks: [] };
  const appt = (hhmm: string, mins: number, date = "2026-11-10") => ({ startMs: at(date, hhmm), endMs: at(date, hhmm) + mins * 60_000 });

  it("un turno dentro del horario encaja", () => {
    expect(appointmentFitsSchedule(appt("10:00", 30), ctx)).toBe(true);
  });
  it("detecta turnos fuera del horario nuevo", () => {
    expect(appointmentFitsSchedule(appt("10:00", 30), { ...ctx, workingHours: hours.filter((h) => h.startMinute >= 16 * 60) })).toBe(false);
  });
  it("detecta turnos que cruzan el descanso", () => {
    expect(appointmentFitsSchedule(appt("12:45", 30), ctx)).toBe(false);
  });
  it("detecta turnos en días libres y bloqueos", () => {
    expect(appointmentFitsSchedule(appt("10:00", 30), { ...ctx, timeOff: [{ startDate: "2026-11-10", endDate: "2026-11-12" }] })).toBe(false);
    expect(appointmentFitsSchedule(appt("10:00", 30), { ...ctx, blocks: [{ startMs: at("2026-11-10", "10:15"), endMs: at("2026-11-10", "11:00") }] })).toBe(false);
  });
});
