import { ADMIN_STATE, bookViaApi, bookViaUi, expect, localDate, pickDay, pool, seed, slot, test } from "./helpers";
import { formatDateLong } from "@/lib/time";

let ids: Awaited<ReturnType<typeof seed>>;
test.beforeEach(async () => {
  ids = await seed();
});

test.describe("reserva del cliente", () => {
  test("reserva completa en una sola página, se guarda en la base y deja el horario ocupado", async ({ page }) => {
    const date = localDate(2);
    await bookViaUi(page, { service: /Corte de pelo/, date, time: "10:00", name: "Ana Prueba", phone: "261 5123456" });

    const conf = page.getByTestId("confirmation");
    await expect(conf).toContainText("¡Turno confirmado!");
    await expect(conf).toContainText("Corte de pelo");
    await expect(conf).toContainText(formatDateLong(date));
    await expect(conf).toContainText("10:00 a 10:30 hs");
    await expect(conf).toContainText("Ana Prueba");
    expect(new URL(page.url()).pathname).toBe("/"); // nunca salimos de la página

    // 2 + 17) Persistió en la base, con la zona horaria de Mendoza (10:00 locales = 13:00 UTC) y teléfono normalizado
    const { rows } = await pool.query("select * from public.appointments");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ client_name: "Ana Prueba", client_phone: "+5492615123456", status: "confirmed", service_name: "Corte de pelo", source: "online" });
    expect(new Date(rows[0].start_at).toISOString()).toBe(slot(date, "10:00"));
    expect(new Date(rows[0].start_at).toISOString().slice(11, 16)).toBe("13:00");
    expect(rows[0].token_hash).toHaveLength(64);

    // 4) El horario ya no aparece disponible
    await page.reload();
    await page.getByRole("button", { name: /Corte de pelo/ }).click();
    await pickDay(page, date);
    await expect(page.getByRole("button", { name: "09:30", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "10:00", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "10:30", exact: true })).toBeVisible();
  });

  test("un servicio de 60 minutos bloquea dos horarios contiguos", async ({ page, request }) => {
    const date = localDate(3);
    expect((await bookViaApi(request, { serviceId: ids.combo, date, time: "10:00" })).status()).toBe(201);
    await page.goto("/");
    await page.getByRole("button", { name: /Corte de pelo/ }).click();
    await pickDay(page, date);
    for (const t of ["10:00", "10:30"]) await expect(page.getByRole("button", { name: t, exact: true })).toHaveCount(0);
    for (const t of ["09:30", "11:00"]) await expect(page.getByRole("button", { name: t, exact: true })).toBeVisible();
  });

  test("valida nombre y WhatsApp antes de enviar y no crea turnos inválidos", async ({ page }) => {
    const date = localDate(2);
    await bookViaUi(page, { service: /Barba/, date, time: "11:00", name: "Pedro", phone: "123" });
    await expect(page.getByText(/WhatsApp válido/)).toBeVisible();
    await page.locator("#name").fill("");
    await page.locator("#phone").fill("261 5123456");
    await page.getByRole("button", { name: /confirmar turno/i }).click();
    await expect(page.getByText("Escribí tu nombre.")).toBeVisible();
    expect((await pool.query("select count(*)::int n from public.appointments")).rows[0].n).toBe(0);
  });

  test("si el horario se ocupa mientras el cliente completa los datos, el servidor rechaza la confirmación", async ({ page, request }) => {
    const date = localDate(2);
    let first = true;
    // Simula una pantalla con datos viejos: solo se deja pasar la primera consulta de disponibilidad.
    await page.route("**/api/availability*", (route) => (first ? ((first = false), route.continue()) : route.abort()));
    await page.goto("/");
    await page.getByRole("button", { name: /Corte de pelo/ }).click();
    await pickDay(page, date);
    await page.getByRole("button", { name: "12:00", exact: true }).click();
    await page.locator("#name").fill("Lenta");
    await page.locator("#phone").fill("261 5000000");
    // otra persona reserva ese horario justo antes de que confirmemos
    expect((await bookViaApi(request, { serviceId: ids.corte, date, time: "12:00" })).status()).toBe(201);
    await page.getByRole("button", { name: /confirmar turno/i }).click();
    await expect(page.getByText(/se acaba de ocupar|ya no está disponible/).first()).toBeVisible();
    await expect(page.getByTestId("confirmation")).toHaveCount(0);
    expect((await pool.query("select count(*)::int n from public.appointments where client_name='Lenta'")).rows[0].n).toBe(0);
  });

  test("al volver a la pestaña se refresca la disponibilidad y se avisa si el horario elegido ya no está", async ({ page, request }) => {
    const date = localDate(2);
    await page.goto("/");
    await page.getByRole("button", { name: /Corte de pelo/ }).click();
    await pickDay(page, date);
    await page.getByRole("button", { name: "12:00", exact: true }).click();
    await expect(page.locator("#name")).toBeVisible();
    expect((await bookViaApi(request, { serviceId: ids.corte, date, time: "12:00" })).status()).toBe(201);
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await expect(page.getByText("Ese horario se acaba de ocupar. Elegí otro, por favor.")).toBeVisible();
    await expect(page.getByRole("button", { name: "12:00", exact: true })).toHaveCount(0);
    await expect(page.locator("#name")).toHaveCount(0);
  });

  test("cambios de servicios (precio, nombre, desactivar) se reflejan en la página pública", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("button", { name: /Barba/ })).toContainText("$7.000");
    await pool.query("update public.services set price_ars = 8500, name = 'Barba premium' where id = $1", [ids.barba]);
    await page.reload();
    await expect(page.getByRole("button", { name: /Barba premium/ })).toContainText("$8.500");
    await pool.query("update public.services set active = false where id = $1", [ids.barba]);
    await page.reload();
    await expect(page.getByRole("button", { name: /Barba premium/ })).toHaveCount(0);
  });

  test("la página muestra aviso (sin romperse) cuando no hay servicios u horarios configurados", async ({ page }) => {
    await pool.query("delete from public.working_hours");
    await page.goto("/");
    await expect(page.getByText("Las reservas online todavía no están disponibles")).toBeVisible();
    await expect(page.getByRole("button", { name: /confirmar/i })).toHaveCount(0);
  });

  test("los bloqueos, días libres y reducciones de horario afectan la disponibilidad pública", async ({ request }) => {
    const date = localDate(2);
    const get = async () => ((await (await request.get(`/api/availability?serviceId=${ids.corte}&from=${date}&days=1`, { headers: { "x-forwarded-for": "10.77.1.1" } })).json()).days[0].slots as string[]);
    expect(await get()).toContain("17:00");
    await pool.query("insert into public.time_blocks (barber_id, start_at, end_at) values ($1,$2,$3)", [ids.barber, slot(date, "17:00"), slot(date, "18:00")]);
    const blocked = await get();
    expect(blocked).not.toContain("17:00");
    expect(blocked).not.toContain("17:30");
    expect(blocked).toContain("18:00");
    await pool.query("insert into public.time_off (barber_id, kind, start_date, end_date) values ($1,'holiday',$2,$2)", [ids.barber, date]);
    expect(await get()).toEqual([]);
  });

  test("no hay horarios fuera del horario laboral ni en el pasado; el servidor rechaza intentos manuales", async ({ request }) => {
    const date = localDate(2);
    for (const time of ["08:30", "13:00", "15:30", "21:00", "10:07"]) {
      const r = await bookViaApi(request, { serviceId: ids.corte, date, time });
      expect(r.status(), `hora ${time}`).toBe(409);
    }
    expect((await bookViaApi(request, { serviceId: ids.corte, date: localDate(-1), time: "10:00" })).status()).toBeGreaterThanOrEqual(400);
    expect((await pool.query("select count(*)::int n from public.appointments")).rows[0].n).toBe(0);
  });

  test("dos clientes simultáneos por el mismo horario: solo uno confirma", async ({ request }) => {
    const date = localDate(4);
    const results = await Promise.all(Array.from({ length: 6 }, () => bookViaApi(request, { serviceId: ids.corte, date, time: "18:00" })));
    const statuses = results.map((r) => r.status()).sort();
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(5);
    expect((await pool.query("select count(*)::int n from public.appointments")).rows[0].n).toBe(1);
  });
});

test.describe("el turno aparece en el panel", () => {
  test.use({ storageState: ADMIN_STATE });
  test("reserva online → visible para Gabo con teléfono y WhatsApp, y persiste al recargar", async ({ page, request }) => {
    const date = localDate(2);
    await bookViaApi(request, { serviceId: ids.corte, date, time: "16:00", name: "Julia Visible", phone: "261 5987654" });
    await page.goto(`/admin/turnos?q=Julia`);
    const row = page.getByTestId("appointment-row").filter({ hasText: "Julia Visible" });
    await expect(row).toBeVisible();
    await row.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("+54 9 261 598-7654".replace(/-/g, " ").slice(0, 8)); // prefijo del teléfono formateado
    await expect(dialog.getByRole("link", { name: "WhatsApp" })).toHaveAttribute("href", /^https:\/\/wa\.me\/5492615987654\?text=/);
    await page.reload();
    await expect(page.getByTestId("appointment-row").filter({ hasText: "Julia Visible" })).toBeVisible();
  });
});
