"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  addBlockAction, addTimeOffAction, deleteBlockAction, deleteTimeOffAction, moveServiceAction, saveBusinessAction, savePoliciesAction, saveServiceAction, saveWorkingHoursAction,
  type ActionResult, type ConflictItem, type NoticeLink, type Resolutions,
} from "@/app/admin/actions";
import { formatDateLong, formatDateShort, formatDuration, formatPriceArs, hhmmToMinutes, minutesToHHMM, weekdayName } from "@/lib/time";
import type { BusinessSettings, Service, TimeBlockRow, TimeOffRow } from "@/lib/types";
import { IconArrowDown, IconArrowUp, IconPlus, IconWhatsApp, IconX } from "../icons";
import { Badge, Button, Field, Notice, Sheet, TextInput, TextArea, Select, cx } from "../ui";

/** Ejecuta una acción, maneja errores de conexión y refresca los datos del servidor. */
function useSave() {
  const router = useRouter();
  const [refreshing, start] = useTransition();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [notices, setNotices] = useState<NoticeLink[]>([]);
  const [conflicts, setConflicts] = useState<ConflictItem[] | null>(null);

  async function save(fn: () => Promise<ActionResult<unknown>>, onOk?: () => void) {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const r = await fn();
      if (!r.ok) {
        setError(r.error);
        setConflicts(r.conflicts ?? null);
        return;
      }
      setConflicts(null);
      setNotices(r.notices ?? []);
      setSaved(true);
      start(() => router.refresh());
      onOk?.();
    } catch {
      setError("No pudimos conectarnos. Revisá tu conexión e intentá de nuevo.");
    } finally {
      setBusy(false);
    }
  }
  return { save, busy: busy || refreshing, error, saved, notices, conflicts, setConflicts, setError, setSaved, setNotices };
}

function Notices({ notices }: { notices: NoticeLink[] }) {
  if (!notices.length) return null;
  return (
    <div className="space-y-2">
      <Notice tone="success">Cambios guardados. Estos clientes tenían turnos afectados que se cancelaron:</Notice>
      {notices.map((n) => (
        <a key={n.url} href={n.url} target="_blank" rel="noopener noreferrer" className="flex h-12 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-3 text-[15px] font-medium text-white hover:bg-emerald-700">
          <IconWhatsApp className="size-5" /> {n.label}
        </a>
      ))}
    </div>
  );
}

/** Lista de turnos afectados: hay que decidir explícitamente qué hacer con cada uno. */
function ConflictPanel({ conflicts, value, onChange }: { conflicts: ConflictItem[]; value: Resolutions; onChange: (v: Resolutions) => void }) {
  return (
    <div className="space-y-3 rounded-2xl border border-amber-300 bg-amber-50 p-4" role="alert" data-testid="conflicts">
      <p className="font-medium text-amber-950">Este cambio afecta {conflicts.length} {conflicts.length === 1 ? "turno confirmado" : "turnos confirmados"}.</p>
      <p className="text-sm text-amber-900">Ningún turno se elimina solo. Elegí qué hacer con cada uno y volvé a guardar.</p>
      <ul className="space-y-2">
        {conflicts.map((c) => (
          <li key={c.id} className="rounded-xl bg-white p-3">
            <p className="font-medium">{c.clientName} · {c.serviceName}</p>
            <p className="text-sm text-neutral-600">{formatDateLong(c.date)} · {c.time} hs · {c.phoneDisplay}</p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {(["keep", "cancel"] as const).map((opt) => (
                <button
                  key={opt}
                  type="button"
                  aria-pressed={value[c.id] === opt}
                  onClick={() => onChange({ ...value, [c.id]: opt })}
                  className={cx("h-10 rounded-lg border text-sm font-medium", value[c.id] === opt ? (opt === "cancel" ? "border-red-700 bg-red-700 text-white" : "border-neutral-950 bg-neutral-950 text-white") : "border-neutral-300 bg-white")}
                >
                  {opt === "keep" ? "Mantener turno" : "Cancelar turno"}
                </button>
              ))}
            </div>
          </li>
        ))}
      </ul>
      <p className="text-xs text-amber-900">Para reprogramar uno, elegí “Mantener”, guardá y reprogramalo desde la Agenda. Si cancelás, vas a poder avisarle por WhatsApp.</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Horarios semanales + políticas
// ---------------------------------------------------------------------------
type Range = { start: string; end: string };

export function ScheduleEditor({ initial }: { initial: { weekday: number; start_minute: number; end_minute: number }[] }) {
  const s = useSave();
  const [days, setDays] = useState<Record<number, Range[]>>(() => {
    const out: Record<number, Range[]> = {};
    for (let d = 1; d <= 7; d++) {
      out[d] = initial.filter((h) => h.weekday === d).sort((a, b) => a.start_minute - b.start_minute).map((h) => ({ start: minutesToHHMM(h.start_minute), end: minutesToHHMM(h.end_minute === 1440 ? 1439 : h.end_minute) }));
    }
    return out;
  });
  const [resolutions, setResolutions] = useState<Resolutions>({});

  const set = (d: number, ranges: Range[]) => { setDays({ ...days, [d]: ranges }); s.setSaved(false); };
  const submit = () => {
    const hours = Object.entries(days).flatMap(([d, rs]) => rs.map((r) => ({ weekday: Number(d), startMinute: hhmmToMinutes(r.start), endMinute: hhmmToMinutes(r.end) })));
    s.save(() => saveWorkingHoursAction({ hours, resolutions }));
  };

  return (
    <section className="space-y-3" aria-labelledby="h-sem">
      <h2 id="h-sem" className="font-display text-2xl font-semibold uppercase tracking-wide">Horarios de atención</h2>
      <p className="text-sm text-neutral-500">Agregá uno o más tramos por día. El hueco entre dos tramos es el descanso. Un día sin tramos está cerrado.</p>
      <ul className="space-y-2">
        {[1, 2, 3, 4, 5, 6, 7].map((d) => {
          const ranges = days[d];
          const open = ranges.length > 0;
          return (
            <li key={d} className="rounded-2xl border border-neutral-200 bg-white p-4" data-testid={`day-${d}`}>
              <div className="flex items-center justify-between">
                <p className="font-medium capitalize">{weekdayName(d)}</p>
                <button
                  type="button"
                  role="switch"
                  aria-checked={open}
                  aria-label={`${weekdayName(d)} ${open ? "abierto" : "cerrado"}`}
                  onClick={() => set(d, open ? [] : [{ start: "09:00", end: "13:00" }])}
                  className={cx("flex h-8 w-14 items-center rounded-full p-1 transition-colors", open ? "bg-neutral-950" : "bg-neutral-300")}
                >
                  <span className={cx("size-6 rounded-full bg-white transition-transform", open && "translate-x-6")} />
                </button>
              </div>
              {!open && <p className="mt-1 text-sm text-neutral-400">Cerrado</p>}
              {open && (
                <div className="mt-3 space-y-2">
                  {ranges.map((r, i) => (
                    <div key={i} className="flex items-end gap-2">
                      <label className="min-w-0 flex-1 text-xs text-neutral-500">
                        Desde
                        <input aria-label={`${weekdayName(d)} apertura tramo ${i + 1}`} type="time" step={300} value={r.start} onChange={(e) => set(d, ranges.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)))} className="time-input mt-0.5 block h-11 w-full min-w-0 rounded-xl border border-neutral-300 px-2.5 text-[15px] text-neutral-950" />
                      </label>
                      <label className="min-w-0 flex-1 text-xs text-neutral-500">
                        Hasta
                        <input aria-label={`${weekdayName(d)} cierre tramo ${i + 1}`} type="time" step={300} value={r.end} onChange={(e) => set(d, ranges.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)))} className="time-input mt-0.5 block h-11 w-full min-w-0 rounded-xl border border-neutral-300 px-2.5 text-[15px] text-neutral-950" />
                      </label>
                      <button type="button" aria-label="Quitar tramo" onClick={() => set(d, ranges.filter((_, j) => j !== i))} className="grid size-11 shrink-0 place-items-center rounded-xl text-neutral-500 hover:bg-neutral-100"><IconX className="size-5" /></button>
                    </div>
                  ))}
                  <button type="button" onClick={() => set(d, [...ranges, { start: "16:00", end: "20:00" }])} className="text-sm font-medium text-neutral-700 underline">+ Agregar tramo (descanso en el medio)</button>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {s.conflicts && <ConflictPanel conflicts={s.conflicts} value={resolutions} onChange={setResolutions} />}
      {s.error && !s.conflicts && <Notice tone="error">{s.error}</Notice>}
      {s.saved && !s.notices.length && <Notice tone="success">Horarios guardados. La página pública ya muestra los cambios.</Notice>}
      <Notices notices={s.notices} />
      <Button className="w-full" loading={s.busy} onClick={submit} disabled={!!s.conflicts && s.conflicts.some((c) => !resolutions[c.id])} data-testid="save-hours">
        {s.conflicts ? "Confirmar y guardar" : "Guardar horarios"}
      </Button>
    </section>
  );
}

export function PoliciesForm({ settings }: { settings: BusinessSettings }) {
  const s = useSave();
  const [v, setV] = useState({
    slot_interval_minutes: String(settings.slot_interval_minutes),
    min_notice_minutes: String(settings.min_notice_minutes),
    max_days_ahead: String(settings.max_days_ahead),
    cancel_notice_hours: String(settings.cancel_notice_hours),
    max_active_per_phone: String(settings.max_active_per_phone),
    booking_enabled: settings.booking_enabled,
  });
  const num = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement>) => { setV({ ...v, [k]: e.target.value }); s.setSaved(false); };

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        s.save(() => savePoliciesAction({
          slot_interval_minutes: Number(v.slot_interval_minutes), min_notice_minutes: Number(v.min_notice_minutes), max_days_ahead: Number(v.max_days_ahead),
          cancel_notice_hours: Number(v.cancel_notice_hours), max_active_per_phone: Number(v.max_active_per_phone), booking_enabled: v.booking_enabled,
        }));
      }}
    >
      <h2 className="font-display text-2xl font-semibold uppercase tracking-wide">Reglas de reserva</h2>
      <label className="flex items-center justify-between gap-3 rounded-2xl border border-neutral-200 bg-white p-4">
        <span>
          <span className="block font-medium">Reservas online habilitadas</span>
          <span className="block text-sm text-neutral-500">Si las pausás, la página pública no deja reservar.</span>
        </span>
        <input type="checkbox" className="size-6 accent-neutral-950" checked={v.booking_enabled} onChange={(e) => { setV({ ...v, booking_enabled: e.target.checked }); s.setSaved(false); }} />
      </label>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Intervalo entre turnos (min)" htmlFor="p-int" hint="Cada cuántos minutos se ofrece un horario."><TextInput id="p-int" type="number" inputMode="numeric" min={5} max={240} step={5} value={v.slot_interval_minutes} onChange={num("slot_interval_minutes")} /></Field>
        <Field label="Anticipación mínima para reservar (min)" htmlFor="p-min" hint="60 = no se reserva con menos de 1 h de aviso."><TextInput id="p-min" type="number" inputMode="numeric" min={0} value={v.min_notice_minutes} onChange={num("min_notice_minutes")} /></Field>
        <Field label="Días futuros habilitados" htmlFor="p-max" hint="Hasta cuántos días adelante se puede reservar."><TextInput id="p-max" type="number" inputMode="numeric" min={1} max={365} value={v.max_days_ahead} onChange={num("max_days_ahead")} /></Field>
        <Field label="Límite para cancelar o reprogramar (horas)" htmlFor="p-can" hint="Con menos aviso, el cliente debe contactar al local."><TextInput id="p-can" type="number" inputMode="numeric" min={0} value={v.cancel_notice_hours} onChange={num("cancel_notice_hours")} /></Field>
        <Field label="Turnos activos máximos por teléfono" htmlFor="p-act" hint="Protege contra reservas masivas."><TextInput id="p-act" type="number" inputMode="numeric" min={1} max={20} value={v.max_active_per_phone} onChange={num("max_active_per_phone")} /></Field>
      </div>
      {s.error && <Notice tone="error">{s.error}</Notice>}
      {s.saved && <Notice tone="success">Reglas guardadas.</Notice>}
      <Button type="submit" className="w-full" loading={s.busy}>Guardar reglas</Button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Días libres, feriados, vacaciones y bloqueos de horario
// ---------------------------------------------------------------------------
const KIND_LABEL = { day_off: "Día libre", holiday: "Feriado", vacation: "Vacaciones" } as const;

export function TimeOffManager({ timeOff, blocks, tz, today }: { timeOff: TimeOffRow[]; blocks: (TimeBlockRow & { date: string; start: string; end: string })[]; tz: string; today: string }) {
  void tz;
  const off = useSave();
  const blk = useSave();
  const [kind, setKind] = useState<"day_off" | "holiday" | "vacation">("day_off");
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [reason, setReason] = useState("");
  const [offRes, setOffRes] = useState<Resolutions>({});
  const [bDate, setBDate] = useState(today);
  const [bStart, setBStart] = useState("14:00");
  const [bEnd, setBEnd] = useState("15:00");
  const [bReason, setBReason] = useState("");
  const [blkRes, setBlkRes] = useState<Resolutions>({});

  return (
    <div className="space-y-10">
      <section className="space-y-4" aria-labelledby="h-off">
        <h2 id="h-off" className="font-display text-2xl font-semibold uppercase tracking-wide">Días libres, feriados y vacaciones</h2>
        <form
          className="space-y-3 rounded-2xl border border-neutral-200 bg-white p-4"
          onSubmit={(e) => { e.preventDefault(); off.save(() => addTimeOffAction({ kind, startDate: from, endDate: to < from ? from : to, reason, resolutions: offRes }), () => { setOffRes({}); setReason(""); }); }}
        >
          <Field label="Tipo" htmlFor="o-kind"><Select id="o-kind" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>{Object.entries(KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Desde" htmlFor="o-from"><TextInput id="o-from" type="date" min={today} value={from} onChange={(e) => { setFrom(e.target.value); if (to < e.target.value) setTo(e.target.value); }} required /></Field>
            <Field label="Hasta (inclusive)" htmlFor="o-to"><TextInput id="o-to" type="date" min={from} value={to} onChange={(e) => setTo(e.target.value)} required /></Field>
          </div>
          <Field label="Motivo (opcional)" htmlFor="o-reason"><TextInput id="o-reason" maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
          {off.conflicts && <ConflictPanel conflicts={off.conflicts} value={offRes} onChange={setOffRes} />}
          {off.error && !off.conflicts && <Notice tone="error">{off.error}</Notice>}
          <Notices notices={off.notices} />
          <Button type="submit" className="w-full" loading={off.busy} disabled={!!off.conflicts && off.conflicts.some((c) => !offRes[c.id])}>{off.conflicts ? "Confirmar y guardar" : "Agregar"}</Button>
        </form>

        <ul className="space-y-2">
          {timeOff.length === 0 && <p className="text-sm text-neutral-500">No hay días libres programados.</p>}
          {timeOff.map((t) => (
            <li key={t.id} className="flex items-center justify-between gap-3 rounded-2xl border border-neutral-200 bg-white px-4 py-3">
              <div className="min-w-0">
                <p className="font-medium">{KIND_LABEL[t.kind]}{t.reason ? ` · ${t.reason}` : ""}</p>
                <p className="text-sm text-neutral-500">{t.start_date === t.end_date ? formatDateLong(t.start_date, true) : `${formatDateShort(t.start_date)} → ${formatDateShort(t.end_date)}`}</p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => off.save(() => deleteTimeOffAction({ id: t.id }))}>Quitar</Button>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-4" aria-labelledby="h-blk">
        <h2 id="h-blk" className="font-display text-2xl font-semibold uppercase tracking-wide">Bloquear un horario</h2>
        <p className="text-sm text-neutral-500">Para un trámite, un descanso extra o cualquier hueco puntual dentro de un día de atención.</p>
        <form
          className="space-y-3 rounded-2xl border border-neutral-200 bg-white p-4"
          onSubmit={(e) => { e.preventDefault(); blk.save(() => addBlockAction({ date: bDate, start: bStart, end: bEnd, reason: bReason, resolutions: blkRes }), () => { setBlkRes({}); setBReason(""); }); }}
        >
          <Field label="Día" htmlFor="b-date"><TextInput id="b-date" type="date" min={today} value={bDate} onChange={(e) => setBDate(e.target.value)} required /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Desde" htmlFor="b-start"><TextInput id="b-start" type="time" step={300} value={bStart} onChange={(e) => setBStart(e.target.value)} required /></Field>
            <Field label="Hasta" htmlFor="b-end"><TextInput id="b-end" type="time" step={300} value={bEnd} onChange={(e) => setBEnd(e.target.value)} required /></Field>
          </div>
          <Field label="Motivo (opcional)" htmlFor="b-reason"><TextInput id="b-reason" maxLength={200} value={bReason} onChange={(e) => setBReason(e.target.value)} /></Field>
          {blk.conflicts && <ConflictPanel conflicts={blk.conflicts} value={blkRes} onChange={setBlkRes} />}
          {blk.error && !blk.conflicts && <Notice tone="error">{blk.error}</Notice>}
          {blk.saved && !blk.notices.length && <Notice tone="success">Horario bloqueado.</Notice>}
          <Notices notices={blk.notices} />
          <Button type="submit" className="w-full" loading={blk.busy} disabled={!!blk.conflicts && blk.conflicts.some((c) => !blkRes[c.id])}>{blk.conflicts ? "Confirmar y guardar" : "Bloquear"}</Button>
        </form>

        <ul className="space-y-2">
          {blocks.length === 0 && <p className="text-sm text-neutral-500">No hay bloqueos próximos.</p>}
          {blocks.map((b) => (
            <li key={b.id} className="flex items-center justify-between gap-3 rounded-2xl border border-neutral-200 bg-white px-4 py-3">
              <div className="min-w-0">
                <p className="font-medium">{formatDateLong(b.date)} · {b.start}–{b.end}</p>
                {b.reason && <p className="truncate text-sm text-neutral-500">{b.reason}</p>}
              </div>
              <Button variant="ghost" size="sm" onClick={() => blk.save(() => deleteBlockAction({ id: b.id }))}>Quitar</Button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Datos del negocio
// ---------------------------------------------------------------------------
export function BusinessForm({ settings }: { settings: BusinessSettings }) {
  const s = useSave();
  const [v, setV] = useState({
    name: settings.name, description: settings.description ?? "", address: settings.address ?? "", whatsapp: settings.whatsapp ?? "",
    instagramUrl: settings.instagram_url ?? "", logoUrl: settings.logo_url ?? "", coverUrl: settings.cover_url ?? "",
  });
  const bind = (k: keyof typeof v) => ({ value: v[k], onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => { setV({ ...v, [k]: e.target.value }); s.setSaved(false); } });

  return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); s.save(() => saveBusinessAction(v)); }}>
      <h2 className="font-display text-2xl font-semibold uppercase tracking-wide">Datos del negocio</h2>
      <Field label="Nombre" htmlFor="b-name"><TextInput id="b-name" maxLength={80} required {...bind("name")} /></Field>
      <Field label="Descripción" htmlFor="b-desc"><TextArea id="b-desc" maxLength={500} {...bind("description")} /></Field>
      <Field label="Dirección" htmlFor="b-addr" hint="Se muestra al pie de la página de reservas."><TextInput id="b-addr" maxLength={200} {...bind("address")} /></Field>
      <Field label="WhatsApp del local" htmlFor="b-wa" hint="Con código de área. Ej: 261 5123456"><TextInput id="b-wa" type="tel" inputMode="tel" {...bind("whatsapp")} /></Field>
      <Field label="Instagram (enlace)" htmlFor="b-ig"><TextInput id="b-ig" type="url" inputMode="url" {...bind("instagramUrl")} /></Field>
      <Field label="Logo (enlace a la imagen)" htmlFor="b-logo" hint="Imagen cuadrada, subida a un sitio público. Dejalo vacío para usar solo el texto."><TextInput id="b-logo" type="url" inputMode="url" {...bind("logoUrl")} /></Field>
      <Field label="Imagen de portada (opcional)" htmlFor="b-cover" hint="Se muestra como una franja angosta arriba de todo."><TextInput id="b-cover" type="url" inputMode="url" {...bind("coverUrl")} /></Field>
      {s.error && <Notice tone="error">{s.error}</Notice>}
      {s.saved && <Notice tone="success">Datos guardados.</Notice>}
      <Button type="submit" className="w-full" loading={s.busy}>Guardar datos</Button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Servicios
// ---------------------------------------------------------------------------
type Draft = { id?: string; name: string; description: string; price: string; duration: string; buffer: string; active: boolean };
const emptyDraft: Draft = { name: "", description: "", price: "", duration: "30", buffer: "0", active: true };

export function ServicesManager({ services }: { services: Service[] }) {
  const s = useSave();
  const [draft, setDraft] = useState<Draft | null>(null);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-2xl font-semibold uppercase tracking-wide">Servicios</h2>
        <Button onClick={() => { s.setError(null); setDraft(emptyDraft); }} data-testid="new-service"><IconPlus className="size-5" /> Nuevo</Button>
      </div>
      <p className="text-sm text-neutral-500">Los cambios se ven al instante en la página pública. Los turnos ya reservados conservan el nombre y el precio con que se reservaron.</p>

      {services.length === 0 && <Notice>Todavía no cargaste servicios. Sin servicios activos, la página pública no permite reservar.</Notice>}
      {s.error && !draft && <Notice tone="error">{s.error}</Notice>}

      <ul className="space-y-2">
        {services.map((sv, i) => (
          <li key={sv.id} className={cx("flex items-center gap-2 rounded-2xl border border-neutral-200 bg-white p-3", !sv.active && "opacity-60")} data-testid="service-row">
            <div className="flex flex-col">
              <button type="button" aria-label={`Subir ${sv.name}`} disabled={i === 0 || s.busy} onClick={() => s.save(() => moveServiceAction({ id: sv.id, direction: "up" }))} className="grid size-8 place-items-center rounded-lg text-neutral-600 hover:bg-neutral-100 disabled:text-neutral-300"><IconArrowUp className="size-4" /></button>
              <button type="button" aria-label={`Bajar ${sv.name}`} disabled={i === services.length - 1 || s.busy} onClick={() => s.save(() => moveServiceAction({ id: sv.id, direction: "down" }))} className="grid size-8 place-items-center rounded-lg text-neutral-600 hover:bg-neutral-100 disabled:text-neutral-300"><IconArrowDown className="size-4" /></button>
            </div>
            <button type="button" className="min-w-0 flex-1 text-left" onClick={() => { s.setError(null); setDraft({ id: sv.id, name: sv.name, description: sv.description ?? "", price: String(sv.price_ars), duration: String(sv.duration_minutes), buffer: String(sv.buffer_minutes), active: sv.active }); }}>
              <p className="truncate font-medium">{sv.name} {!sv.active && <Badge>Inactivo</Badge>}</p>
              <p className="text-sm text-neutral-500">{formatDuration(sv.duration_minutes)}{sv.buffer_minutes ? ` + ${sv.buffer_minutes} min de preparación` : ""} · {formatPriceArs(sv.price_ars)}</p>
            </button>
          </li>
        ))}
      </ul>

      <Sheet open={!!draft} onClose={() => setDraft(null)} title={draft?.id ? "Editar servicio" : "Nuevo servicio"}>
        {draft && (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              s.save(() => saveServiceAction({ id: draft.id, name: draft.name, description: draft.description, priceArs: Number(draft.price), durationMinutes: Number(draft.duration), bufferMinutes: Number(draft.buffer || 0), active: draft.active }), () => setDraft(null));
            }}
          >
            <Field label="Nombre" htmlFor="s-name"><TextInput id="s-name" maxLength={80} required value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></Field>
            <Field label="Descripción (opcional)" htmlFor="s-desc"><TextInput id="s-desc" maxLength={300} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Precio (ARS)" htmlFor="s-price"><TextInput id="s-price" type="number" inputMode="numeric" min={0} required value={draft.price} onChange={(e) => setDraft({ ...draft, price: e.target.value })} /></Field>
              <Field label="Duración (min)" htmlFor="s-dur"><TextInput id="s-dur" type="number" inputMode="numeric" min={5} max={480} step={5} required value={draft.duration} onChange={(e) => setDraft({ ...draft, duration: e.target.value })} /></Field>
            </div>
            <Field label="Preparación / limpieza (min)" htmlFor="s-buf" hint="Tiempo extra después del servicio en que no se agenda a nadie."><TextInput id="s-buf" type="number" inputMode="numeric" min={0} max={120} value={draft.buffer} onChange={(e) => setDraft({ ...draft, buffer: e.target.value })} /></Field>
            <label className="flex items-center justify-between rounded-xl border border-neutral-200 p-3">
              <span className="font-medium">Activo (visible para reservar)</span>
              <input type="checkbox" className="size-6 accent-neutral-950" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} />
            </label>
            {s.error && <Notice tone="error">{s.error}</Notice>}
            <Button type="submit" className="w-full" loading={s.busy}>Guardar servicio</Button>
          </form>
        )}
      </Sheet>
    </div>
  );
}
