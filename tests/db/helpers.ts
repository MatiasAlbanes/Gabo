import { readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import { DEFAULT_TZ, addDays, todayInTz, zonedToUtcMs } from "@/lib/time";

export function loadStackEnv(): Record<string, string> {
  const file = path.join(process.cwd(), ".stack-data", "env");
  const env: Record<string, string> = {};
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const i = line.indexOf("=");
    if (i > 0) env[line.slice(0, i)] = line.slice(i + 1);
  }
  return env;
}

export const env = loadStackEnv();
export const pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 25 });

export async function reset() {
  await pool.query(`
    truncate public.appointments, public.time_off, public.time_blocks, public.working_hours, public.services, public.rate_limits cascade;
    update public.business_settings set booking_enabled = true, min_notice_minutes = 60, max_days_ahead = 30,
      cancel_notice_hours = 2, max_active_per_phone = 3, slot_interval_minutes = 30;
  `);
}

export async function barberId(): Promise<string> {
  return (await pool.query("select id from public.barbers limit 1")).rows[0].id;
}

/** Horario SOLO DE PRUEBA: todos los días 09-13 y 16-21. */
export async function seedHours(barber: string) {
  for (let wd = 1; wd <= 7; wd++) {
    await pool.query("insert into public.working_hours (barber_id, weekday, start_minute, end_minute) values ($1,$2,540,780),($1,$2,960,1260)", [barber, wd]);
  }
}

export async function seedService(over: Partial<{ name: string; price: number; duration: number; buffer: number; active: boolean }> = {}): Promise<string> {
  const r = await pool.query(
    "insert into public.services (name, price_ars, duration_minutes, buffer_minutes, active) values ($1,$2,$3,$4,$5) returning id",
    [over.name ?? "Corte de prueba", over.price ?? 1000, over.duration ?? 30, over.buffer ?? 0, over.active ?? true],
  );
  return r.rows[0].id;
}

/** Fecha local (Mendoza) `n` días desde hoy. */
export const localDate = (n: number) => addDays(todayInTz(Date.now(), DEFAULT_TZ), n);
/** ISO UTC de una hora local de Mendoza. */
export const slot = (date: string, hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(zonedToUtcMs(date, h * 60 + m, DEFAULT_TZ)).toISOString();
};

let n = 0;
export async function book(args: { barber: string; service: string; start: string; name?: string; phone?: string; source?: string; client?: pg.Pool | pg.PoolClient }) {
  const q = args.client ?? pool;
  n += 1;
  return q.query("select * from public.book_appointment($1,$2,$3,$4,$5,$6,$7)", [
    args.barber, args.service, args.name ?? "Cliente Test", args.phone ?? `+54926151${String(10000 + n).slice(-5)}`, args.start,
    `hash-${Date.now()}-${n}-${Math.random()}`, args.source ?? "online",
  ]);
}

export async function errorOf(p: Promise<unknown>): Promise<string | null> {
  try {
    await p;
    return null;
  } catch (e) {
    return (e as { message: string }).message;
  }
}
