import { createClient } from "@supabase/supabase-js";
import { loadStackEnv } from "../db/helpers";
import { apiHeaders, bookViaApi, expect, freshIp, localDate, pool, seed, test } from "./helpers";

const env = loadStackEnv();
const REST = `${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1`;
const anonHeaders = { apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY, authorization: `Bearer ${env.NEXT_PUBLIC_SUPABASE_ANON_KEY}` };

let ids: Awaited<ReturnType<typeof seed>>;
test.beforeEach(async () => {
  ids = await seed();
});

test.describe("privacidad de datos", () => {
  test("un visitante anónimo no puede leer turnos, bloqueos, días libres ni administradores (RLS)", async ({ request }) => {
    await bookViaApi(request, { serviceId: ids.corte, date: localDate(3), time: "10:00", name: "Dato Privado" });
    for (const table of ["appointments", "time_blocks", "time_off", "admin_users", "rate_limits"]) {
      const r = await fetch(`${REST}/${table}?select=*`, { headers: anonHeaders });
      const body = await r.text();
      expect(body, table).not.toContain("Dato Privado");
      expect(r.ok && JSON.parse(body).length > 0, `${table} no debe devolver filas`).toBe(false);
    }
  });

  test("un anónimo no puede escribir ni ejecutar el motor de reservas directamente", async () => {
    const ins = await fetch(`${REST}/appointments`, { method: "POST", headers: { ...anonHeaders, "content-type": "application/json" }, body: JSON.stringify({ client_name: "x" }) });
    expect(ins.ok).toBe(false);
    const rpc = await fetch(`${REST}/rpc/book_appointment`, { method: "POST", headers: { ...anonHeaders, "content-type": "application/json" }, body: JSON.stringify({ p_barber: ids.barber, p_service: ids.corte, p_name: "x", p_phone: "+5492615550000", p_start: new Date(Date.now() + 5 * 864e5).toISOString(), p_token_hash: "h" }) });
    expect(rpc.ok).toBe(false);
    const upd = await fetch(`${REST}/services?id=eq.${ids.corte}`, { method: "PATCH", headers: { ...anonHeaders, "content-type": "application/json" }, body: JSON.stringify({ price_ars: 1 }) });
    expect((await pool.query("select price_ars from public.services where id=$1", [ids.corte])).rows[0].price_ars).toBe(10000);
    void upd;
  });

  test("un usuario autenticado que NO es administrador tampoco ve turnos", async ({ request }) => {
    await bookViaApi(request, { serviceId: ids.corte, date: localDate(3), time: "10:00", name: "Dato Privado" });
    const svc = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
    await svc.auth.admin.createUser({ email: "cliente.curioso@example.com", password: "Curioso-12345678", email_confirm: true }).catch(() => {});
    const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
    const { data, error } = await anon.auth.signInWithPassword({ email: "cliente.curioso@example.com", password: "Curioso-12345678" });
    expect(error).toBeNull();
    const rows = await anon.from("appointments").select("*");
    expect(rows.data ?? []).toHaveLength(0);
    const w = await anon.from("services").update({ price_ars: 1 }).eq("id", ids.corte).select();
    expect(w.data ?? []).toHaveLength(0);
    expect((await pool.query("select price_ars from public.services where id=$1", [ids.corte])).rows[0].price_ars).toBe(10000);
    void data;
  });

  test("la API pública de disponibilidad no filtra nombres ni teléfonos", async ({ request }) => {
    await bookViaApi(request, { serviceId: ids.corte, date: localDate(3), time: "10:00", name: "Nombre Secreto", phone: "261 5777666" });
    const text = await (await request.get(`/api/availability?serviceId=${ids.corte}&days=10`, { headers: apiHeaders() })).text();
    expect(text).not.toContain("Secreto");
    expect(text).not.toContain("5777666");
    expect(Object.keys(JSON.parse(text).days[0]).sort()).toEqual(["date", "slots"]);
  });

  test("la clave service_role nunca llega al navegador", async ({ page }) => {
    const bodies: string[] = [];
    page.on("response", async (r) => {
      if (/\.(js|css|html)$|\/$|_next\/|\/admin/.test(r.url())) bodies.push(await r.text().catch(() => ""));
    });
    await page.goto("/");
    await page.getByRole("button", { name: /Corte de pelo/ }).click();
    await page.waitForLoadState("networkidle");
    await page.goto("/admin/login");
    await page.waitForLoadState("networkidle");
    const all = bodies.join("\n");
    expect(all.length).toBeGreaterThan(1000);
    expect(all).not.toContain(env.SUPABASE_SERVICE_ROLE_KEY);
    expect(all).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(all).not.toContain("token_hash");
  });
});

test.describe("protección contra abuso y cabeceras", () => {
  test("límite de solicitudes: demasiadas reservas desde una misma IP reciben 429", async ({ request }) => {
    const ip = freshIp();
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) {
      const r = await request.post("/api/bookings", { headers: { "x-forwarded-for": ip, "content-type": "application/json" }, data: { junk: true } });
      statuses.push(r.status());
    }
    expect(statuses.slice(0, 3)).toEqual([400, 400, 400]);
    expect(statuses.slice(3)).toEqual([429, 429]);
  });

  test("el campo trampa (honeypot) descarta bots sin crear turnos", async ({ request }) => {
    const r = await request.post("/api/bookings", { headers: apiHeaders(), data: { serviceId: ids.corte, date: localDate(3), time: "10:00", name: "Bot", phone: "261 5123456", website: "http://spam.example" } });
    expect(r.status()).toBe(201);
    expect((await pool.query("select count(*)::int n from public.appointments")).rows[0].n).toBe(0);
  });

  test("entradas inválidas se rechazan en el servidor", async ({ request }) => {
    const base = { serviceId: ids.corte, date: localDate(3), time: "10:00", name: "Ok", phone: "261 5123456" };
    for (const bad of [{ ...base, serviceId: "no-es-uuid" }, { ...base, date: "2026-02-31" }, { ...base, time: "25:99" }, { ...base, name: "   " }, { ...base, name: "x".repeat(200) }, { ...base, phone: "abc" }]) {
      expect((await request.post("/api/bookings", { headers: apiHeaders(), data: bad })).status()).toBe(400);
    }
    expect((await request.post("/api/bookings", { headers: apiHeaders(), data: "no json", })).status()).toBe(400);
    expect((await pool.query("select count(*)::int n from public.appointments")).rows[0].n).toBe(0);
  });

  test("el límite de turnos activos por teléfono frena reservas masivas", async ({ request }) => {
    await pool.query("update public.business_settings set max_active_per_phone = 2");
    const phone = "261 5444333";
    expect((await bookViaApi(request, { serviceId: ids.corte, date: localDate(3), time: "10:00", phone })).status()).toBe(201);
    expect((await bookViaApi(request, { serviceId: ids.corte, date: localDate(3), time: "10:30", phone })).status()).toBe(201);
    expect((await bookViaApi(request, { serviceId: ids.corte, date: localDate(3), time: "11:00", phone })).status()).toBe(429);
  });

  test("cabeceras de seguridad y enlaces privados sin indexar", async ({ request }) => {
    const home = await request.get("/");
    expect(home.headers()["x-frame-options"]).toBe("DENY");
    expect(home.headers()["x-content-type-options"]).toBe("nosniff");
    expect(home.headers()["strict-transport-security"]).toContain("max-age");
    expect(home.headers()["x-powered-by"]).toBeUndefined();
    const manage = await request.get("/turno/abc");
    expect(manage.headers()["x-robots-tag"]).toContain("noindex");
    expect(manage.headers()["cache-control"]).toContain("no-store");
  });
});

test.describe("errores de conexión", () => {
  test("si falla la carga de horarios se muestra un mensaje y se puede reintentar", async ({ page }) => {
    let fail = true;
    await page.route("**/api/availability*", (route) => (fail ? route.abort() : route.continue()));
    await page.goto("/");
    await page.getByRole("button", { name: /Corte de pelo/ }).click();
    await expect(page.getByText(/No pudimos conectarnos/)).toBeVisible();
    fail = false;
    await page.getByRole("button", { name: "Reintentar" }).click();
    await expect(page.getByRole("group", { name: "Días" })).toBeVisible();
  });

  test("si falla la confirmación no se muestra el turno como confirmado y no queda nada guardado", async ({ page }) => {
    await page.route("**/api/bookings", (route) => route.abort());
    await page.goto("/");
    await page.getByRole("button", { name: /Corte de pelo/ }).click();
    await page.getByRole("group", { name: "Días" }).waitFor();
    await page.locator('[role="group"][aria-label="Días"] button:not([disabled])').first().click();
    await page.locator('[role="group"][aria-label^="Horarios"] button').first().click();
    await page.locator("#name").fill("Sin Señal");
    await page.locator("#phone").fill("261 5123456");
    await page.getByRole("button", { name: /confirmar turno/i }).click();
    await expect(page.getByText(/todavía NO está confirmado/)).toBeVisible();
    await expect(page.getByTestId("confirmation")).toHaveCount(0);
    expect((await pool.query("select count(*)::int n from public.appointments")).rows[0].n).toBe(0);
  });
});
