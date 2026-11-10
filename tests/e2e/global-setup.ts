import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { chromium, type FullConfig } from "@playwright/test";
import { ADMIN, ADMIN_STATE, seed } from "./helpers";
import { loadStackEnv } from "../db/helpers";

export default async function globalSetup(config: FullConfig) {
  await seed();
  const env = loadStackEnv();
  execFileSync("node", ["scripts/create-admin.mjs", ADMIN.email, ADMIN.password, "owner"], {
    env: { ...process.env, NEXT_PUBLIC_SUPABASE_URL: env.NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY },
    stdio: "inherit",
  });
  mkdirSync(".stack-data", { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ baseURL: config.projects[0].use.baseURL, extraHTTPHeaders: { "x-forwarded-for": "10.250.250.250" } });
  const page = await ctx.newPage();
  await page.goto("/admin/login");
  await page.locator("#email").fill(ADMIN.email);
  await page.locator("#password").fill(ADMIN.password);
  await page.getByRole("button", { name: "Ingresar" }).click();
  await page.waitForURL("**/admin");
  await ctx.storageState({ path: ADMIN_STATE });
  await browser.close();
}
