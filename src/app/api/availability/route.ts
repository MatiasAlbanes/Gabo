import type { NextRequest } from "next/server";
import { availabilityQuery } from "@/lib/validation";
import { todayInTz } from "@/lib/time";
import { getAvailability, loadActiveService, loadSettings } from "@/lib/server/availability-service";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { fail, json } from "@/lib/server/http";

/** Disponibilidad pública: devuelve SOLO horarios libres. Nunca nombres ni teléfonos. */
export async function GET(request: NextRequest) {
  try {
    await enforceRateLimit(request.headers, "avail", 120, 60);
    const q = availabilityQuery.parse(Object.fromEntries(request.nextUrl.searchParams));
    const [service, settings] = await Promise.all([loadActiveService(q.serviceId), loadSettings()]);
    const { days } = await getAvailability({
      service: { durationMinutes: service.duration_minutes, bufferMinutes: service.buffer_minutes },
      from: q.from ?? todayInTz(Date.now(), settings.timezone),
      days: Math.min(q.days, settings.max_days_ahead + 1),
      mode: "public",
    });
    return json({ days, serverNow: Date.now() });
  } catch (e) {
    return fail(e);
  }
}
