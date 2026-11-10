"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { logoutAction } from "@/app/admin/actions";
import { IconLogout } from "../icons";
import { cx } from "../ui";

const ITEMS = [
  { href: "/admin", label: "Hoy", match: (p: string) => p === "/admin" },
  { href: "/admin/agenda", label: "Agenda", match: (p: string) => p.startsWith("/admin/agenda") },
  { href: "/admin/turnos", label: "Turnos", match: (p: string) => p.startsWith("/admin/turnos") },
  { href: "/admin/servicios", label: "Servicios", match: (p: string) => p.startsWith("/admin/servicios") },
  { href: "/admin/horarios", label: "Ajustes", match: (p: string) => /^\/admin\/(horarios|bloqueos|negocio)/.test(p) },
];

export function AdminNav({ businessName }: { businessName: string }) {
  const path = usePathname();
  return (
    <>
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-neutral-200 bg-white/95 px-4 backdrop-blur">
        <p className="font-display text-lg font-bold uppercase tracking-[0.1em]">{businessName}</p>
        <form action={logoutAction}>
          <button type="submit" aria-label="Cerrar sesión" className="flex h-10 items-center gap-2 rounded-xl px-3 text-sm text-neutral-600 hover:bg-neutral-100">
            <IconLogout className="size-5" /> <span className="hidden sm:inline">Salir</span>
          </button>
        </form>
      </header>

      {/* Móvil: barra inferior. Escritorio: barra lateral. */}
      <nav aria-label="Principal" className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-neutral-200 bg-white pb-[env(safe-area-inset-bottom)] md:inset-y-0 md:right-auto md:top-14 md:w-56 md:grid-cols-1 md:content-start md:gap-1 md:border-r md:border-t-0 md:p-3">
        {ITEMS.map((i) => {
          const active = i.match(path);
          return (
            <Link
              key={i.href}
              href={i.href}
              aria-current={active ? "page" : undefined}
              className={cx("flex h-14 items-center justify-center text-[13px] font-medium md:h-11 md:justify-start md:rounded-xl md:px-4 md:text-[15px]", active ? "text-neutral-950 md:bg-neutral-950 md:text-white" : "text-neutral-500 hover:text-neutral-950 md:hover:bg-neutral-100")}
            >
              <span className={cx("relative py-1", active && "max-md:after:absolute max-md:after:inset-x-0 max-md:after:-bottom-0.5 max-md:after:h-0.5 max-md:after:rounded max-md:after:bg-neutral-950")}>{i.label}</span>
            </Link>
          );
        })}
      </nav>
    </>
  );
}

export function SettingsTabs() {
  const path = usePathname();
  const tabs = [
    { href: "/admin/horarios", label: "Horarios" },
    { href: "/admin/bloqueos", label: "Días libres y bloqueos" },
    { href: "/admin/negocio", label: "Negocio" },
  ];
  return (
    <div className="-mx-4 mb-6 flex gap-2 overflow-x-auto px-4 pb-1" role="tablist" aria-label="Ajustes">
      {tabs.map((t) => (
        <Link key={t.href} href={t.href} role="tab" aria-selected={path === t.href} className={cx("shrink-0 rounded-full border px-4 py-2 text-sm font-medium", path === t.href ? "border-neutral-950 bg-neutral-950 text-white" : "border-neutral-300 text-neutral-700 hover:border-neutral-950")}>
          {t.label}
        </Link>
      ))}
    </div>
  );
}
