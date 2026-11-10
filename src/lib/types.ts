export type AppointmentStatus = "confirmed" | "completed" | "cancelled" | "no_show";

export const STATUS_LABEL: Record<AppointmentStatus, string> = {
  confirmed: "Confirmado",
  completed: "Completado",
  cancelled: "Cancelado",
  no_show: "No asistió",
};

export type BusinessSettings = {
  id: number;
  name: string;
  description: string | null;
  address: string | null;
  whatsapp: string | null;
  instagram_url: string | null;
  logo_url: string | null;
  cover_url: string | null;
  timezone: string;
  slot_interval_minutes: number;
  min_notice_minutes: number;
  max_days_ahead: number;
  cancel_notice_hours: number;
  max_active_per_phone: number;
  booking_enabled: boolean;
};

export type Service = {
  id: string;
  name: string;
  description: string | null;
  price_ars: number;
  duration_minutes: number;
  buffer_minutes: number;
  active: boolean;
  sort_order: number;
};

export type WorkingHourRow = { id: string; barber_id: string; weekday: number; start_minute: number; end_minute: number };
export type TimeOffRow = { id: string; barber_id: string; kind: "day_off" | "holiday" | "vacation"; start_date: string; end_date: string; reason: string | null };
export type TimeBlockRow = { id: string; barber_id: string; start_at: string; end_at: string; reason: string | null };

/** Fila de turno SIN el hash del token (nunca sale del servidor). */
export type Appointment = {
  id: string;
  barber_id: string;
  service_id: string | null;
  service_name: string;
  service_price_ars: number;
  duration_minutes: number;
  buffer_minutes: number;
  client_name: string;
  client_phone: string;
  start_at: string;
  end_at: string;
  occupied_until: string;
  status: AppointmentStatus;
  source: "online" | "admin";
  notes: string | null;
  cancelled_at: string | null;
  cancelled_by: "client" | "admin" | null;
  reschedule_count: number;
  created_at: string;
};

export const APPOINTMENT_COLUMNS =
  "id,barber_id,service_id,service_name,service_price_ars,duration_minutes,buffer_minutes,client_name,client_phone,start_at,end_at,occupied_until,status,source,notes,cancelled_at,cancelled_by,reschedule_count,created_at";

/** Lo único que ve un cliente sobre su propio turno. */
export type PublicAppointment = {
  serviceName: string;
  priceArs: number;
  durationMinutes: number;
  clientName: string;
  date: string;
  time: string;
  endTime: string;
  startAt: string;
  status: AppointmentStatus;
};
