import type { NextRequest } from "next/server";
import { bookingSchema } from "@/lib/validation";
import { createBooking, toPublic } from "@/lib/server/appointments";
import { loadSettings } from "@/lib/server/availability-service";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { fail, json, readJson, siteUrl } from "@/lib/server/http";

export async function POST(request: NextRequest) {
  try {
    await enforceRateLimit(request.headers, "book", 8, 3600);
    await enforceRateLimit(request.headers, "book-burst", 3, 60);
    const body = bookingSchema.parse(await readJson(request));

    // Honeypot: un bot completó el campo oculto. Respondemos "ok" sin hacer nada.
    if (body.website) return json({ ok: true, decoy: true }, 201);

    const { appointment, token } = await createBooking({ ...body, source: "online" });
    const settings = await loadSettings();
    return json(
      {
        ok: true,
        appointment: toPublic(appointment, settings.timezone),
        manageUrl: `${siteUrl(request)}/turno/${token}`,
      },
      201,
    );
  } catch (e) {
    return fail(e);
  }
}
