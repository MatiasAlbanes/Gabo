import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { barberId, book, errorOf, localDate, pool, reset, seedHours, seedService, slot } from "./helpers";

let barber: string;
let corte: string;

beforeEach(async () => {
  await reset();
  barber = await barberId();
  await seedHours(barber);
  corte = await seedService({ duration: 30 });
});
afterAll(() => pool.end());

describe("reservas en la base de datos (Postgres real)", () => {
  it("registra un turno con copia histórica del servicio", async () => {
    const day = localDate(3);
    const r = await book({ barber, service: corte, start: slot(day, "10:00"), name: "  Ana  " });
    const a = r.rows[0];
    expect(a.status).toBe("confirmed");
    expect(a.client_name).toBe("Ana");
    expect(a.service_name).toBe("Corte de prueba");
    expect(new Date(a.end_at).getTime() - new Date(a.start_at).getTime()).toBe(30 * 60_000);
  });

  it("rechaza dos turnos superpuestos (mismo horario y parcialmente superpuestos)", async () => {
    const day = localDate(3);
    const largo = await seedService({ name: "Largo", duration: 60 });
    await book({ barber, service: largo, start: slot(day, "10:00") });
    expect(await errorOf(book({ barber, service: corte, start: slot(day, "10:00") }))).toBe("slot_taken");
    expect(await errorOf(book({ barber, service: corte, start: slot(day, "10:30") }))).toBe("slot_taken");
    expect(await errorOf(book({ barber, service: largo, start: slot(day, "09:30") }))).toBe("slot_taken");
    // contiguos sí
    expect(await errorOf(book({ barber, service: corte, start: slot(day, "11:00") }))).toBeNull();
    expect(await errorOf(book({ barber, service: corte, start: slot(day, "09:30") }))).toBeNull();
  });

  it("con 20 solicitudes simultáneas por el mismo horario, solo una se confirma", async () => {
    const day = localDate(4);
    const results = await Promise.all(
      Array.from({ length: 20 }, () => errorOf(book({ barber, service: corte, start: slot(day, "17:00") }))),
    );
    expect(results.filter((r) => r === null)).toHaveLength(1);
    expect(results.filter((r) => r === "slot_taken")).toHaveLength(19);
    const { rows } = await pool.query("select count(*)::int as n from public.appointments where status = 'confirmed'");
    expect(rows[0].n).toBe(1);
  });

  it("con solicitudes simultáneas superpuestas a distintas horas, solo una gana", async () => {
    const day = localDate(4);
    const largo = await seedService({ name: "Largo", duration: 60 });
    const starts = ["17:00", "17:30", "17:15", "16:30"].map((t) => slot(day, t));
    const results = await Promise.all(
      starts.flatMap((s) => Array.from({ length: 5 }, () => errorOf(book({ barber, service: s === starts[0] ? corte : largo, start: s })))),
    );
    // 17:00(30m)=17:00-17:30 | 17:30(60m)=17:30-18:30 | 17:15 y 16:30 se superponen con alguno
    const ok = results.filter((r) => r === null).length;
    const { rows } = await pool.query("select start_at, occupied_until from public.appointments where status='confirmed' order by start_at");
    expect(rows.length).toBe(ok);
    for (let i = 1; i < rows.length; i++) expect(new Date(rows[i].start_at) >= new Date(rows[i - 1].occupied_until)).toBe(true);
  });

  it("la restricción de exclusión protege incluso ante inserciones directas", async () => {
    const day = localDate(3);
    await book({ barber, service: corte, start: slot(day, "10:00") });
    const err = await errorOf(
      pool.query(
        `insert into public.appointments (barber_id, service_name, service_price_ars, duration_minutes, client_name, client_phone, start_at, end_at, occupied_until, token_hash)
         values ($1,'x',1,30,'x','+5492615123456',$2,$3,$3,'raw-hash')`,
        [barber, slot(day, "10:15"), slot(day, "10:45")],
      ),
    );
    expect(err).toContain("appointments_no_overlap");
  });

  it("respeta el tiempo de preparación (buffer) entre turnos", async () => {
    const day = localDate(3);
    const conBuffer = await seedService({ name: "Con limpieza", duration: 30, buffer: 15 });
    await book({ barber, service: conBuffer, start: slot(day, "10:00") }); // ocupa hasta 10:45
    expect(await errorOf(book({ barber, service: corte, start: slot(day, "10:30") }))).toBe("slot_taken");
    expect(await errorOf(book({ barber, service: corte, start: slot(day, "10:45") }))).toBeNull();
  });

  it("prohíbe horarios fuera del horario laboral y servicios que no entran en el tramo", async () => {
    const day = localDate(3);
    expect(await errorOf(book({ barber, service: corte, start: slot(day, "08:30") }))).toBe("outside_hours");
    expect(await errorOf(book({ barber, service: corte, start: slot(day, "13:00") }))).toBe("outside_hours"); // descanso
    expect(await errorOf(book({ barber, service: corte, start: slot(day, "21:00") }))).toBe("outside_hours");
    const largo = await seedService({ name: "Largo", duration: 60 });
    expect(await errorOf(book({ barber, service: largo, start: slot(day, "12:30") }))).toBe("outside_hours"); // cruza el descanso
    expect(await errorOf(book({ barber, service: largo, start: slot(day, "20:00") }))).toBeNull();
  });

  it("prohíbe reservas en el pasado, con poca anticipación y demasiado lejos", async () => {
    expect(await errorOf(book({ barber, service: corte, start: slot(localDate(-1), "10:00") }))).toBe("slot_in_past");
    await pool.query("update public.business_settings set min_notice_minutes = 100000"); // ~69 días
    await pool.query("update public.business_settings set max_days_ahead = 365");
    expect(await errorOf(book({ barber, service: corte, start: slot(localDate(2), "10:00") }))).toBe("too_soon");
    await pool.query("update public.business_settings set min_notice_minutes = 0, max_days_ahead = 5");
    expect(await errorOf(book({ barber, service: corte, start: slot(localDate(10), "10:00") }))).toBe("too_far");
    expect(await errorOf(book({ barber, service: corte, start: slot(localDate(4), "10:00") }))).toBeNull();
  });

  it("el administrador (source=admin) puede saltear anticipación mínima pero no el horario laboral", async () => {
    await pool.query("update public.business_settings set min_notice_minutes = 100000");
    expect(await errorOf(book({ barber, service: corte, start: slot(localDate(2), "10:00"), source: "admin" }))).toBeNull();
    expect(await errorOf(book({ barber, service: corte, start: slot(localDate(2), "07:00"), source: "admin" }))).toBe("outside_hours");
  });

  it("los días libres y bloqueos impiden reservar", async () => {
    const day = localDate(3);
    const off = localDate(5);
    await pool.query("insert into public.time_off (barber_id, kind, start_date, end_date) values ($1,'vacation',$2,$2)", [barber, off]);
    expect(await errorOf(book({ barber, service: corte, start: slot(off, "10:00") }))).toBe("closed_day");
    await pool.query("insert into public.time_blocks (barber_id, start_at, end_at) values ($1,$2,$3)", [barber, slot(day, "17:00"), slot(day, "18:00")]);
    expect(await errorOf(book({ barber, service: corte, start: slot(day, "17:30") }))).toBe("slot_blocked");
    expect(await errorOf(book({ barber, service: corte, start: slot(day, "16:30") }))).toBeNull();
    expect(await errorOf(book({ barber, service: corte, start: slot(day, "18:00") }))).toBeNull();
  });

  it("no reserva servicios inactivos ni con reservas deshabilitadas", async () => {
    const day = localDate(3);
    const off = await seedService({ name: "Inactivo", active: false });
    expect(await errorOf(book({ barber, service: off, start: slot(day, "10:00") }))).toBe("service_unavailable");
    await pool.query("update public.business_settings set booking_enabled = false");
    expect(await errorOf(book({ barber, service: corte, start: slot(day, "10:00") }))).toBe("booking_disabled");
  });

  it("limita las reservas activas por teléfono (anti-abuso)", async () => {
    const day = localDate(3);
    await pool.query("update public.business_settings set max_active_per_phone = 2");
    const phone = "+5492615550000";
    await book({ barber, service: corte, start: slot(day, "10:00"), phone });
    await book({ barber, service: corte, start: slot(day, "10:30"), phone });
    expect(await errorOf(book({ barber, service: corte, start: slot(day, "11:00"), phone }))).toBe("too_many_active");
    expect(await errorOf(book({ barber, service: corte, start: slot(day, "11:00"), phone, source: "admin" }))).toBeNull();
  });

  it("cancelar libera el horario y conserva el historial", async () => {
    const day = localDate(3);
    const a = (await book({ barber, service: corte, start: slot(day, "10:00") })).rows[0];
    const c = (await pool.query("select * from public.cancel_appointment($1,'client')", [a.id])).rows[0];
    expect(c.status).toBe("cancelled");
    expect(c.cancelled_by).toBe("client");
    expect(c.cancelled_at).not.toBeNull();
    expect(await errorOf(book({ barber, service: corte, start: slot(day, "10:00") }))).toBeNull();
    const { rows } = await pool.query("select count(*)::int n from public.appointments where id = $1", [a.id]);
    expect(rows[0].n).toBe(1);
    expect(await errorOf(pool.query("select * from public.cancel_appointment($1,'client')", [a.id]))).toBe("not_editable");
  });

  it("el cliente no puede cancelar/reprogramar fuera de la política; el administrador sí", async () => {
    const day = localDate(0);
    await pool.query("update public.business_settings set cancel_notice_hours = 100000, min_notice_minutes = 0");
    const a = (await book({ barber, service: corte, start: slot(localDate(3), "10:00") })).rows[0];
    expect(await errorOf(pool.query("select * from public.cancel_appointment($1,'client')", [a.id]))).toBe("too_late_to_change");
    expect(await errorOf(pool.query("select * from public.move_appointment($1,$2,'client')", [a.id, slot(localDate(4), "10:00")]))).toBe("too_late_to_change");
    expect(await errorOf(pool.query("select * from public.move_appointment($1,$2,'admin')", [a.id, slot(localDate(4), "10:00")]))).toBeNull();
    void day;
  });

  it("reprogramar es atómico: si el destino está ocupado, el turno original no cambia", async () => {
    const day = localDate(3);
    const a = (await book({ barber, service: corte, start: slot(day, "10:00") })).rows[0];
    await book({ barber, service: corte, start: slot(day, "11:00") });
    expect(await errorOf(pool.query("select * from public.move_appointment($1,$2,'client')", [a.id, slot(day, "11:00")]))).toBe("slot_taken");
    const same = (await pool.query("select start_at, reschedule_count from public.appointments where id=$1", [a.id])).rows[0];
    expect(new Date(same.start_at).toISOString()).toBe(slot(day, "10:00"));
    expect(same.reschedule_count).toBe(0);

    const moved = (await pool.query("select * from public.move_appointment($1,$2,'client')", [a.id, slot(day, "12:00")])).rows[0];
    expect(new Date(moved.start_at).toISOString()).toBe(slot(day, "12:00"));
    expect(moved.reschedule_count).toBe(1);
    // el horario viejo quedó libre
    expect(await errorOf(book({ barber, service: corte, start: slot(day, "10:00") }))).toBeNull();
  });

  it("puede reprogramarse a un horario que se superpone con su propio horario anterior", async () => {
    const day = localDate(3);
    const largo = await seedService({ name: "Largo", duration: 60 });
    const a = (await book({ barber, service: largo, start: slot(day, "10:00") })).rows[0];
    const moved = (await pool.query("select * from public.move_appointment($1,$2,'client')", [a.id, slot(day, "10:30")])).rows[0];
    expect(new Date(moved.start_at).toISOString()).toBe(slot(day, "10:30"));
  });

  it("reprogramaciones simultáneas hacia el mismo horario: solo una prospera", async () => {
    const day = localDate(3);
    const ids: string[] = [];
    for (const t of ["10:00", "10:30", "11:00", "11:30", "12:00"]) ids.push((await book({ barber, service: corte, start: slot(day, t) })).rows[0].id);
    const results = await Promise.all(ids.map((id) => errorOf(pool.query("select * from public.move_appointment($1,$2,'client')", [id, slot(day, "17:00")]))));
    expect(results.filter((r) => r === null)).toHaveLength(1);
  });

  it("los horarios semanales no admiten tramos superpuestos", async () => {
    const err = await errorOf(pool.query("insert into public.working_hours (barber_id, weekday, start_minute, end_minute) values ($1,1,600,700)", [barber]));
    expect(err).toContain("working_hours_no_overlap");
  });

  it("el límite de solicitudes cuenta por ventana", async () => {
    const allowed: boolean[] = [];
    for (let i = 0; i < 5; i++) allowed.push((await pool.query("select public.check_rate_limit('t:ip1', 3, 60) as ok")).rows[0].ok);
    expect(allowed).toEqual([true, true, true, false, false]);
    expect((await pool.query("select public.check_rate_limit('t:ip2', 3, 60) as ok")).rows[0].ok).toBe(true);
  });
});
