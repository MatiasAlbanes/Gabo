import { parsePhoneNumberFromString } from "libphonenumber-js/min";

/**
 * Normaliza un teléfono de WhatsApp a formato E.164. Argentina es el país por defecto.
 * Los números argentinos se guardan como móviles (+549...), que es lo que exige WhatsApp,
 * aunque la persona haya escrito "261 5123456", "0261 15 5123456" o "+54 9 261 512 3456".
 */
export function normalizePhone(input: string, defaultCountry: "AR" = "AR"): string | null {
  const cleaned = input.trim().replace(/[^\d+]/g, "");
  if (!cleaned) return null;
  const parsed = parsePhoneNumberFromString(cleaned, defaultCountry);
  if (!parsed || !parsed.isValid()) return null;
  if (parsed.country === "AR") {
    let national = parsed.nationalNumber;
    if (national.length === 11 && national.startsWith("9")) national = national.slice(1);
    if (national.length !== 10) return null;
    return `+549${national}`;
  }
  return parsed.number;
}

/** "+5492615123456" -> "+54 9 261 512 3456" para mostrar. */
export function formatPhone(e164: string): string {
  const p = parsePhoneNumberFromString(e164);
  return p ? p.formatInternational() : e164;
}
