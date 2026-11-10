import { test as base, expect, type Page, type APIRequestContext } from "@playwright/test";
import { barberId, localDate, pool, reset, seedHours, seedService, slot } from "../db/helpers";
import { formatDateLong } from "@/lib/time";

export { expect, localDate, pool, slot };

export const ADMIN = { email: "e2e.admin@example.com", password: "E2E-Password-12345" };
export const ADMIN_STATE = ".stack-data/admin-state.json";

let ipCounter = Math.floor(Math.random() * 200) + 1;
export const freshIp = () => `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${(ipCounter++ % 250) + 1}`;

/** Cada prueba usa una "IP" distinta para no chocar con el límite de solicitudes. */
export const test = base.extend({
  context: async ({ browser, contextOptions }, use) => {
    const ctx = await browser.newContext({ ...contextOptions, extraHTTPHeaders: { "x-forwarded-for": freshIp() } });
    await use(ctx);
    await ctx.close();
  },
});

export const apiHeaders = () => ({ "x-forwarded-for": freshIp(), "content-type": "application/json" });

/** Datos de PRUEBA: abierto todos los días 09-13 y 16-21, tres servicios ilustrativos. */
export async function seed() {
  await reset();
  await pool.query("update public.business_settings set whatsapp = '+5492615550000', address = null, name = 'DON GABO BARBER STUDIO', cancel_notice_hours = 2, min_notice_minutes = 60, max_days_ahead = 30, booking_enabled = true");
  const b = await barberId();
  await seedHours(b);
  const corte = await seedService({ name: "Corte de pelo", price: 10000, duration: 30 });
  const combo = await seedService({ name: "Corte + barba", price: 15000, duration: 60 });
  const barba = await seedService({ name: "Barba", price: 7000, duration: 30 });
  await pool.query("update public.services set sort_order = case id when $1 then 1 when $2 then 2 else 3 end", [corte, combo]);
  return { barber: b, corte, combo, barba };
}

export async function pickDay(page: Pick<Page, "getByRole">, date: string) {
  await page.getByRole("group", { name: "Días" }).waitFor();
  const btn = page.getByRole("button", { name: new RegExp(`^${formatDateLong(date)},`) });
  for (let i = 0; i < 8 && !(await btn.isVisible()); i++) await page.getByRole("button", { name: "Semana siguiente" }).click();
  await btn.click();
}

export async function bookViaUi(page: Page, o: { service: string | RegExp; date: string; time: string; name: string; phone: string }) {
  await page.goto("/");
  await page.getByRole("button", { name: o.service }).click();
  await pickDay(page, o.date);
  await page.getByRole("button", { name: o.time, exact: true }).click();
  await page.locator("#name").fill(o.name);
  await page.locator("#phone").fill(o.phone);
  await page.getByRole("button", { name: /confirmar turno/i }).click();
}

export async function bookViaApi(request: APIRequestContext, o: { serviceId: string; date: string; time: string; name?: string; phone?: string }) {
  return request.post("/api/bookings", { headers: apiHeaders(), data: { serviceId: o.serviceId, date: o.date, time: o.time, name: o.name ?? "Cliente API", phone: o.phone ?? "261 5" + String(100000 + Math.floor(Math.random() * 899999)) } });
}

export async function adminLogin(page: Page) {
  await page.goto("/admin/login");
  await page.locator("#email").fill(ADMIN.email);
  await page.locator("#password").fill(ADMIN.password);
  await page.getByRole("button", { name: "Ingresar" }).click();
  await page.waitForURL("**/admin");
}

/** Evita desbordes horizontales (calendarios cortados, botones afuera de la pantalla). */
export async function expectNoHorizontalOverflow(page: Page) {
  const { scroll, inner } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }));
  expect(scroll, `scrollWidth ${scroll} > innerWidth ${inner}`).toBeLessThanOrEqual(inner);
}
