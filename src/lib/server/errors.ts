import "server-only";

/** Códigos que lanzan las funciones de la base de datos -> mensaje para la persona + HTTP status. */
const KNOWN: Record<string, { status: number; message: string }> = {
  slot_taken: { status: 409, message: "Ese horario se acaba de ocupar. Elegí otro, por favor." },
  slot_unavailable: { status: 409, message: "Ese horario ya no está disponible. Elegí otro, por favor." },
  slot_in_past: { status: 400, message: "Ese horario ya pasó." },
  too_soon: { status: 409, message: "Ese horario ya no admite reservas por falta de anticipación." },
  too_far: { status: 400, message: "Todavía no se pueden reservar turnos para esa fecha." },
  closed_day: { status: 409, message: "No atendemos ese día." },
  outside_hours: { status: 409, message: "Ese horario está fuera del horario de atención." },
  slot_blocked: { status: 409, message: "Ese horario no está disponible." },
  service_unavailable: { status: 404, message: "Ese servicio ya no está disponible." },
  barber_unavailable: { status: 409, message: "No hay agenda disponible en este momento." },
  too_many_active: { status: 429, message: "Ya tenés varios turnos reservados con este número. Cancelá alguno o escribinos." },
  booking_disabled: { status: 403, message: "Las reservas online están pausadas por el momento." },
  not_found: { status: 404, message: "No encontramos ese turno." },
  not_editable: { status: 409, message: "Este turno ya no se puede modificar." },
  too_late_to_change: { status: 403, message: "Este turno es muy próximo para modificarlo online. Por favor contactá al local." },
  rate_limited: { status: 429, message: "Demasiados intentos. Esperá un momento y probá de nuevo." },
  invalid: { status: 400, message: "Revisá los datos ingresados." },
  unauthorized: { status: 401, message: "Sesión no válida." },
  forbidden: { status: 403, message: "No tenés permiso para hacer esto." },
  internal: { status: 500, message: "Algo salió mal de nuestro lado. Probá de nuevo en unos segundos." },
};

export class AppError extends Error {
  status: number;
  code: string;
  constructor(code: string, message?: string) {
    const known = KNOWN[code] ?? KNOWN.internal;
    super(message ?? known.message);
    this.code = KNOWN[code] ? code : "internal";
    this.status = known.status;
  }
}

type DbError = { message?: string; code?: string } | null | undefined;

export function mapDbError(err: DbError): AppError {
  const msg = err?.message ?? "";
  if (msg in KNOWN) return new AppError(msg);
  if (err?.code === "23P01") return new AppError("slot_taken");
  console.error("[db-error]", err);
  return new AppError("internal");
}
