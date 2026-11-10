import { requireAdminPage } from "@/lib/server/admin";
import { loadSettingsFor } from "@/lib/server/admin-data";
import { loadBarberId } from "@/lib/server/availability-service";
import { PoliciesForm, ScheduleEditor } from "@/components/admin/settings";
import { SettingsTabs } from "@/components/admin/Nav";

export default async function HoursPage() {
  const { sb } = await requireAdminPage();
  const settings = await loadSettingsFor(sb);
  const barberId = await loadBarberId();
  const { data } = await sb.from("working_hours").select("weekday,start_minute,end_minute").eq("barber_id", barberId);
  return (
    <div className="space-y-10">
      <SettingsTabs />
      <ScheduleEditor initial={data ?? []} />
      <PoliciesForm settings={settings} />
    </div>
  );
}
