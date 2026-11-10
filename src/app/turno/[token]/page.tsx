import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { clientCanModify, findByToken, toPublic } from "@/lib/server/appointments";
import { loadSettings } from "@/lib/server/availability-service";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { AppError } from "@/lib/server/errors";
import { nowMs } from "@/lib/server/now";
import { todayInTz } from "@/lib/time";
import { ManageAppointment } from "@/components/public/ManageAppointment";
import { Header } from "@/components/public/Header";

export const metadata: Metadata = { title: "Tu turno", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function ManagePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let limited = false;
  try {
    await enforceRateLimit(await headers(), "manage-view", 60, 60);
  } catch (e) {
    if (e instanceof AppError && e.code === "rate_limited") limited = true;
    else throw e;
  }

  const settings = await loadSettings();
  const appt = limited ? null : await findByToken(token);

  if (!appt) {
    return (
      <div className="mx-auto min-h-dvh max-w-lg">
        <Header business={settings} />
        <main className="px-5 py-12 text-center">
          <h2 className="font-display text-3xl font-semibold uppercase tracking-wide">{limited ? "Demasiados intentos" : "No encontramos este turno"}</h2>
          <p className="mt-2 text-neutral-600">{limited ? "Esperá un momento y volvé a abrir el enlace." : "El enlace puede estar incompleto o ser incorrecto. Revisá el mensaje donde lo recibiste."}</p>
          <Link href="/" className="mt-6 inline-block rounded-xl bg-neutral-950 px-5 py-3 font-medium text-white">
            Reservar un turno
          </Link>
        </main>
      </div>
    );
  }

  return (
    <div className="mx-auto min-h-dvh max-w-lg">
      <Header business={settings} />
      <main className="px-5 pb-12 pt-4">
        <ManageAppointment
          token={token}
          initial={toPublic(appt, settings.timezone)}
          canModify={clientCanModify(appt, settings.cancel_notice_hours)}
          cancelNoticeHours={settings.cancel_notice_hours}
          business={{ name: settings.name, whatsapp: settings.whatsapp, timezone: settings.timezone, max_days_ahead: settings.max_days_ahead }}
          today={todayInTz(nowMs(), settings.timezone)}
        />
      </main>
    </div>
  );
}
