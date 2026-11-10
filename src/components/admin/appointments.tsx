"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { adminSlotsAction, createAppointmentAction, regenerateLinkAction, rescheduleAction, setStatusAction, updateNotesAction, type ActionResult, type NoticeLink } from "@/app/admin/actions";
import type { AdminAppt } from "@/lib/server/admin-data";
import { formatDateLong, formatDuration, formatPriceArs } from "@/lib/time";
import { STATUS_LABEL, type AppointmentStatus, type Service } from "@/lib/types";
import { DayStrip, SlotsSkeleton, TimeGrid, type DaySlots } from "../pickers";
import { IconPhone, IconPlus, IconWhatsApp, IconCopy } from "../icons";
import { Badge, Button, Field, Notice, Select, Sheet, TextArea, TextInput, cx } from "../ui";

export const statusTone = (s: AppointmentStatus) => (s === "confirmed" ? "dark" : s === "completed" ? "green" : s === "cancelled" ? "red" : "amber") as "dark" | "green" | "red" | "amber";

// ---------------------------------------------------------------------------
// Lista de turnos + hoja de detalle
// ---------------------------------------------------------------------------
export function AppointmentList({ appointments, today, emptyText = "No hay turnos.", showDate = false, compact = false }: { appointments: AdminAppt[]; today: string; emptyText?: string; showDate?: boolean; compact?: boolean }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const open = appointments.find((a) => a.id === openId) ?? null;

  if (appointments.length === 0) return <p className="rounded-2xl border border-dashed border-neutral-300 px-4 py-6 text-center text-sm text-neutral-500">{emptyText}</p>;

  return (
    <>
      <ul className="space-y-2">
        {appointments.map((a) => (
          <li key={a.id}>
            <button
              type="button"
              onClick={() => setOpenId(a.id)}
              data-testid="appointment-row"
              className={cx("flex w-full items-center gap-3 rounded-2xl border border-neutral-200 bg-white text-left transition-colors hover:border-neutral-950", compact ? "px-3 py-2" : "px-4 py-3", a.status === "cancelled" && "opacity-60")}
            >
              <div className="w-14 shrink-0 font-display text-xl font-semibold leading-tight tabular-nums">
                {a.time}
                {!compact && <span className="block text-xs font-normal text-neutral-500">{a.endTime}</span>}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{a.client_name}</p>
                <p className="truncate text-sm text-neutral-500">
                  {showDate && `${formatDateLong(a.date)} · `}
                  {a.service_name}
                  {!compact && ` · ${a.phoneDisplay}`}
                </p>
              </div>
              {!compact && <Badge tone={statusTone(a.status)}>{STATUS_LABEL[a.status]}</Badge>}
            </button>
          </li>
        ))}
      </ul>
      <AppointmentSheet appt={open} onClose={() => setOpenId(null)} today={today} />
    </>
  );
}

function useActions() {
  const router = useRouter();
  const [refreshing, start] = useTransition();
  const [busy, setBusy] = useState(false);
  const pending = busy || refreshing;
  const [error, setError] = useState<string | null>(null);
  const [notices, setNotices] = useState<NoticeLink[]>([]);
  async function exec(fn: () => Promise<ActionResult<unknown>>, onOk?: () => void) {
    setError(null);
    setBusy(true);
    let res: ActionResult<unknown>;
    try {
      res = await fn();
    } catch {
      setBusy(false);
      return setError("No pudimos conectarnos. Revisá tu conexión e intentá de nuevo.");
    }
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setNotices(res.notices ?? []);
    start(() => router.refresh());
    onOk?.();
  }
  return { pending, error, setError, notices, setNotices, exec };
}

function NoticeLinks({ notices }: { notices: NoticeLink[] }) {
  if (!notices.length) return null;
  return (
    <div className="space-y-2">
      {notices.map((n) => (
        <a key={n.url} href={n.url} target="_blank" rel="noopener noreferrer" className="flex h-12 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-3 text-[15px] font-medium text-white hover:bg-emerald-700">
          <IconWhatsApp className="size-5" /> {n.label}
        </a>
      ))}
    </div>
  );
}

function AppointmentSheet({ appt, onClose, today }: { appt: AdminAppt | null; onClose: () => void; today: string }) {
  const a = useActions();
  const [mode, setMode] = useState<"view" | "reschedule" | "confirm-cancel">("view");
  const [notes, setNotes] = useState("");
  const [link, setLink] = useState<{ url: string; waUrl: string } | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setMode("view");
    setNotes(appt?.notes ?? "");
    setLink(null);
    a.setError(null);
    a.setNotices([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appt?.id]);

  return (
    <Sheet open={!!appt} onClose={onClose} title="Turno">
      {appt && (
        <div className="space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xl font-semibold">{appt.client_name}</p>
              <p className="text-neutral-500">{appt.phoneDisplay}</p>
            </div>
            <Badge tone={statusTone(appt.status)}>{STATUS_LABEL[appt.status]}</Badge>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <a href={appt.waUrl} target="_blank" rel="noopener noreferrer" className="flex h-12 items-center justify-center gap-2 rounded-xl bg-emerald-600 font-medium text-white hover:bg-emerald-700">
              <IconWhatsApp className="size-5" /> WhatsApp
            </a>
            <a href={`tel:${appt.client_phone}`} className="flex h-12 items-center justify-center gap-2 rounded-xl border border-neutral-300 font-medium hover:bg-neutral-50">
              <IconPhone className="size-5" /> Llamar
            </a>
          </div>

          <dl className="divide-y divide-neutral-100 rounded-2xl border border-neutral-200 text-[15px]">
            <Row k="Servicio" v={appt.service_name} />
            <Row k="Día" v={formatDateLong(appt.date, true)} />
            <Row k="Horario" v={`${appt.time} a ${appt.endTime} hs`} />
            <Row k="Duración" v={formatDuration(appt.duration_minutes)} />
            <Row k="Precio" v={formatPriceArs(appt.service_price_ars)} />
            <Row k="Origen" v={appt.source === "admin" ? "Cargado por el local" : "Reserva online"} />
            {appt.reschedule_count > 0 && <Row k="Reprogramado" v={`${appt.reschedule_count} ${appt.reschedule_count === 1 ? "vez" : "veces"}`} />}
            {appt.cancelled_by && <Row k="Cancelado por" v={appt.cancelled_by === "client" ? "El cliente" : "El local"} />}
          </dl>

          {a.error && <Notice tone="error">{a.error}</Notice>}
          <NoticeLinks notices={a.notices} />

          {mode === "view" && (
            <>
              <div className="grid grid-cols-2 gap-2">
                {appt.status === "confirmed" ? (
                  <>
                    <Button loading={a.pending} onClick={() => a.exec(() => setStatusAction({ id: appt.id, status: "completed" }))}>Completado</Button>
                    <Button variant="secondary" loading={a.pending} onClick={() => a.exec(() => setStatusAction({ id: appt.id, status: "no_show" }))}>No asistió</Button>
                    <Button variant="secondary" onClick={() => setMode("reschedule")}>Reprogramar</Button>
                    <Button variant="danger" onClick={() => setMode("confirm-cancel")}>Cancelar turno</Button>
                  </>
                ) : (
                  <Button className="col-span-2" variant="secondary" loading={a.pending} onClick={() => a.exec(() => setStatusAction({ id: appt.id, status: "confirmed" }))}>
                    Volver a “Confirmado”
                  </Button>
                )}
              </div>

              <Field label="Notas internas" htmlFor="notes">
                <TextArea id="notes" value={notes} maxLength={500} onChange={(e) => setNotes(e.target.value)} placeholder="Solo las ves vos" />
              </Field>
              {notes !== (appt.notes ?? "") && (
                <Button variant="secondary" size="sm" loading={a.pending} onClick={() => a.exec(() => updateNotesAction({ id: appt.id, notes }))}>
                  Guardar notas
                </Button>
              )}

              {appt.status === "confirmed" && (
                <div className="border-t border-neutral-100 pt-3">
                  {link ? (
                    <div className="space-y-2">
                      <p className="break-all rounded-xl bg-neutral-50 p-3 text-xs text-neutral-600">{link.url}</p>
                      <div className="grid grid-cols-2 gap-2">
                        <Button variant="secondary" size="sm" onClick={async () => { await navigator.clipboard?.writeText(link.url).catch(() => {}); setCopied(true); }}>
                          <IconCopy className="size-4" /> {copied ? "Copiado" : "Copiar"}
                        </Button>
                        <a href={link.waUrl} target="_blank" rel="noopener noreferrer" className="flex h-10 items-center justify-center gap-2 rounded-xl border border-neutral-300 text-sm font-medium hover:bg-neutral-50">
                          <IconWhatsApp className="size-4" /> Enviar
                        </a>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="text-sm text-neutral-500 underline"
                      onClick={() => a.exec(async () => {
                        const r = await regenerateLinkAction({ id: appt.id });
                        if (r.ok && r.data) setLink(r.data);
                        return r;
                      })}
                    >
                      Generar nuevo enlace privado para el cliente
                    </button>
                  )}
                  {!link && <p className="mt-1 text-xs text-neutral-400">El enlace anterior deja de funcionar.</p>}
                </div>
              )}
            </>
          )}

          {mode === "confirm-cancel" && (
            <div className="space-y-3 rounded-2xl border border-red-200 bg-red-50/40 p-4">
              <p className="font-medium">¿Cancelar el turno de {appt.client_name}?</p>
              <p className="text-sm text-neutral-600">El horario se libera y el turno queda en el historial. Después podés avisarle por WhatsApp.</p>
              <div className="grid grid-cols-2 gap-2">
                <Button variant="secondary" onClick={() => setMode("view")}>Volver</Button>
                <Button variant="danger" loading={a.pending} onClick={() => a.exec(() => setStatusAction({ id: appt.id, status: "cancelled" }), () => setMode("view"))}>Sí, cancelar</Button>
              </div>
            </div>
          )}

          {mode === "reschedule" && <ReschedulePanel appt={appt} today={today} onDone={() => setMode("view")} runner={a} />}
        </div>
      )}
    </Sheet>
  );
}

function ReschedulePanel({ appt, today, onDone, runner }: { appt: AdminAppt; today: string; onDone: () => void; runner: ReturnType<typeof useActions> }) {
  const [days, setDays] = useState<DaySlots[] | null>(null);
  const [date, setDate] = useState<string | null>(null);
  const [time, setTime] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    adminSlotsAction({ appointmentId: appt.id, from: today, days: 60 }).then((r) => (r.ok ? setDays(r.data ?? []) : setErr(r.error)));
  }, [appt.id, today]);

  return (
    <section className="space-y-4 rounded-2xl border border-neutral-200 p-4" aria-label="Reprogramar">
      <h3 className="font-display text-lg font-semibold uppercase tracking-[0.14em]">Nuevo horario</h3>
      {err ? <Notice tone="error">{err}</Notice> : !days ? <SlotsSkeleton /> : <DayStrip days={days} today={today} selected={date} onSelect={(d) => { setDate(d); setTime(null); }} />}
      {days && date && <TimeGrid slots={days.find((d) => d.date === date)?.slots ?? []} selected={time} onSelect={setTime} />}
      <div className="grid grid-cols-2 gap-2">
        <Button variant="secondary" onClick={onDone}>Volver</Button>
        <Button disabled={!date || !time} loading={runner.pending} onClick={() => date && time && runner.exec(() => rescheduleAction({ id: appt.id, date, time }), onDone)}>
          Reprogramar
        </Button>
      </div>
    </section>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 px-4 py-2.5">
      <dt className="text-neutral-500">{k}</dt>
      <dd className="text-right font-medium">{v}</dd>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Nuevo turno manual
// ---------------------------------------------------------------------------
export function NewAppointmentButton({ services, today, defaultDate }: { services: Service[]; today: string; defaultDate?: string }) {
  const [open, setOpen] = useState(false);
  const a = useActions();
  const [serviceId, setServiceId] = useState(services[0]?.id ?? "");
  const [days, setDays] = useState<DaySlots[] | null>(null);
  const [date, setDate] = useState<string | null>(defaultDate && defaultDate >= today ? defaultDate : null);
  const [time, setTime] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!open || !serviceId) return;
    setDays(null);
    adminSlotsAction({ serviceId, from: today, days: 60 }).then((r) => r.ok ? setDays(r.data ?? []) : a.setError(r.error));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, serviceId, today]);

  const reset = () => { setTime(null); setName(""); setPhone(""); setNotes(""); setDone(false); a.setError(null); a.setNotices([]); };
  const slots = days?.find((d) => d.date === date)?.slots ?? [];

  return (
    <>
      <Button onClick={() => { reset(); setOpen(true); }} disabled={services.length === 0} data-testid="new-appointment">
        <IconPlus className="size-5" /> Nuevo turno
      </Button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Nuevo turno">
        {done ? (
          <div className="space-y-3">
            <Notice tone="success">Turno creado.</Notice>
            <NoticeLinks notices={a.notices} />
            <Button className="w-full" variant="secondary" onClick={() => setOpen(false)}>Listo</Button>
          </div>
        ) : (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (!date || !time) return a.setError("Elegí día y horario.");
              a.exec(() => createAppointmentAction({ serviceId, date, time, name, phone, notes: notes || undefined }), () => setDone(true));
            }}
          >
            <Field label="Servicio" htmlFor="n-service">
              <Select id="n-service" value={serviceId} onChange={(e) => { setServiceId(e.target.value); setTime(null); }}>
                {services.map((s) => <option key={s.id} value={s.id}>{s.name} · {formatDuration(s.duration_minutes)} · {formatPriceArs(s.price_ars)}</option>)}
              </Select>
            </Field>
            {!days ? <SlotsSkeleton /> : <DayStrip days={days} today={today} selected={date} onSelect={(d) => { setDate(d); setTime(null); }} />}
            {days && date && <TimeGrid slots={slots} selected={time} onSelect={setTime} />}
            {time && (
              <>
                <Field label="Nombre" htmlFor="n-name"><TextInput id="n-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required /></Field>
                <Field label="WhatsApp" htmlFor="n-phone" hint="Con código de área. Ej: 261 5123456"><TextInput id="n-phone" type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} required /></Field>
                <Field label="Notas (opcional)" htmlFor="n-notes"><TextInput id="n-notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} /></Field>
              </>
            )}
            {a.error && <Notice tone="error">{a.error}</Notice>}
            <Button type="submit" className="w-full" loading={a.pending} disabled={!time}>Crear turno</Button>
          </form>
        )}
      </Sheet>
    </>
  );
}
