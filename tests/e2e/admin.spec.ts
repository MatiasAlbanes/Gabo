import { ADMIN, ADMIN_STATE, adminLogin, apiHeaders, bookViaApi, expect, localDate, pickDay, pool, seed, slot, test } from "./helpers";
import { createClient } from "@supabase/supabase-js";
import { loadStackEnv } from "../db/helpers";
import { formatDateLong, isoWeekday, weekdayName } from "@/lib/time";

let ids: Awaited<ReturnType<typeof seed>>;
test.beforeEach(async () => {
  ids = await seed();
});

const slotsFor = async (request: Parameters<typeof bookViaApi>[0], serviceId: string, date: string) =>
  ((await (await request.get(`/api/availability?serviceId=${serviceId}&from=${date}&days=1`, { headers: apiHeaders() })).json()).days[0].slots as string[]);

test.describe("acceso", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("sin sesión no se puede entrar a ninguna pantalla del panel", async ({ page }) => {
    for (const path of ["/admin", "/admin/agenda", "/admin/turnos", "/admin/servicios", "/admin/horarios", "/admin/bloqueos", "/admin/negocio"]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/admin\/login$/);
      await expect(page.getByRole("button", { name: "Ingresar" })).toBeVisible();
    }
  });

  test("credenciales incorrectas no ingresan", async ({ page }) => {
    await page.goto("/admin/login");
    await page.locator("#email").fill(ADMIN.email);
    await page.locator("#password").fill("clave-equivocada");
    await page.getByRole("button", { name: "Ingresar" }).click();
    await expect(page.getByText("Correo o contraseña incorrectos.")).toBeVisible();
    await expect(page).toHaveURL(/\/admin\/login$/);
  });

  test("un usuario válido que no es administrador no accede al panel", async ({ page }) => {
    const env = loadStackEnv();
    const svc = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
    await svc.auth.admin.createUser({ email: "no.admin@example.com", password: "NoAdmin-12345678", email_confirm: true }).catch(() => {});
    await page.goto("/admin/login");
    await page.locator("#email").fill("no.admin@example.com");
    await page.locator("#password").fill("NoAdmin-12345678");
    await page.getByRole("button", { name: "Ingresar" }).click();
    await expect(page.getByText("Esta cuenta no tiene acceso al panel.")).toBeVisible();
    await page.goto("/admin/turnos");
    await expect(page).toHaveURL(/\/admin\/login$/);
  });

  test("el administrador ingresa y puede cerrar sesión", async ({ page }) => {
    await adminLogin(page);
    await expect(page.getByTestId("today-title")).toBeVisible();
    await page.getByRole("button", { name: "Cerrar sesión" }).click();
    await expect(page).toHaveURL(/\/admin\/login$/);
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/admin\/login$/);
  });
});

test.describe("panel", () => {
  test.use({ storageState: ADMIN_STATE });

  test("el panel de hoy muestra la fecha, contadores y el próximo turno", async ({ page, request }) => {
    await bookViaApi(request, { serviceId: ids.corte, date: localDate(2), time: "16:00", name: "Próxima Persona" });
    await page.goto("/admin");
    await expect(page.getByTestId("today-title")).toContainText(formatDateLong(localDate(0), true));
    for (const label of ["Turnos del día", "Pendientes", "Completados", "Cancelados", "Horarios libres"]) await expect(page.getByTestId(`stat-${label}`)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Próximo turno" })).toBeVisible();
    await expect(page.getByTestId("appointment-row").filter({ hasText: "Próxima Persona" })).toBeVisible();
  });

  test("Gabo crea un turno manual: se guarda, avisa por WhatsApp y el horario deja de estar público", async ({ page, request }) => {
    const date = localDate(2);
    await page.goto("/admin/agenda?view=dia&date=" + date);
    await page.getByTestId("new-appointment").click();
    const dlg = page.getByRole("dialog");
    await dlg.getByLabel("Servicio").selectOption(ids.combo);
    await pickDay(dlg, date);
    await dlg.getByRole("button", { name: "16:00", exact: true }).click();
    await dlg.locator("#n-name").fill("Cliente Manual");
    await dlg.locator("#n-phone").fill("261 5111222");
    await dlg.getByRole("button", { name: "Crear turno" }).click();
    await expect(dlg.getByText("Turno creado.")).toBeVisible();
    await expect(dlg.getByRole("link", { name: /Cliente Manual por WhatsApp/ })).toHaveAttribute("href", /^https:\/\/wa\.me\/5492615111222/);

    const { rows } = await pool.query("select * from public.appointments");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ client_name: "Cliente Manual", source: "admin", status: "confirmed", service_name: "Corte + barba", duration_minutes: 60 });
    expect(new Date(rows[0].start_at).toISOString()).toBe(slot(date, "16:00"));
    const pub = await slotsFor(request, ids.corte, date);
    expect(pub).not.toContain("16:00");
    expect(pub).not.toContain("16:30");
    expect(pub).toContain("17:00");
  });

  test("Gabo completa, marca inasistencia, cancela y reactiva un turno", async ({ page, request }) => {
    const date = localDate(2);
    await bookViaApi(request, { serviceId: ids.corte, date, time: "10:00", name: "Estado Cambiante", phone: "261 5333444" });
    const status = async () => (await pool.query("select status, cancelled_by from public.appointments")).rows[0];
    await page.goto(`/admin/agenda?view=dia&date=${date}`);
    const open = async () => {
      await page.getByTestId("appointment-row").filter({ hasText: "Estado Cambiante" }).click();
      return page.getByRole("dialog");
    };

    let dlg = await open();
    await dlg.getByRole("button", { name: "Completado" }).click();
    await expect.poll(async () => (await status()).status).toBe("completed");
    await dlg.getByRole("button", { name: /Volver a .Confirmado./ }).click();
    await expect.poll(async () => (await status()).status).toBe("confirmed");
    await dlg.getByRole("button", { name: "No asistió" }).click();
    await expect.poll(async () => (await status()).status).toBe("no_show");
    expect(await slotsFor(request, ids.corte, date)).toContain("10:00"); // no_show libera el horario
    await dlg.getByRole("button", { name: /Volver a .Confirmado./ }).click();
    await expect.poll(async () => (await status()).status).toBe("confirmed");

    await dlg.getByRole("button", { name: "Cancelar turno" }).click();
    await dlg.getByRole("button", { name: "Sí, cancelar" }).click();
    await expect.poll(async () => (await status()).status).toBe("cancelled");
    expect((await status()).cancelled_by).toBe("admin");
    await expect(dlg.getByRole("link", { name: /Avisar a Estado Cambiante por WhatsApp/ })).toBeVisible();
    expect(await slotsFor(request, ids.corte, date)).toContain("10:00");
    expect((await pool.query("select count(*)::int n from public.appointments")).rows[0].n).toBe(1); // historial conservado
  });

  test("Gabo reprograma un turno desde el panel", async ({ page, request }) => {
    const date = localDate(2);
    const newDate = localDate(4);
    await bookViaApi(request, { serviceId: ids.corte, date, time: "10:00", name: "Mover Yo" });
    await page.goto(`/admin/agenda?view=dia&date=${date}`);
    await page.getByTestId("appointment-row").filter({ hasText: "Mover Yo" }).click();
    const dlg = page.getByRole("dialog");
    await dlg.getByRole("button", { name: "Reprogramar" }).first().click();
    await dlg.getByRole("group", { name: "Días" }).waitFor();
    await pickDay(dlg, newDate);
    await dlg.getByRole("button", { name: "19:00", exact: true }).click();
    await dlg.getByRole("button", { name: "Reprogramar" }).last().click();
    await expect.poll(async () => new Date((await pool.query("select start_at from public.appointments")).rows[0].start_at).toISOString()).toBe(slot(newDate, "19:00"));
    expect(await slotsFor(request, ids.corte, date)).toContain("10:00");
  });

  test("búsqueda por nombre, teléfono y fecha", async ({ page, request }) => {
    await bookViaApi(request, { serviceId: ids.corte, date: localDate(2), time: "10:00", name: "Laura Buscable", phone: "261 5888111" });
    await bookViaApi(request, { serviceId: ids.corte, date: localDate(3), time: "10:00", name: "Otro Cliente", phone: "261 5999222" });
    const rows = page.getByTestId("appointment-row");
    await page.goto("/admin/turnos?q=laura");
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("Laura Buscable");
    await page.goto("/admin/turnos?q=5999222");
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("Otro Cliente");
    const d = localDate(2);
    await page.goto(`/admin/turnos?q=${d}`);
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("Laura Buscable");
    await page.goto("/admin/turnos?q=zzzz");
    await expect(page.getByText("No encontramos turnos con esa búsqueda.")).toBeVisible();
    await page.goto("/admin/turnos");
    await expect(rows).toHaveCount(2);
  });

  test("agenda: vistas diaria, semanal y mensual muestran la reserva", async ({ page, request }) => {
    const date = localDate(2);
    await bookViaApi(request, { serviceId: ids.corte, date, time: "10:00", name: "Vista Tres" });
    await page.goto(`/admin/agenda?view=dia&date=${date}`);
    await expect(page.getByTestId("appointment-row").filter({ hasText: "Vista Tres" })).toBeVisible();
    await page.goto(`/admin/agenda?view=semana&date=${date}`);
    await expect(page.getByTestId("appointment-row").filter({ hasText: "Vista Tres" })).toBeVisible();
    await page.goto(`/admin/agenda?view=mes&date=${date}`);
    await expect(page.getByRole("link", { name: new RegExp(`^${formatDateLong(date)}, 1 turnos`) })).toBeVisible();
    await page.getByRole("link", { name: new RegExp(`^${formatDateLong(date)}, 1 turnos`) }).click();
    await expect(page.getByTestId("agenda-title")).toContainText(formatDateLong(date, true));
    await expect(page.getByTestId("appointment-row").filter({ hasText: "Vista Tres" })).toBeVisible();
  });

  test("Gabo bloquea un horario y un día libre: la disponibilidad pública cambia", async ({ page, request }) => {
    const date = localDate(3);
    const off = localDate(5);
    await page.goto("/admin/bloqueos");
    await page.locator("#b-date").fill(date);
    await page.locator("#b-start").fill("17:00");
    await page.locator("#b-end").fill("18:00");
    await page.locator("#b-reason").fill("Trámite");
    await page.getByRole("button", { name: "Bloquear", exact: true }).click();
    await expect(page.getByText("Horario bloqueado.")).toBeVisible();
    const s = await slotsFor(request, ids.corte, date);
    expect(s).not.toContain("17:00");
    expect(s).not.toContain("17:30");
    expect(s).toContain("18:00");

    await page.locator("#o-kind").selectOption("holiday");
    await page.locator("#o-from").fill(off);
    await page.locator("#o-to").fill(off);
    await page.getByRole("button", { name: "Agregar", exact: true }).click();
    await expect(page.getByRole("listitem").filter({ hasText: "Feriado" })).toBeVisible();
    expect(await slotsFor(request, ids.corte, off)).toEqual([]);

    // y se pueden quitar
    await page.getByRole("button", { name: "Quitar" }).first().click();
    await page.getByRole("button", { name: "Quitar" }).first().click();
    await expect.poll(() => slotsFor(request, ids.corte, off)).not.toEqual([]);
  });

  test("servicios: crear, editar precio, reordenar y desactivar se reflejan en la página pública", async ({ page, browser }) => {
    await page.goto("/admin/servicios");
    await page.getByTestId("new-service").click();
    let dlg = page.getByRole("dialog");
    await dlg.locator("#s-name").fill("Perfilado de cejas");
    await dlg.locator("#s-price").fill("5000");
    await dlg.locator("#s-dur").fill("20");
    await dlg.locator("#s-buf").fill("5");
    await dlg.getByRole("button", { name: "Guardar servicio" }).click();
    await expect(page.getByTestId("service-row").filter({ hasText: "Perfilado de cejas" })).toContainText("$5.000");
    expect((await pool.query("select duration_minutes, buffer_minutes from public.services where name='Perfilado de cejas'")).rows[0]).toEqual({ duration_minutes: 20, buffer_minutes: 5 });

    const pub = await browser.newPage({ extraHTTPHeaders: { "x-forwarded-for": "10.55.5.5" } });
    await pub.goto(`${process.env.E2E_BASE_URL ?? "http://localhost:3100"}/`);
    await expect(pub.getByRole("button", { name: /Perfilado de cejas/ })).toContainText("$5.000");

    await page.getByTestId("service-row").filter({ hasText: "Perfilado de cejas" }).getByRole("button", { name: /^Perfilado/ }).click();
    dlg = page.getByRole("dialog");
    await dlg.locator("#s-price").fill("6500");
    await dlg.getByRole("button", { name: "Guardar servicio" }).click();
    await expect(dlg).toBeHidden();
    await pub.reload();
    await expect(pub.getByRole("button", { name: /Perfilado de cejas/ })).toContainText("$6.500");

    await page.getByRole("button", { name: "Subir Perfilado de cejas" }).click();
    await expect.poll(async () => (await pool.query("select name from public.services order by sort_order")).rows.map((r) => r.name).indexOf("Perfilado de cejas")).toBe(2);

    await page.getByTestId("service-row").filter({ hasText: "Perfilado de cejas" }).getByRole("button", { name: /^Perfilado/ }).click();
    dlg = page.getByRole("dialog");
    await dlg.getByRole("checkbox").uncheck();
    await dlg.getByRole("button", { name: "Guardar servicio" }).click();
    await expect(dlg).toBeHidden();
    await pub.reload();
    await expect(pub.getByRole("button", { name: /Perfilado de cejas/ })).toHaveCount(0);
    await pub.close();
  });

  test("los turnos conservan el nombre y precio con que se reservaron aunque el servicio cambie", async ({ request }) => {
    await bookViaApi(request, { serviceId: ids.corte, date: localDate(3), time: "10:00" });
    await pool.query("update public.services set name = 'Corte NUEVO', price_ars = 99999, duration_minutes = 90 where id = $1", [ids.corte]);
    const r = (await pool.query("select service_name, service_price_ars, duration_minutes from public.appointments")).rows[0];
    expect(r).toEqual({ service_name: "Corte de pelo", service_price_ars: 10000, duration_minutes: 30 });
  });

  test("horarios: reducir disponibilidad advierte de turnos afectados y exige resolverlos", async ({ page, request }) => {
    const date = localDate(3);
    const wd = isoWeekday(date);
    await bookViaApi(request, { serviceId: ids.corte, date, time: "10:00", name: "Afectada Por Cambio", phone: "261 5121212" });
    await page.goto("/admin/horarios");

    // Cierre del día de ese turno
    await page.getByRole("switch", { name: new RegExp(`^${weekdayName(wd)}`) }).click();
    await page.getByTestId("save-hours").click();
    const conflicts = page.getByTestId("conflicts");
    await expect(conflicts).toContainText("Afectada Por Cambio");
    // todavía NO se guardó nada y el turno sigue intacto
    expect((await pool.query("select count(*)::int n from public.working_hours where weekday=$1", [wd])).rows[0].n).toBe(2);
    expect((await pool.query("select status from public.appointments")).rows[0].status).toBe("confirmed");
    await expect(page.getByTestId("save-hours")).toBeDisabled();

    // Resolución explícita: mantener el turno
    await conflicts.getByRole("button", { name: "Mantener turno" }).click();
    await page.getByTestId("save-hours").click();
    await expect.poll(async () => (await pool.query("select count(*)::int n from public.working_hours where weekday=$1", [wd])).rows[0].n).toBe(0);
    expect((await pool.query("select status from public.appointments")).rows[0].status).toBe("confirmed");
    expect(await slotsFor(request, ids.corte, date)).toEqual([]);
  });

  test("horarios: cancelar el turno afectado entrega el aviso por WhatsApp", async ({ page, request }) => {
    const date = localDate(3);
    await bookViaApi(request, { serviceId: ids.corte, date, time: "10:00", name: "Se Cancela", phone: "261 5343434" });
    await page.goto("/admin/horarios");
    const day = page.getByTestId(`day-${isoWeekday(date)}`);
    // cambiamos el primer tramo a la tarde solamente (se elimina el tramo de la mañana)
    await day.getByRole("button", { name: "Quitar tramo" }).first().click();
    await page.getByTestId("save-hours").click();
    const conflicts = page.getByTestId("conflicts");
    await expect(conflicts).toContainText("Se Cancela");
    await conflicts.getByRole("button", { name: "Cancelar turno" }).click();
    await page.getByTestId("save-hours").click();
    await expect(page.getByRole("link", { name: /Avisar a Se Cancela por WhatsApp/ })).toHaveAttribute("href", /^https:\/\/wa\.me\/5492615343434/);
    expect((await pool.query("select status, cancelled_by from public.appointments")).rows[0]).toEqual({ status: "cancelled", cancelled_by: "admin" });
    expect(await slotsFor(request, ids.corte, date)).not.toContain("10:00");
    expect(await slotsFor(request, ids.corte, date)).toContain("16:00");
  });

  test("horarios: ampliar disponibilidad se aplica sin advertencias y la página pública lo refleja", async ({ page, request }) => {
    const date = localDate(3);
    const wd = isoWeekday(date);
    await page.goto("/admin/horarios");
    const day = page.getByTestId(`day-${wd}`);
    await day.getByLabel(/apertura tramo 1/).fill("08:00");
    await page.getByTestId("save-hours").click();
    await expect(page.getByText("Horarios guardados.")).toBeVisible();
    expect(await slotsFor(request, ids.corte, date)).toContain("08:00");
  });

  test("reglas de reserva: anticipación, días futuros y reservas pausadas", async ({ page, request }) => {
    await page.goto("/admin/horarios");
    await page.locator("#p-max").fill("3");
    await page.locator("#p-int").fill("60");
    await page.getByRole("button", { name: "Guardar reglas" }).click();
    await expect(page.getByText("Reglas guardadas.")).toBeVisible();
    expect(await slotsFor(request, ids.corte, localDate(10))).toEqual([]);
    const s = await slotsFor(request, ids.corte, localDate(2));
    expect(s.slice(0, 3)).toEqual(["09:00", "10:00", "11:00"]);
    await page.getByRole("checkbox").uncheck();
    await page.getByRole("button", { name: "Guardar reglas" }).click();
    await expect.poll(async () => (await pool.query("select booking_enabled from public.business_settings")).rows[0].booking_enabled).toBe(false);
    const r = await bookViaApi(request, { serviceId: ids.corte, date: localDate(2), time: "09:00" });
    expect(r.status()).toBe(409); // sin horarios ofrecidos
  });

  test("datos del negocio: nombre, WhatsApp e Instagram se reflejan en la página pública; WhatsApp inválido se rechaza", async ({ page, browser }) => {
    await page.goto("/admin/negocio");
    await page.locator("#b-name").fill("DON GABO BARBER STUDIO");
    await page.locator("#b-addr").fill("Calle Falsa 123, Mendoza");
    await page.locator("#b-wa").fill("12");
    await page.getByRole("button", { name: "Guardar datos" }).click();
    await expect(page.getByText(/WhatsApp no es válido/)).toBeVisible();
    await page.locator("#b-wa").fill("261 5123456");
    await page.getByRole("button", { name: "Guardar datos" }).click();
    await expect(page.getByText("Datos guardados.")).toBeVisible();
    const pub = await browser.newPage({ extraHTTPHeaders: { "x-forwarded-for": "10.55.6.6" } });
    await pub.goto(`${process.env.E2E_BASE_URL ?? "http://localhost:3100"}/`);
    await expect(pub.getByText("Calle Falsa 123, Mendoza")).toBeVisible();
    await expect(pub.getByRole("link", { name: "Escribir por WhatsApp" })).toHaveAttribute("href", /wa\.me\/5492615123456/);
    await pub.close();
  });

  test("Gabo puede generar un nuevo enlace privado para el cliente", async ({ page, request }) => {
    const date = localDate(2);
    const r = await bookViaApi(request, { serviceId: ids.corte, date, time: "10:00", name: "Perdió Enlace" });
    const oldPath = new URL((await r.json()).manageUrl).pathname;
    await page.goto(`/admin/agenda?view=dia&date=${date}`);
    await page.getByTestId("appointment-row").filter({ hasText: "Perdió Enlace" }).click();
    await page.getByRole("dialog").getByText("Generar nuevo enlace privado para el cliente").click();
    const url = await page.getByRole("dialog").locator("p.break-all").innerText();
    expect(url).toMatch(/\/turno\/[A-Za-z0-9_-]{43}$/);
    await page.goto(new URL(url).pathname);
    await expect(page.getByTestId("appointment-details")).toContainText("Perdió Enlace");
    await page.goto(oldPath);
    await expect(page.getByText("No encontramos este turno")).toBeVisible();
  });
});
