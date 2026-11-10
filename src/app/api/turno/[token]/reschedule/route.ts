import type { NextRequest } from "next/server";
import { rescheduleSchema } from "@/lib/validation";
import { findByToken, rescheduleAppointment, toPublic } from "@/lib/server/appointments";
import { loadSettings } from "@/lib/server/availability-service";
import { AppError } from "@/lib/server/errors";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { fail, json, readJson } from "@/lib/server/http";

export async function POST(request: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  try {
    await enforceRateLimit(request.headers, "manage-write", 20, 3600);
    const { token } = await ctx.params;
    const body = rescheduleSchema.parse(await readJson(request));
    const appt = await findByToken(token);
    if (!appt) throw new AppError("not_found");
    const updated = await rescheduleAppointment(appt, body.date, body.time, "client");
    const settings = await loadSettings();
    return json({ ok: true, appointment: toPublic(updated, settings.timezone) });
  } catch (e) {
    return fail(e);
  }
}
