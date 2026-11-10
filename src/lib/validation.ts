import { z } from "zod";
import { isValidDateStr, isValidHHMM } from "./time";

const cleanText = (max: number) =>
  z
    .string()
    .transform((s) => s.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim())
    .pipe(z.string().min(1).max(max));

export const dateStr = z.string().refine(isValidDateStr, "Fecha inválida");
export const timeStr = z.string().refine(isValidHHMM, "Hora inválida");
export const uuid = z.string().uuid();

export const bookingSchema = z.object({
  serviceId: uuid,
  date: dateStr,
  time: timeStr,
  name: cleanText(80),
  phone: z.string().min(6).max(30),
  /** Campo trampa anti-bots: las personas no lo ven ni lo completan. */
  website: z.string().max(200).optional(),
});

export const rescheduleSchema = z.object({ date: dateStr, time: timeStr });

export const availabilityQuery = z.object({
  serviceId: uuid,
  from: dateStr.optional(),
  days: z.coerce.number().int().min(1).max(92).default(31),
});

export const adminBookingSchema = z.object({
  serviceId: uuid,
  date: dateStr,
  time: timeStr,
  name: cleanText(80),
  phone: z.string().min(6).max(30),
  notes: z.string().max(500).optional(),
});

export { cleanText };
