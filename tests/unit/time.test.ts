import { describe, expect, it } from "vitest";
import { DEFAULT_TZ, addDays, diffDays, formatDateLong, getOffsetMinutes, isoWeekday, isValidDateStr, todayInTz, utcToZoned, zonedToUtcMs } from "@/lib/time";

describe("zona horaria America/Argentina/Mendoza", () => {
  it("usa UTC-3 todo el año (sin horario de verano)", () => {
    expect(getOffsetMinutes(Date.UTC(2026, 0, 15, 12), DEFAULT_TZ)).toBe(-180);
    expect(getOffsetMinutes(Date.UTC(2026, 6, 15, 12), DEFAULT_TZ)).toBe(-180);
  });
  it("convierte hora local de Mendoza a UTC", () => {
    expect(new Date(zonedToUtcMs("2026-11-10", 10 * 60, DEFAULT_TZ)).toISOString()).toBe("2026-11-10T13:00:00.000Z");
    expect(new Date(zonedToUtcMs("2026-11-10", 23 * 60 + 30, DEFAULT_TZ)).toISOString()).toBe("2026-11-11T02:30:00.000Z");
  });
  it("ida y vuelta entre UTC y hora local", () => {
    const ms = zonedToUtcMs("2026-12-31", 21 * 60, DEFAULT_TZ);
    expect(utcToZoned(ms, DEFAULT_TZ)).toEqual({ date: "2026-12-31", minutes: 1260, weekday: 4 });
  });
  it("el día local cambia respecto de UTC (02:00 UTC sigue siendo el día anterior en Mendoza)", () => {
    const ms = Date.UTC(2026, 10, 11, 2, 0);
    expect(todayInTz(ms, DEFAULT_TZ)).toBe("2026-11-10");
  });
  it("respeta el horario de verano de otras zonas (robustez del conversor)", () => {
    expect(new Date(zonedToUtcMs("2026-07-01", 600, "Europe/Madrid")).toISOString()).toBe("2026-07-01T08:00:00.000Z");
    expect(new Date(zonedToUtcMs("2026-12-01", 600, "Europe/Madrid")).toISOString()).toBe("2026-12-01T09:00:00.000Z");
  });
});

describe("fechas locales", () => {
  it("calcula día ISO, suma y diferencia de días", () => {
    expect(isoWeekday("2026-11-09")).toBe(1); // lunes
    expect(isoWeekday("2026-11-15")).toBe(7); // domingo
    expect(addDays("2026-12-30", 3)).toBe("2027-01-02");
    expect(diffDays("2026-11-09", "2026-11-19")).toBe(10);
  });
  it("valida fechas", () => {
    expect(isValidDateStr("2026-02-29")).toBe(false);
    expect(isValidDateStr("2028-02-29")).toBe(true);
    expect(isValidDateStr("2026-13-01")).toBe(false);
  });
  it("formatea en español", () => {
    expect(formatDateLong("2026-11-10")).toBe("martes 10 de noviembre");
  });
});
