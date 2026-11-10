"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { addDays, formatDateLong, isoWeekday, monthName, parseDate, startOfWeek, weekdayName } from "@/lib/time";
import { IconChevronLeft, IconChevronRight } from "./icons";
import { cx } from "./ui";

export type DaySlots = { date: string; slots: string[] };

/** Carga disponibilidad desde un endpoint y la refresca al volver a la pestaña. */
export function useAvailability(url: string | null) {
  const [days, setDays] = useState<DaySlots[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const load = useCallback(
    async (silent = false) => {
      if (!url) return;
      const id = ++seq.current;
      if (!silent) setLoading(true);
      setError(null);
      try {
        const res = await fetch(url, { cache: "no-store" });
        const body = await res.json().catch(() => null);
        if (id !== seq.current) return;
        if (!res.ok) throw new Error(body?.error?.message ?? "No pudimos cargar los horarios.");
        setDays(body.days as DaySlots[]);
      } catch (e) {
        if (id !== seq.current || silent) return; // un refresco silencioso fallido no debe romper la pantalla
        const offline = e instanceof TypeError;
        setError(offline ? "No pudimos conectarnos. Revisá tu conexión e intentá de nuevo." : (e as Error).message);
      } finally {
        if (id === seq.current && !silent) setLoading(false);
      }
    },
    [url],
  );

  useEffect(() => {
    setDays(null);
    if (!url) return;
    load();
    const onVisible = () => document.visibilityState === "visible" && load(true);
    document.addEventListener("visibilitychange", onVisible);
    const counter = seq;
    return () => {
      counter.current++;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [url, load]);

  return { days, loading, error, reload: () => load() };
}

type DayStripProps = {
  days: DaySlots[];
  selected: string | null;
  onSelect: (date: string) => void;
  today: string;
};

/** Selector semanal compacto: 7 columnas que siempre entran en pantalla, con flechas para otras semanas. */
export function DayStrip({ days, selected, onSelect, today }: DayStripProps) {
  const byDate = useMemo(() => new Map(days.map((d) => [d.date, d.slots])), [days]);
  const firstWeek = startOfWeek(days[0]?.date ?? today);
  const lastDate = days[days.length - 1]?.date ?? today;
  const weekCount = Math.max(1, Math.round((Date.parse(startOfWeek(lastDate)) - Date.parse(firstWeek)) / (7 * 86_400_000)) + 1);

  const firstAvailable = days.find((d) => d.slots.length > 0)?.date;
  const initialWeek = firstAvailable ? Math.round((Date.parse(startOfWeek(firstAvailable)) - Date.parse(firstWeek)) / (7 * 86_400_000)) : 0;
  const [week, setWeek] = useState(initialWeek);
  const touched = useRef(false);

  // Si cambian los datos (otro servicio) y el usuario no navegó, saltamos a la primera semana con lugar.
  useEffect(() => {
    if (!touched.current) setWeek(initialWeek);
  }, [initialWeek]);

  const weekStart = addDays(firstWeek, week * 7);
  const weekDates = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const first = parseDate(weekDates[0]);
  const last = parseDate(weekDates[6]);
  const title = first.m === last.m ? `${monthName(first.m)} ${first.y}` : `${monthName(first.m, true)} – ${monthName(last.m, true)} ${last.y}`;
  const go = (delta: number) => {
    touched.current = true;
    setWeek((w) => Math.min(weekCount - 1, Math.max(0, w + delta)));
  };

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <p className="text-sm font-medium capitalize text-neutral-800" aria-live="polite">
          {title}
        </p>
        <div className="flex gap-1">
          <button type="button" onClick={() => go(-1)} disabled={week === 0} aria-label="Semana anterior" className="grid size-11 place-items-center rounded-xl border border-neutral-200 text-neutral-800 enabled:hover:bg-neutral-50 disabled:text-neutral-300">
            <IconChevronLeft />
          </button>
          <button type="button" onClick={() => go(1)} disabled={week >= weekCount - 1} aria-label="Semana siguiente" className="grid size-11 place-items-center rounded-xl border border-neutral-200 text-neutral-800 enabled:hover:bg-neutral-50 disabled:text-neutral-300">
            <IconChevronRight />
          </button>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-1.5" role="group" aria-label="Días">
        {weekDates.map((date) => {
          const slots = byDate.get(date);
          const available = !!slots && slots.length > 0;
          const isSel = date === selected;
          return (
            <button
              key={date}
              type="button"
              disabled={!available}
              aria-pressed={isSel}
              aria-label={`${formatDateLong(date)}, ${available ? `${slots!.length} horarios libres` : "sin horarios"}`}
              onClick={() => onSelect(date)}
              className={cx(
                "flex h-[4.25rem] min-w-0 flex-col items-center justify-center rounded-xl border text-center transition-colors",
                isSel ? "border-neutral-950 bg-neutral-950 text-white" : available ? "border-neutral-300 bg-white text-neutral-950 hover:border-neutral-950" : "border-transparent bg-neutral-50 text-neutral-300",
              )}
            >
              <span className="text-[11px] uppercase tracking-wide opacity-80">{weekdayName(isoWeekday(date), true)}</span>
              <span className="font-display text-2xl font-semibold leading-none">{parseDate(date).d}</span>
              {date === today && <span className={cx("mt-0.5 text-[9px] uppercase tracking-wider", isSel ? "text-white/70" : "text-neutral-500")}>hoy</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function TimeGrid({ slots, selected, onSelect }: { slots: string[]; selected: string | null; onSelect: (t: string) => void }) {
  const groups = [
    { label: "Mañana", items: slots.filter((s) => s < "13:00") },
    { label: "Tarde", items: slots.filter((s) => s >= "13:00") },
  ].filter((g) => g.items.length);

  return (
    <div className="space-y-4">
      {groups.map((g) => (
        <div key={g.label}>
          {groups.length > 1 && <p className="mb-2 text-xs font-medium uppercase tracking-wider text-neutral-500">{g.label}</p>}
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4" role="group" aria-label={`Horarios por la ${g.label.toLowerCase()}`}>
            {g.items.map((t) => (
              <button
                key={t}
                type="button"
                aria-pressed={t === selected}
                onClick={() => onSelect(t)}
                className={cx(
                  "h-12 rounded-xl border text-[15px] font-medium tabular-nums transition-colors",
                  t === selected ? "border-neutral-950 bg-neutral-950 text-white" : "border-neutral-300 bg-white hover:border-neutral-950",
                )}
              >
                {t}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function SlotsSkeleton() {
  return (
    <div className="grid animate-pulse grid-cols-7 gap-1.5" aria-busy="true" aria-label="Cargando horarios">
      {Array.from({ length: 7 }, (_, i) => (
        <div key={i} className="h-[4.25rem] rounded-xl bg-neutral-100" />
      ))}
    </div>
  );
}
