"use client";

import Link from "next/link";
import { useState } from "react";
import { formatDateLong, formatDuration, formatPriceArs } from "@/lib/time";
import { STATUS_LABEL, type BusinessSettings, type PublicAppointment } from "@/lib/types";
import { waLink } from "@/lib/whatsapp";
import { DayStrip, SlotsSkeleton, TimeGrid, useAvailability } from "../pickers";
import { IconWhatsApp } from "../icons";
import { Badge, Button, Notice } from "../ui";

type Props = {
  token: string;
  initial: PublicAppointment;
  canModify: boolean;
  cancelNoticeHours: number;
  business: Pick<BusinessSettings, "name" | "whatsapp" | "timezone" | "max_days_ahead">;
  today: string;
};

type Mode = "view" | "reschedule" | "confirm-cancel";

export function ManageAppointment({ token, initial, canModify, cancelNoticeHours, business, today }: Props) {
  const [appt, setAppt] = useState(initial);
  const [mode, setMode] = useState<Mode>("view");
  const [date, setDate] = useState<string | null>(null);
  const [time, setTime] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const url = mode === "reschedule" ? `/api/turno/${token}/availability?from=${today}&days=${business.max_days_ahead + 1}` : null;
  const { days, loading, error: availError, reload } = useAvailability(url);
  const slots = days?.find((d) => d.date === date)?.slots ?? [];
  const active = appt.status === "confirmed";
  const contact = business.whatsapp
    ? waLink(business.whatsapp, `Hola ${business.name}! Soy ${appt.clientName}. Necesito consultar por mi turno de ${appt.serviceName} del ${formatDateLong(appt.date)} a las ${appt.time} hs.`)
    : null;

  async function call(path: string, body?: unknown) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/turno/${token}/${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error?.message ?? "No pudimos completar la acción.");
        if (data?.error?.code === "slot_taken" || data?.error?.code === "slot_unavailable") {
          setTime(null);
          reload();
        }
        return null;
      }
      return data.appointment as PublicAppointment;
    } catch {
      setError("No pudimos conectarnos. Revisá tu conexión e intentá de nuevo.");
      return null;
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="font-display text-3xl font-semibold uppercase tracking-wide">Tu turno</h2>
        <div className="mt-1">
          <Badge tone={appt.status === "confirmed" ? "dark" : appt.status === "completed" ? "green" : "red"}>{STATUS_LABEL[appt.status]}</Badge>
        </div>
      </div>

      {flash && <Notice tone="success">{flash}</Notice>}

      <dl className="divide-y divide-neutral-100 rounded-2xl border border-neutral-200 text-[15px]" data-testid="appointment-details">
        <Row k="Nombre" v={appt.clientName} />
        <Row k="Servicio" v={appt.serviceName} />
        <Row k="Día" v={formatDateLong(appt.date, true)} />
        <Row k="Hora" v={`${appt.time} a ${appt.endTime} hs`} />
        <Row k="Duración" v={formatDuration(appt.durationMinutes)} />
        <Row k="Precio" v={formatPriceArs(appt.priceArs)} />
      </dl>

      {active && !canModify && (
        <Notice tone="warn">
          Tu turno es muy próximo: solo se puede cancelar o reprogramar con al menos {cancelNoticeHours} h de anticipación. Por favor contactá al local.
        </Notice>
      )}

      {error && <Notice tone="error">{error}</Notice>}

      {active && mode === "view" && (
        <div className="space-y-2">
          {canModify && (
            <>
              <Button className="w-full" onClick={() => { setMode("reschedule"); setFlash(null); }}>
                Reprogramar
              </Button>
              <Button variant="danger" className="w-full" onClick={() => { setMode("confirm-cancel"); setFlash(null); }}>
                Cancelar turno
              </Button>
            </>
          )}
          {contact && (
            <a href={contact} target="_blank" rel="noopener noreferrer" className="flex h-12 items-center justify-center gap-2 rounded-xl border border-neutral-300 text-[15px] font-medium hover:bg-neutral-50">
              <IconWhatsApp className="size-5" /> Contactar al local
            </a>
          )}
        </div>
      )}

      {mode === "confirm-cancel" && (
        <div className="space-y-3 rounded-2xl border border-red-200 bg-red-50/40 p-4">
          <p className="font-medium">¿Seguro que querés cancelar este turno?</p>
          <p className="text-sm text-neutral-600">El horario quedará libre para otras personas.</p>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" onClick={() => setMode("view")} disabled={busy}>
              Volver
            </Button>
            <Button
              variant="danger"
              loading={busy}
              onClick={async () => {
                const next = await call("cancel");
                if (next) {
                  setAppt(next);
                  setMode("view");
                  setFlash("Tu turno fue cancelado.");
                }
              }}
            >
              Sí, cancelar
            </Button>
          </div>
        </div>
      )}

      {mode === "reschedule" && (
        <section className="rise space-y-5 rounded-2xl border border-neutral-200 p-4" aria-label="Reprogramar">
          <h3 className="font-display text-xl font-semibold uppercase tracking-[0.14em]">Elegí un nuevo horario</h3>
          {availError ? (
            <Notice tone="error">{availError}</Notice>
          ) : !days || loading ? (
            <SlotsSkeleton />
          ) : (
            <DayStrip days={days} today={today} selected={date} onSelect={(d) => { setDate(d); setTime(null); }} />
          )}
          {date && days && <TimeGrid slots={slots} selected={time} onSelect={setTime} />}
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" onClick={() => { setMode("view"); setDate(null); setTime(null); setError(null); }} disabled={busy}>
              Volver
            </Button>
            <Button
              disabled={!date || !time}
              loading={busy}
              onClick={async () => {
                if (!date || !time) return;
                const next = await call("reschedule", { date, time });
                if (next) {
                  setAppt(next);
                  setMode("view");
                  setDate(null);
                  setTime(null);
                  setFlash("¡Listo! Tu turno fue reprogramado.");
                }
              }}
            >
              Confirmar cambio
            </Button>
          </div>
        </section>
      )}

      <p className="pt-2 text-center">
        <Link href="/" className="text-sm text-neutral-500 underline">
          Reservar otro turno
        </Link>
      </p>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 px-4 py-3">
      <dt className="text-neutral-500">{k}</dt>
      <dd className="text-right font-medium">{v}</dd>
    </div>
  );
}
