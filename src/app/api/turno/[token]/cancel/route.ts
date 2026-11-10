import type { NextRequest } from "next/server";
import { cancelByToken, toPublic } from "@/lib/server/appointments";
import { loadSettings } from "@/lib/server/availability-service";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { fail, json } from "@/lib/server/http";

export async function POST(request: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  try {
    await enforceRateLimit(request.headers, "manage-write", 20, 3600);
    const { token } = await ctx.params;
    const a = await cancelByToken(token);
    const settings = await loadSettings();
    return json({ ok: true, appointment: toPublic(a, settings.timezone) });
  } catch (e) {
    return fail(e);
  }
}
