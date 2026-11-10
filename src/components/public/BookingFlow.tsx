"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { formatDateLong, formatDuration, formatPriceArs } from "@/lib/time";
import type { BusinessSettings, PublicAppointment, Service } from "@/lib/types";
import { waLink, messages } from "@/lib/whatsapp";
import { DayStrip, SlotsSkeleton, TimeGrid, useAvailability } from "../pickers";
import { IconCheck, IconCopy, IconWhatsApp } from "../icons";
import { Button, Field, Notice, TextInput, cx } from "../ui";

type Props = {
  business: Pick<BusinessSettings, "name" | "whatsapp" | "timezone" | "max_days_ahead">;
  services: Service[];
  today: string;
};

type Result = { appointment: PublicAppointment; manageUrl: string };

export function BookingFlow({ business, services, today }: Props) {
  const [serviceId, setServiceId] = useState<string | null>(services.length === 1 ? services[0].id : null);
  const [date, setDate] = useState<string | null>(null);
  const [time, setTime] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [website, setWebsite] = useState(""); // honeypot
  const [errors, setErrors] = useState<{ name?: string; phone?: string; form?: string }>({});
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [copied, setCopied] = useState(false);
  const [lostSlot, setLostSlot] = useState<string | null>(null);

  const service = services.find((s) => s.id === serviceId) ?? null;
  const url = serviceId ? `/api/availability?serviceId=${serviceId}&from=${today}&days=${business.max_days_ahead + 1}` : null;
  const { days, loading, error: availError, reload } = useAvailability(url);

  const daySlots = useMemo(() => days?.find((d) => d.date === date)?.slots ?? [], [days, date]);
  const anyAvailable = !!days?.some((d) => d.slots.length);

  // Si la disponibilidad cambia y el horario elegido ya no existe, lo des-seleccionamos.
  useEffect(() => {
    if (days && date && time && !daySlots.includes(time)) {
      setTime(null);
      setLostSlot("Ese horario se acaba de ocupar. Elegí otro, por favor.");
    }
    if (days && date && daySlots.length === 0) setDate(null);
  }, [days, date, time, daySlots]);

  const timeRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLDivElement>(null);
  const reveal = (el: HTMLElement | null) => setTimeout(() => el?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 60);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!service || !date || !time || submitting) return;
    const next: typeof errors = {};
    if (!name.trim()) next.name = "Escribí tu nombre.";
    const { normalizePhone } = await import("@/lib/phone");
    if (!normalizePhone(phone)) next.phone = "Ingresá un WhatsApp válido, con código de área. Ej: 261 5123456";
    if (next.name || next.phone) return setErrors(next);

    setErrors({});
    setSubmitting(true);
    try {
      const res = await fetch("/api/bookings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ serviceId: service.id, date, time, name, phone, website }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        const code = body?.error?.code as string | undefined;
        setErrors({ form: body?.error?.message ?? "No pudimos confirmar el turno. Probá de nuevo." });
        if (code === "slot_taken" || code === "slot_unavailable" || code === "too_soon" || code === "slot_blocked") {
          setTime(null);
          setLostSlot(body?.error?.message ?? null);
          reload();
        }
        return;
      }
      setResult({ appointment: body.appointment, manageUrl: body.manageUrl });
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch {
      setErrors({ form: "No pudimos conectarnos. Revisá tu conexión y volvé a intentar: tu turno todavía NO está confirmado." });
    } finally {
      setSubmitting(false);
    }
  }

  if (result) return <Confirmation result={result} business={business} copied={copied} onCopy={async () => { await navigator.clipboard?.writeText(result.manageUrl).catch(() => {}); setCopied(true); }} />;

  return (
    <form onSubmit={submit} noValidate className="space-y-9 px-5 pb-4">
      <section aria-labelledby="h-servicio">
        <StepTitle id="h-servicio" n={1}>
          Servicio
        </StepTitle>
        <div className="space-y-2" role="group" aria-labelledby="h-servicio">
          {services.map((s) => {
            const sel = s.id === serviceId;
            return (
              <button
                key={s.id}
                type="button"
                aria-pressed={sel}
                onClick={() => {
                  setServiceId(s.id);
                  setTime(null);
                  setErrors({});
                  if (!sel) reveal(timeRef.current);
                }}
                className={cx("flex min-h-16 w-full items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-left transition-colors", sel ? "border-neutral-950 bg-neutral-950 text-white" : "border-neutral-300 bg-white hover:border-neutral-950")}
              >
                <span className="min-w-0">
                  <span className="block font-medium">{s.name}</span>
                  <span className={cx("block text-sm", sel ? "text-white/70" : "text-neutral-500")}>
                    {s.description ? `${s.description} · ` : ""}
                    {formatDuration(s.duration_minutes)}
                  </span>
                </span>
                <span className="shrink-0 font-display text-xl font-semibold tabular-nums">{formatPriceArs(s.price_ars)}</span>
              </button>
            );
          })}
        </div>
      </section>

      {service && (
        <section aria-labelledby="h-dia" className="rise" ref={timeRef}>
          <StepTitle id="h-dia" n={2}>
            Día
          </StepTitle>
          {availError ? (
            <Notice tone="error">
              <p>{availError}</p>
              <button type="button" onClick={reload} className="mt-2 font-medium underline">
                Reintentar
              </button>
            </Notice>
          ) : !days || loading ? (
            <SlotsSkeleton />
          ) : !anyAvailable ? (
            <Notice>
              No hay horarios disponibles por ahora.{" "}
              {business.whatsapp && (
                <a className="font-medium underline" href={waLink(business.whatsapp, messages.clientToBusiness(business.name))} target="_blank" rel="noopener noreferrer">
                  Escribinos por WhatsApp
                </a>
              )}
            </Notice>
          ) : (
            <DayStrip
              days={days}
              today={today}
              selected={date}
              onSelect={(d) => {
                setDate(d);
                setTime(null);
                setLostSlot(null);
                reveal(formRef.current);
              }}
            />
          )}
        </section>
      )}

      {service && date && days && (
        <section aria-labelledby="h-hora" className="rise">
          <StepTitle id="h-hora" n={3}>
            Horario <span className="ml-1 font-sans text-sm font-normal normal-case tracking-normal text-neutral-500">· {formatDateLong(date)}</span>
          </StepTitle>
          {lostSlot && <div className="mb-3"><Notice tone="warn">{lostSlot}</Notice></div>}
          <TimeGrid
            slots={daySlots}
            selected={time}
            onSelect={(t) => {
              setLostSlot(null);
              setTime(t);
              reveal(formRef.current);
            }}
          />
        </section>
      )}

      {service && date && time && (
        <section aria-labelledby="h-datos" className="rise space-y-4" ref={formRef}>
          <StepTitle id="h-datos" n={4}>
            Tus datos
          </StepTitle>
          <Field label="Nombre" htmlFor="name" error={errors.name}>
            <TextInput id="name" name="name" autoComplete="name" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder="Tu nombre" aria-invalid={!!errors.name} />
          </Field>
          <Field label="WhatsApp" htmlFor="phone" error={errors.phone} hint="Con código de área, sin 0 ni 15. Ej: 261 5123456">
            <TextInput id="phone" name="phone" type="tel" inputMode="tel" autoComplete="tel" maxLength={30} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="261 5123456" aria-invalid={!!errors.phone} />
          </Field>
          {/* Honeypot: invisible para personas */}
          <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
            <label>
              Sitio web
              <input tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
            </label>
          </div>

          <div className="rounded-2xl bg-neutral-50 px-4 py-3 text-sm text-neutral-700">
            <p className="font-medium text-neutral-950">{service.name}</p>
            <p>
              {formatDateLong(date)} · {time} hs · {formatDuration(service.duration_minutes)} · {formatPriceArs(service.price_ars)}
            </p>
          </div>

          {errors.form && <Notice tone="error">{errors.form}</Notice>}
          <Button type="submit" size="lg" className="w-full uppercase" loading={submitting}>
            {submitting ? "Confirmando…" : "Confirmar turno"}
          </Button>
          <p className="text-center text-xs text-neutral-500">
            Al confirmar aceptás la{" "}
            <Link href="/privacidad" className="underline">
              política de privacidad
            </Link>
            . Usamos tus datos solo para gestionar tu turno.
          </p>
        </section>
      )}
    </form>
  );
}

function StepTitle({ id, n, children }: { id: string; n: number; children: React.ReactNode }) {
  return (
    <h2 id={id} className="mb-3 flex items-baseline gap-2 font-display text-xl font-semibold uppercase tracking-[0.14em]">
      <span className="text-neutral-400">{n}</span>
      <span>{children}</span>
    </h2>
  );
}

function Confirmation({ result, business, copied, onCopy }: { result: Result; business: Props["business"]; copied: boolean; onCopy: () => void }) {
  const a = result.appointment;
  const share = `https://wa.me/?text=${encodeURIComponent(
    messages.shareReceipt({ client_name: a.clientName, service_name: a.serviceName, start_at: a.startAt }, business.timezone, business.name, result.manageUrl),
  )}`;
  return (
    <div className="rise px-5 pb-4" role="status" aria-live="polite" data-testid="confirmation">
      <div className="rounded-3xl border border-neutral-200 p-6 text-center">
        <div className="mx-auto mb-4 grid size-14 place-items-center rounded-full bg-neutral-950 text-white">
          <IconCheck className="size-7" />
        </div>
        <h2 className="font-display text-3xl font-semibold uppercase tracking-wide">¡Turno confirmado!</h2>
        <p className="mt-1 text-neutral-500">Te esperamos, {a.clientName}.</p>

        <dl className="mt-6 divide-y divide-neutral-100 rounded-2xl bg-neutral-50 text-left text-[15px]">
          <Row k="Servicio" v={a.serviceName} />
          <Row k="Día" v={formatDateLong(a.date)} />
          <Row k="Hora" v={`${a.time} a ${a.endTime} hs`} />
          <Row k="Nombre" v={a.clientName} />
          <Row k="Precio" v={formatPriceArs(a.priceArs)} />
        </dl>
      </div>

      <div className="mt-4 space-y-2">
        <Link href={result.manageUrl.replace(/^https?:\/\/[^/]+/, "")} className="flex h-12 w-full items-center justify-center rounded-xl bg-neutral-950 px-4 text-[15px] font-medium text-white hover:bg-neutral-800">
          Ver, cancelar o reprogramar mi turno
        </Link>
        <div className="grid grid-cols-2 gap-2">
          <a href={share} target="_blank" rel="noopener noreferrer" className="flex h-12 items-center justify-center gap-2 rounded-xl border border-neutral-300 text-[15px] font-medium hover:bg-neutral-50">
            <IconWhatsApp className="size-5" /> Compartir
          </a>
          <Button variant="secondary" onClick={onCopy}>
            <IconCopy className="size-5" /> {copied ? "¡Copiado!" : "Copiar enlace"}
          </Button>
        </div>
        <p className="px-2 pt-1 text-center text-xs text-neutral-500">Guardá el enlace: es tu acceso privado para gestionar el turno.</p>
      </div>
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
