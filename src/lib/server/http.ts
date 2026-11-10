import "server-only";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { AppError } from "./errors";

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

export function fail(e: unknown) {
  if (e instanceof AppError) return json({ error: { code: e.code, message: e.message } }, e.status);
  if (e instanceof ZodError) return json({ error: { code: "invalid", message: "Revisá los datos ingresados." } }, 400);
  console.error("[unhandled]", e);
  return json({ error: { code: "internal", message: new AppError("internal").message } }, 500);
}

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new AppError("invalid");
  }
}

export function siteUrlFromHeaders(headers: Headers): string {
  const env = process.env.NEXT_PUBLIC_SITE_URL;
  if (env && !env.includes("localhost")) return env.replace(/\/$/, "");
  const proto = headers.get("x-forwarded-proto") ?? "http";
  const host = headers.get("x-forwarded-host") ?? headers.get("host");
  return host ? `${proto}://${host}` : (env ?? "http://localhost:3000");
}

export function siteUrl(request: Request): string {
  return siteUrlFromHeaders(request.headers);
}
