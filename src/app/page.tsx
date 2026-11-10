import { nowMs } from "@/lib/server/now";
import { todayInTz } from "@/lib/time";
import { anonClient } from "@/lib/supabase/service";
import type { BusinessSettings, Service } from "@/lib/types";
import { waLink, messages } from "@/lib/whatsapp";
import { BookingFlow } from "@/components/public/BookingFlow";
import { Footer, Header } from "@/components/public/Header";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const sb = anonClient();
  const [settingsRes, servicesRes, hoursRes] = await Promise.all([
    sb.from("business_settings").select("*").eq("id", 1).single(),
    sb.from("services").select("*").eq("active", true).order("sort_order").order("created_at"),
    sb.from("working_hours").select("id", { count: "exact", head: true }),
  ]);
  const business = settingsRes.data as BusinessSettings | null;
  const services = (servicesRes.data ?? []) as Service[];

  if (!business) {
    return (
      <main className="mx-auto max-w-lg px-5 py-24 text-center">
        <h1 className="font-display text-3xl font-semibold uppercase tracking-wide">Don Gabo Barber Studio</h1>
        <p className="mt-3 text-neutral-600">No pudimos cargar la página. Probá de nuevo en unos minutos.</p>
      </main>
    );
  }

  const ready = business.booking_enabled && services.length > 0 && (hoursRes.count ?? 0) > 0;

  return (
    <div className="mx-auto min-h-dvh max-w-lg">
      <Header business={business} />
      <main>
        <div className="px-5 pb-6 pt-5">
          <h2 className="font-display text-4xl font-semibold uppercase leading-none tracking-wide">Reservá tu turno</h2>
          <p className="mt-2 text-neutral-500">Elegí el día y horario que mejor te quede.</p>
        </div>
        {ready ? (
          <BookingFlow
            business={{ name: business.name, whatsapp: business.whatsapp, timezone: business.timezone, max_days_ahead: business.max_days_ahead }}
            today={todayInTz(nowMs(), business.timezone)}
            services={services}
          />
        ) : (
          <div className="mx-5 rounded-2xl border border-neutral-200 bg-neutral-50 p-5 text-neutral-700">
            <p className="font-medium text-neutral-950">Las reservas online todavía no están disponibles.</p>
            <p className="mt-1 text-sm">Pronto vas a poder reservar desde acá.</p>
            {business.whatsapp && (
              <a href={waLink(business.whatsapp, messages.clientToBusiness(business.name))} target="_blank" rel="noopener noreferrer" className="mt-3 inline-block text-sm font-medium underline">
                Escribinos por WhatsApp
              </a>
            )}
          </div>
        )}
      </main>
      <Footer business={business} />
    </div>
  );
}
