import { bookViaApi, expect, localDate, pickDay, pool, seed, slot, test, apiHeaders } from "./helpers";
import { generateToken } from "@/lib/token";

let ids: Awaited<ReturnType<typeof seed>>;
test.beforeEach(async () => {
  ids = await seed();
});

async function book(request: Parameters<typeof bookViaApi>[0], o: Parameters<typeof bookViaApi>[1]) {
  const r = await bookViaApi(request, o);
  expect(r.status()).toBe(201);
  const body = await r.json();
  return { manageUrl: new URL(body.manageUrl).pathname as string, token: new URL(body.manageUrl).pathname.split("/").pop() as string };
}
const availability = async (request: Parameters<typeof bookViaApi>[0], serviceId: string, date: string) =>
  ((await (await request.get(`/api/availability?serviceId=${serviceId}&from=${date}&days=1`, { headers: apiHeaders() })).json()).days[0].slots as string[]);

test("el cliente cancela con su enlace privado: el horario se libera y el historial se conserva", async ({ page, request }) => {
  const date = localDate(3);
  const { manageUrl } = await book(request, { serviceId: ids.corte, date, time: "11:00", name: "Carla Cancela" });
  expect(await availability(request, ids.corte, date)).not.toContain("11:00");

  await page.goto(manageUrl);
  await expect(page.getByTestId("appointment-details")).toContainText("Carla Cancela");
  await page.getByRole("button", { name: "Cancelar turno" }).click();
  await page.getByRole("button", { name: "Sí, cancelar" }).click();
  await expect(page.getByText("Tu turno fue cancelado.")).toBeVisible();
  await expect(page.getByText("Cancelado", { exact: true })).toBeVisible();

  const { rows } = await pool.query("select status, cancelled_by, cancelled_at from public.appointments");
  expect(rows).toEqual([expect.objectContaining({ status: "cancelled", cancelled_by: "client" })]);
  expect(rows[0].cancelled_at).not.toBeNull();
  expect(await availability(request, ids.corte, date)).toContain("11:00");

  await page.reload(); // persiste
  await expect(page.getByText("Cancelado", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Reprogramar" })).toHaveCount(0);
});

test("el cliente reprograma con su enlace: libera el horario viejo y ocupa el nuevo", async ({ page, request }) => {
  const date = localDate(3);
  const newDate = localDate(5);
  const { manageUrl } = await book(request, { serviceId: ids.corte, date, time: "11:00", name: "Rita Reprograma" });

  await page.goto(manageUrl);
  await page.getByRole("button", { name: "Reprogramar" }).click();
  await pickDay(page, newDate);
  await page.getByRole("button", { name: "17:30", exact: true }).click();
  await page.getByRole("button", { name: "Confirmar cambio" }).click();
  await expect(page.getByText("¡Listo! Tu turno fue reprogramado.")).toBeVisible();
  await expect(page.getByTestId("appointment-details")).toContainText("17:30 a 18:00 hs");

  const { rows } = await pool.query("select start_at, reschedule_count, status from public.appointments");
  expect(rows).toHaveLength(1);
  expect(new Date(rows[0].start_at).toISOString()).toBe(slot(newDate, "17:30"));
  expect(rows[0]).toMatchObject({ reschedule_count: 1, status: "confirmed" });
  expect(await availability(request, ids.corte, date)).toContain("11:00");
  expect(await availability(request, ids.corte, newDate)).not.toContain("17:30");
});

test("reprogramar a un horario ocupado no genera conflicto: se rechaza y el turno original queda igual", async ({ request }) => {
  const date = localDate(3);
  const a = await book(request, { serviceId: ids.corte, date, time: "10:00" });
  await book(request, { serviceId: ids.corte, date, time: "12:00" });
  const r = await request.post(`/api/turno/${a.token}/reschedule`, { headers: apiHeaders(), data: { date, time: "12:00" } });
  expect(r.status()).toBe(409);
  const { rows } = await pool.query("select start_at from public.appointments where token_hash is not null order by start_at limit 1");
  expect(new Date(rows[0].start_at).toISOString()).toBe(slot(date, "10:00"));
});

test("dentro del plazo mínimo no se puede modificar online: se pide contactar al local", async ({ page, request }) => {
  const date = localDate(1);
  const { manageUrl, token } = await book(request, { serviceId: ids.corte, date, time: "12:00" });
  await pool.query("update public.business_settings set cancel_notice_hours = 100000");
  await page.goto(manageUrl);
  await expect(page.getByText(/contactá al local/i)).toBeVisible();
  await expect(page.getByRole("button", { name: "Cancelar turno" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Reprogramar" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /Contactar al local/ })).toHaveAttribute("href", /^https:\/\/wa\.me\/5492615550000/);
  // y el servidor lo hace cumplir aunque alguien llame a la API directamente
  const r = await request.post(`/api/turno/${token}/cancel`, { headers: apiHeaders() });
  expect(r.status()).toBe(403);
  expect((await pool.query("select status from public.appointments")).rows[0].status).toBe("confirmed");
});

test("un cliente no puede ver ni tocar turnos ajenos (tokens inventados o secuenciales)", async ({ page, request }) => {
  const date = localDate(3);
  const mine = await book(request, { serviceId: ids.corte, date, time: "10:00", name: "Dueño Legítimo" });
  await book(request, { serviceId: ids.corte, date, time: "10:30", name: "Persona Ajena" });

  await page.goto(mine.manageUrl);
  await expect(page.getByTestId("appointment-details")).toContainText("Dueño Legítimo");
  await expect(page.locator("body")).not.toContainText("Persona Ajena");

  for (const bad of [generateToken(), "1", "2", "00000000-0000-0000-0000-000000000001", mine.token.slice(0, -1) + (mine.token.endsWith("A") ? "B" : "A")]) {
    await page.goto(`/turno/${bad}`);
    await expect(page.getByText("No encontramos este turno")).toBeVisible();
    await expect(page.locator("body")).not.toContainText("Dueño Legítimo");
    expect((await request.post(`/api/turno/${bad}/cancel`, { headers: apiHeaders() })).status()).toBe(404);
    expect((await request.get(`/api/turno/${bad}/availability`, { headers: apiHeaders() })).status()).toBe(404);
  }
  expect((await pool.query("select count(*)::int n from public.appointments where status='confirmed'")).rows[0].n).toBe(2);
});

test("el token no se guarda en la base: solo su hash", async ({ request }) => {
  const { token } = await book(request, { serviceId: ids.corte, date: localDate(3), time: "10:00" });
  const { rows } = await pool.query("select token_hash from public.appointments");
  expect(rows[0].token_hash).not.toBe(token);
  expect(rows[0].token_hash).toMatch(/^[0-9a-f]{64}$/);
});
