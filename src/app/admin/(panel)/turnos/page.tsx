import Link from "next/link";
import { requireAdminPage } from "@/lib/server/admin";
import { nowMs } from "@/lib/server/now";
import { loadSettingsFor, toAdminView } from "@/lib/server/admin-data";
import { addDays, isValidDateStr, todayInTz, zonedToUtcMs } from "@/lib/time";
import { APPOINTMENT_COLUMNS, type Appointment } from "@/lib/types";
import { AppointmentList } from "@/components/admin/appointments";
import { IconSearch } from "@/components/icons";
import { cx } from "@/lib/cx";

function parseDateQuery(q: string, today: string): string | null {
  if (isValidDateStr(q)) return q;
  const m = q.match(/^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?$/);
  if (!m) return null;
  const year = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : Number(today.slice(0, 4));
  const d = `${year}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return isValidDateStr(d) ? d : null;
}

export default async function BookingsPage({ searchParams }: { searchParams: Promise<{ q?: string; scope?: string }> }) {
  const sp = await searchParams;
  const { sb } = await requireAdminPage();
  const settings = await loadSettingsFor(sb);
  const tz = settings.timezone;
  const today = todayInTz(nowMs(), tz);
  const q = (sp.q ?? "").trim().slice(0, 80);
  const scope = sp.scope === "historial" ? "historial" : "proximos";

  let query = sb.from("appointments").select(APPOINTMENT_COLUMNS).limit(100);
  const date = q ? parseDateQuery(q, today) : null;
  const digits = q.replace(/[\s()+-]/g, "");
  if (q) {
    if (date) {
      query = query.gte("start_at", new Date(zonedToUtcMs(date, 0, tz)).toISOString()).lt("start_at", new Date(zonedToUtcMs(addDays(date, 1), 0, tz)).toISOString());
    } else if (/^\d{3,}$/.test(digits)) {
      query = query.ilike("client_phone", `%${digits}%`);
    } else {
      query = query.ilike("client_name", `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
    }
  }
  if (!date) {
    const now = new Date().toISOString();
    query = scope === "proximos" ? query.gte("end_at", now).eq("status", "confirmed").order("start_at") : query.lt("start_at", now).order("start_at", { ascending: false });
  } else {
    query = query.order("start_at");
  }
  const { data } = await query;
  const list = ((data ?? []) as Appointment[]).map((a) => toAdminView(a, settings));

  return (
    <div className="space-y-5">
      <h1 className="font-display text-3xl font-semibold uppercase tracking-wide">Turnos</h1>
      <form className="flex gap-2" role="search">
        <input type="hidden" name="scope" value={scope} />
        <div className="relative flex-1">
          <IconSearch className="pointer-events-none absolute left-3.5 top-1/2 size-5 -translate-y-1/2 text-neutral-400" />
          <input name="q" defaultValue={q} aria-label="Buscar por nombre, teléfono o fecha" placeholder="Nombre, teléfono o fecha (12/11)" className="h-12 w-full rounded-xl border border-neutral-300 bg-white pl-11 pr-3 focus:border-neutral-950 focus:outline-none focus:ring-1 focus:ring-neutral-950" />
        </div>
        <button type="submit" className="h-12 rounded-xl bg-neutral-950 px-5 font-medium text-white">Buscar</button>
      </form>
      {!date && (
        <div className="grid grid-cols-2 rounded-xl bg-neutral-200/60 p-1 text-sm font-medium">
          {([["proximos", "Próximos"], ["historial", "Historial"]] as const).map(([k, l]) => (
            <Link key={k} href={`/admin/turnos?scope=${k}${q ? `&q=${encodeURIComponent(q)}` : ""}`} className={cx("rounded-lg px-4 py-2 text-center", scope === k ? "bg-white shadow-sm" : "text-neutral-600")}>{l}</Link>
          ))}
        </div>
      )}
      <p className="text-sm text-neutral-500">{q ? `Resultados para “${q}”` : scope === "proximos" ? "Turnos confirmados desde ahora" : "Turnos pasados, más recientes primero"} · {list.length}{list.length === 100 ? "+" : ""}</p>
      <AppointmentList appointments={list} today={today} showDate emptyText={q ? "No encontramos turnos con esa búsqueda." : "No hay turnos."} />
    </div>
  );
}
