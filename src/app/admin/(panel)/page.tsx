import { requireAdminPage } from "@/lib/server/admin";
import { nowMs } from "@/lib/server/now";
import { loadAppointmentsBetween, loadSettingsFor, toAdminView } from "@/lib/server/admin-data";
import { getAvailability } from "@/lib/server/availability-service";
import { formatDateLong, todayInTz } from "@/lib/time";
import type { Appointment, Service } from "@/lib/types";
import { APPOINTMENT_COLUMNS } from "@/lib/types";
import { AppointmentList, NewAppointmentButton } from "@/components/admin/appointments";
import { Notice } from "@/components/ui";

export default async function TodayPage() {
  const { sb } = await requireAdminPage();
  const settings = await loadSettingsFor(sb);
  const tz = settings.timezone;
  const now = nowMs();
  const today = todayInTz(now, tz);

  const [todays, nextRes, svcRes] = await Promise.all([
    loadAppointmentsBetween(sb, today, today, tz),
    sb.from("appointments").select(APPOINTMENT_COLUMNS).eq("status", "confirmed").gte("end_at", new Date(now).toISOString()).order("start_at").limit(1),
    sb.from("services").select("*").eq("active", true).order("sort_order"),
  ]);
  const services = (svcRes.data ?? []) as Service[];
  const next = ((nextRes.data ?? []) as Appointment[])[0];

  // Horarios libres hoy, medidos con el servicio más corto.
  let free: string[] = [];
  const shortest = [...services].sort((a, b) => a.duration_minutes - b.duration_minutes)[0];
  if (shortest) {
    const { days } = await getAvailability({ service: { durationMinutes: shortest.duration_minutes, bufferMinutes: shortest.buffer_minutes }, from: today, days: 1, mode: "admin" });
    free = days[0]?.slots ?? [];
  }

  const count = (s: string) => todays.filter((a) => a.status === s).length;
  const views = todays.map((a) => toAdminView(a, settings));
  const stats = [
    { label: "Turnos del día", value: todays.filter((a) => a.status !== "cancelled").length },
    { label: "Pendientes", value: count("confirmed") },
    { label: "Completados", value: count("completed") },
    { label: "Cancelados", value: count("cancelled") },
    { label: "Horarios libres", value: free.length },
  ];

  return (
    <div className="space-y-7">
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="text-sm text-neutral-500">Hoy</p>
          <h1 className="font-display text-3xl font-semibold leading-none tracking-wide first-letter:uppercase" data-testid="today-title">{formatDateLong(today, true)}</h1>
        </div>
        <NewAppointmentButton services={services} today={today} defaultDate={today} />
      </div>

      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {stats.map((s) => (
          <div key={s.label} className="rounded-2xl border border-neutral-200 bg-white p-3" data-testid={`stat-${s.label}`}>
            <dd className="font-display text-3xl font-semibold leading-none">{s.value}</dd>
            <dt className="mt-1 text-xs text-neutral-500">{s.label}</dt>
          </div>
        ))}
      </dl>

      <section aria-labelledby="h-next">
        <h2 id="h-next" className="mb-2 font-display text-xl font-semibold uppercase tracking-[0.14em]">Próximo turno</h2>
        {next ? <AppointmentList appointments={[toAdminView(next, settings)]} today={today} showDate /> : <Notice>No hay turnos próximos.</Notice>}
      </section>

      {free.length > 0 && (
        <section aria-labelledby="h-free">
          <h2 id="h-free" className="mb-2 font-display text-xl font-semibold uppercase tracking-[0.14em]">Libres hoy</h2>
          <p className="flex flex-wrap gap-1.5 text-sm tabular-nums">{free.map((t) => <span key={t} className="rounded-lg bg-white px-2.5 py-1 ring-1 ring-neutral-200">{t}</span>)}</p>
        </section>
      )}

      <section aria-labelledby="h-day">
        <h2 id="h-day" className="mb-2 font-display text-xl font-semibold uppercase tracking-[0.14em]">Turnos de hoy</h2>
        <AppointmentList appointments={views} today={today} emptyText="No hay turnos para hoy." />
      </section>
    </div>
  );
}
