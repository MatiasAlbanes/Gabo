// WhatsApp por enlaces wa.me (sin API). La interfaz `WhatsAppNotifier` deja preparada
// la integración futura con WhatsApp Business Platform (ver docs/WHATSAPP.md).

import { formatDateLong, formatTimeInTz, utcToZoned } from "./time";

/** wa.me exige solo dígitos, con código de país y sin "+". */
export function waLink(e164: string, message?: string): string {
  const digits = e164.replace(/\D/g, "");
  return message ? `https://wa.me/${digits}?text=${encodeURIComponent(message)}` : `https://wa.me/${digits}`;
}

type ApptLike = { client_name: string; service_name: string; start_at: string };

export function describeSlot(a: { start_at: string }, tz: string): string {
  const ms = Date.parse(a.start_at);
  return `${formatDateLong(utcToZoned(ms, tz).date)} a las ${formatTimeInTz(ms, tz)} hs`;
}

export const messages = {
  confirmation: (a: ApptLike, tz: string, businessName: string, manageUrl?: string) =>
    `Hola ${a.client_name}! Tu turno en ${businessName} está confirmado: ${a.service_name}, ${describeSlot(a, tz)}.` +
    (manageUrl ? ` Podés verlo, cancelarlo o reprogramarlo acá: ${manageUrl}` : ""),
  reminder: (a: ApptLike, tz: string, businessName: string) =>
    `Hola ${a.client_name}! Te recordamos tu turno en ${businessName}: ${a.service_name}, ${describeSlot(a, tz)}. ¡Te esperamos!`,
  cancelled: (a: ApptLike, tz: string, businessName: string) =>
    `Hola ${a.client_name}, lamentablemente tuvimos que cancelar tu turno en ${businessName} (${a.service_name}, ${describeSlot(a, tz)}). Escribinos y te damos otro horario.`,
  rescheduled: (a: ApptLike, tz: string, businessName: string) =>
    `Hola ${a.client_name}! Tu turno en ${businessName} fue reprogramado: ${a.service_name}, ${describeSlot(a, tz)}.`,
  generic: (a: ApptLike, businessName: string) => `Hola ${a.client_name}! Te escribimos de ${businessName}.`,
  /** Mensaje del cliente al local desde la página pública. */
  clientToBusiness: (businessName: string) => `Hola ${businessName}! Quería consultar por un turno.`,
  shareReceipt: (a: ApptLike, tz: string, businessName: string, manageUrl: string) =>
    `Mi turno en ${businessName}: ${a.service_name}, ${describeSlot(a, tz)}. Detalle: ${manageUrl}`,
};

/** Punto de extensión para WhatsApp Business Platform (no implementado: requiere credenciales oficiales). */
export interface WhatsAppNotifier {
  sendConfirmation(appointmentId: string): Promise<void>;
  sendReminder(appointmentId: string): Promise<void>;
  sendCancellation(appointmentId: string): Promise<void>;
  sendReschedule(appointmentId: string): Promise<void>;
}
