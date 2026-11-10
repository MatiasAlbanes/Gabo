import type { NextRequest } from "next/server";
import { availabilityQuery } from "@/lib/validation";
import { todayInTz } from "@/lib/time";
import { availabilityForAppointment, findByToken } from "@/lib/server/appointments";
import { loadSettings } from "@/lib/server/availability-service";
import { AppError } from "@/lib/server/errors";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { fail, json } from "@/lib/server/http";

const query = availabilityQuery.omit({ serviceId: true });

export async function GET(request: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  try {
    await enforceRateLimit(request.headers, "manage", 120, 60);
    const { token } = await ctx.params;
    const appt = await findByToken(token);
    if (!appt) throw new AppError("not_found");
    const q = query.parse(Object.fromEntries(request.nextUrl.searchParams));
    const settings = await loadSettings();
    const { days } = await availabilityForAppointment(
      appt,
      q.from ?? todayInTz(Date.now(), settings.timezone),
      Math.min(q.days, settings.max_days_ahead + 1),
      "public",
    );
    return json({ days });
  } catch (e) {
    return fail(e);
  }
}
