import "server-only";
import { createHash } from "node:crypto";
import { serviceClient } from "@/lib/supabase/service";
import { AppError } from "./errors";

export function clientKey(headers: Headers): string {
  const ip = headers.get("x-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip") || "unknown";
  // Se guarda un hash: nunca la IP en claro.
  return createHash("sha256").update(`${process.env.RATE_LIMIT_SALT ?? "gabo"}:${ip}`).digest("hex").slice(0, 24);
}

/** Lanza AppError('rate_limited') si se excedió el límite. Contador atómico en Postgres. */
export async function enforceRateLimit(headers: Headers, action: string, limit: number, windowSeconds: number) {
  const key = `${action}:${clientKey(headers)}`;
  const { data, error } = await serviceClient().rpc("check_rate_limit", { p_key: key, p_limit: limit, p_window_seconds: windowSeconds });
  if (error) {
    console.error("[rate-limit]", error.message);
    return; // si el contador falla, no bloqueamos a las personas legítimas
  }
  if (data === false) throw new AppError("rate_limited");
}
