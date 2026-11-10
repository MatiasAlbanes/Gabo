import { ADMIN_STATE, bookViaApi, expect, expectNoHorizontalOverflow, localDate, pickDay, seed, test } from "./helpers";

const SIZES = [
  { name: "iPhone SE (320)", width: 320, height: 568 },
  { name: "iPhone 14 (390)", width: 390, height: 844 },
  { name: "Android chico (360)", width: 360, height: 740 },
  { name: "Tablet (768)", width: 768, height: 1024 },
  { name: "Escritorio (1280)", width: 1280, height: 800 },
];

let ids: Awaited<ReturnType<typeof seed>>;
test.beforeEach(async () => {
  ids = await seed();
});
// Los tamaños se fijan dentro de cada prueba: basta con correrlas en un solo proyecto.
test.beforeEach(({}, info) => {
  test.skip(info.project.name !== "mobile", "los tamaños se recorren dentro de la prueba");
});

for (const size of SIZES) {
  test(`página pública sin desbordes y con botones táctiles cómodos · ${size.name}`, async ({ page }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    await page.goto("/");
    await expectNoHorizontalOverflow(page);
    await page.getByRole("button", { name: /Corte \+ barba/ }).click();
    await pickDay(page, localDate(2));
    await expectNoHorizontalOverflow(page);

    // los 7 días entran completos en pantalla
    const days = page.locator('[role="group"][aria-label="Días"] button');
    await expect(days).toHaveCount(7);
    for (let i = 0; i < 7; i++) {
      const box = (await days.nth(i).boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(size.width);
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
    const times = page.locator('[role="group"][aria-label^="Horarios"] button');
    await expect(times.first()).toBeVisible();
    for (const i of [0, 3]) expect((await times.nth(i).boundingBox())!.height).toBeGreaterThanOrEqual(44);

    await times.first().click();
    await expect(page.locator("#name")).toBeVisible();
    await expectNoHorizontalOverflow(page);
    const confirm = page.getByRole("button", { name: /confirmar turno/i });
    expect((await confirm.boundingBox())!.height).toBeGreaterThanOrEqual(48);
    expect((await confirm.boundingBox())!.width).toBeLessThanOrEqual(size.width);
    // los campos usan 16px: iOS no hace zoom al enfocarlos
    expect(await page.locator("#name").evaluate((e) => parseFloat(getComputedStyle(e).fontSize))).toBeGreaterThanOrEqual(16);
  });

  test(`confirmación y gestión del turno sin desbordes · ${size.name}`, async ({ page, request }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    const r = await bookViaApi(request, { serviceId: ids.corte, date: localDate(3), time: "10:00", name: "Nombre Muy Largo De Prueba Para Desbordes" });
    await page.goto(new URL((await r.json()).manageUrl).pathname);
    await expectNoHorizontalOverflow(page);
    await page.getByRole("button", { name: "Reprogramar" }).click();
    await expectNoHorizontalOverflow(page);
  });
}

test.describe("panel de administración en distintos tamaños", () => {
  test.use({ storageState: ADMIN_STATE });
  for (const size of SIZES) {
    test(`panel sin desbordes · ${size.name}`, async ({ page, request }) => {
      await bookViaApi(request, { serviceId: ids.combo, date: localDate(2), time: "10:00", name: "Nombre Muy Largo De Prueba Para Desbordes" });
      await page.setViewportSize({ width: size.width, height: size.height });
      for (const path of ["/admin", `/admin/agenda?view=dia&date=${localDate(2)}`, `/admin/agenda?view=semana&date=${localDate(2)}`, `/admin/agenda?view=mes&date=${localDate(2)}`, "/admin/turnos", "/admin/servicios", "/admin/horarios", "/admin/bloqueos", "/admin/negocio"]) {
        await page.goto(path);
        await page.waitForLoadState("networkidle");
        await expectNoHorizontalOverflow(page);
      }
      await page.goto(`/admin/agenda?view=dia&date=${localDate(2)}`);
      await page.getByTestId("appointment-row").first().click();
      await expectNoHorizontalOverflow(page);
      // navegación principal visible y usable
      await expect(page.getByRole("navigation", { name: "Principal" })).toBeVisible();
    });
  }
});
