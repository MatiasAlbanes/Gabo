import Link from "next/link";
import { requireAdminPage } from "@/lib/server/admin";
import { nowMs } from "@/lib/server/now";
import { loadAppointmentsBetween, loadSettingsFor, toAdminView } from "@/lib/server/admin-data";
import { addDays, daysInMonth, formatDateLong, formatDateShort, isValidDateStr, isoWeekday, monthName, parseDate, startOfMonth, startOfWeek, todayInTz, weekdayName } from "@/lib/time";
import type { Service } from "@/lib/types";
import { AppointmentList, NewAppointmentButton } from "@/components/admin/appointments";
import { cx } from "@/lib/cx";

type View = "dia" | "semana" | "mes";

export default async function AgendaPage({ searchParams }: { searchParams: Promise<{ view?: string; date?: string }> }) {
  const sp = await searchParams;
  const { sb } = await requireAdminPage();
  const settings = await loadSettingsFor(sb);
  const tz = settings.timezone;
  const today = todayInTz(nowMs(), tz);
  const view: View = sp.view === "semana" || sp.view === "mes" ? sp.view : "dia";
  const date = sp.date && isValidDateStr(sp.date) ? sp.date : today;

  const step = view === "dia" ? 1 : view === "semana" ? 7 : 0;
  const prev = view === "mes" ? addDays(startOfMonth(date), -1) : addDays(date, -step);
  const next = view === "mes" ? addDays(startOfMonth(date), daysInMonth(date)) : addDays(date, step);
  const href = (v: View, d: string) => `/admin/agenda?view=${v}&date=${d}`;

  const { data: svc } = await sb.from("services").select("*").eq("active", true).order("sort_order");
  const services = (svc ?? []) as Service[];

  let title = "";
  let body: React.ReactNode = null;

  if (view === "dia") {
    title = formatDateLong(date, true);
    const appts = (await loadAppointmentsBetween(sb, date, date, tz)).map((a) => toAdminView(a, settings));
    body = <AppointmentList appointments={appts} today={today} emptyText="No hay turnos este día." />;
  } else if (view === "semana") {
    const start = startOfWeek(date);
    const end = addDays(start, 6);
    title = `${formatDateShort(start)} – ${formatDateShort(end)}`;
    const appts = (await loadAppointmentsBetween(sb, start, end, tz)).map((a) => toAdminView(a, settings));
    body = (
      <div className="grid gap-4 md:grid-cols-7 md:gap-2">
        {Array.from({ length: 7 }, (_, i) => addDays(start, i)).map((d) => {
          const list = appts.filter((a) => a.date === d);
          const active = list.filter((a) => a.status !== "cancelled").length;
          return (
            <section key={d} aria-label={formatDateLong(d)} className="min-w-0">
              <Link href={href("dia", d)} className={cx("mb-2 flex items-baseline justify-between rounded-xl px-3 py-2 text-sm font-medium", d === today ? "bg-neutral-950 text-white" : "bg-white ring-1 ring-neutral-200 hover:ring-neutral-950")}>
                <span className="capitalize">{weekdayName(isoWeekday(d), true)} {parseDate(d).d}</span>
                <span className="text-xs opacity-70">{active}</span>
              </Link>
              <AppointmentList appointments={list} today={today} emptyText="—" compact />
            </section>
          );
        })}
      </div>
    );
  } else {
    const first = startOfMonth(date);
    const gridStart = startOfWeek(first);
    const last = addDays(first, daysInMonth(date) - 1);
    const gridEnd = addDays(startOfWeek(last), 6);
    const { m, y } = parseDate(first);
    title = `${monthName(m)} ${y}`;
    const appts = await loadAppointmentsBetween(sb, gridStart, gridEnd, tz, ["confirmed", "completed", "no_show"]);
    const counts = new Map<string, number>();
    for (const a of appts) {
      const d = toAdminView(a, settings).date;
      counts.set(d, (counts.get(d) ?? 0) + 1);
    }
    const cells: string[] = [];
    for (let d = gridStart; d <= gridEnd; d = addDays(d, 1)) cells.push(d);
    body = (
      <div>
        <div className="mb-1 grid grid-cols-7 text-center text-xs uppercase tracking-wide text-neutral-500">
          {[1, 2, 3, 4, 5, 6, 7].map((d) => <span key={d}>{weekdayName(d, true)}</span>)}
        </div>
        <div className="grid grid-cols-7 gap-1" data-testid="month-grid">
          {cells.map((d) => {
            const n = counts.get(d) ?? 0;
            const inMonth = d.slice(0, 7) === first.slice(0, 7);
            return (
              <Link key={d} href={href("dia", d)} aria-label={`${formatDateLong(d)}, ${n} turnos`} className={cx("flex h-14 min-w-0 flex-col items-center justify-between rounded-xl p-1 text-sm ring-1", inMonth ? "bg-white ring-neutral-200 hover:ring-neutral-950" : "bg-transparent text-neutral-300 ring-transparent", d === today && "ring-2 ring-neutral-950")}>
                <span className="font-display text-lg font-semibold leading-none">{parseDate(d).d}</span>
                {n > 0 && <span className="rounded-full bg-neutral-950 px-2 text-xs font-medium text-white">{n}</span>}
              </Link>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-display text-3xl font-semibold uppercase tracking-wide">Agenda</h1>
        <NewAppointmentButton services={services} today={today} defaultDate={view === "dia" ? date : undefined} />
      </div>

      <div className="flex items-center justify-between gap-2">
        <div className="grid grid-cols-3 rounded-xl bg-neutral-200/60 p-1 text-sm font-medium" role="tablist" aria-label="Vista">
          {(["dia", "semana", "mes"] as const).map((v) => (
            <Link key={v} href={href(v, date)} role="tab" aria-selected={view === v} className={cx("rounded-lg px-4 py-2 text-center capitalize", view === v ? "bg-white shadow-sm" : "text-neutral-600")}>
              {v === "dia" ? "Día" : v === "semana" ? "Semana" : "Mes"}
            </Link>
          ))}
        </div>
        <Link href={href(view, today)} className="rounded-xl border border-neutral-300 px-3 py-2 text-sm font-medium hover:bg-white">Hoy</Link>
      </div>

      <div className="flex items-center justify-between">
        <Link href={href(view, prev)} aria-label="Anterior" className="grid size-11 place-items-center rounded-xl border border-neutral-300 bg-white text-lg">‹</Link>
        <h2 className="text-center font-medium first-letter:uppercase" data-testid="agenda-title">{title}</h2>
        <Link href={href(view, next)} aria-label="Siguiente" className="grid size-11 place-items-center rounded-xl border border-neutral-300 bg-white text-lg">›</Link>
      </div>

      {body}
    </div>
  );
}
