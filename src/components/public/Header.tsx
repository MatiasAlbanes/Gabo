import type { BusinessSettings } from "@/lib/types";
import { waLink, messages } from "@/lib/whatsapp";
import { IconInstagram, IconWhatsApp } from "../icons";

export function Header({ business }: { business: Pick<BusinessSettings, "name" | "logo_url" | "whatsapp" | "instagram_url" | "cover_url"> }) {
  const [first, ...rest] = business.name.trim().split(/\s+/);
  // "DON GABO BARBER STUDIO" -> "DON GABO" / "BARBER STUDIO"
  const words = business.name.trim().split(/\s+/);
  const splitAt = words.length >= 4 ? Math.ceil(words.length / 2) : 1;
  const line1 = words.slice(0, splitAt).join(" ") || first;
  const line2 = words.slice(splitAt).join(" ") || rest.join(" ");

  return (
    <header>
      {business.cover_url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={business.cover_url} alt="" className="h-24 w-full object-cover" loading="eager" />
      )}
      <div className="flex items-center justify-between gap-3 px-5 pb-2 pt-6">
        <div className="flex min-w-0 items-center gap-3">
          {business.logo_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={business.logo_url} alt="" className="size-12 shrink-0 rounded-full object-cover" width={48} height={48} />
          )}
          <h1 className="font-display uppercase leading-[0.95]">
            <span className="block text-[2rem] font-bold tracking-[0.08em]">{line1}</span>
            {line2 && <span className="block text-base font-medium tracking-[0.42em] text-neutral-500">{line2}</span>}
          </h1>
        </div>
        <nav className="flex shrink-0 gap-1" aria-label="Contacto">
          {business.whatsapp && (
            <a href={waLink(business.whatsapp, messages.clientToBusiness(business.name))} target="_blank" rel="noopener noreferrer" aria-label="Escribir por WhatsApp" className="grid size-11 place-items-center rounded-full text-neutral-800 hover:bg-neutral-100">
              <IconWhatsApp />
            </a>
          )}
          {business.instagram_url && (
            <a href={business.instagram_url} target="_blank" rel="noopener noreferrer" aria-label="Instagram" className="grid size-11 place-items-center rounded-full text-neutral-800 hover:bg-neutral-100">
              <IconInstagram />
            </a>
          )}
        </nav>
      </div>
    </header>
  );
}

export function Footer({ business }: { business: Pick<BusinessSettings, "name" | "address" | "whatsapp" | "instagram_url"> }) {
  return (
    <footer className="mt-12 border-t border-neutral-200 px-5 py-6 text-center text-sm text-neutral-500">
      {business.address && <p className="mb-1 text-neutral-700">{business.address}</p>}
      <p>
        {business.name} · Mendoza, Argentina
      </p>
      <p className="mt-2 space-x-3">
        <a href="/privacidad" className="underline underline-offset-2 hover:text-neutral-900">
          Privacidad
        </a>
        {business.instagram_url && (
          <a href={business.instagram_url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-neutral-900">
            Instagram
          </a>
        )}
      </p>
    </footer>
  );
}
