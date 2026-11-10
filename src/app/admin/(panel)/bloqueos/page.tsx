import { requireAdminPage } from "@/lib/server/admin";
import { nowMs } from "@/lib/server/now";
import { loadSettingsFor } from "@/lib/server/admin-data";
import { formatTimeInTz, todayInTz, utcToZoned } from "@/lib/time";
import type { TimeBlockRow, TimeOffRow } from "@/lib/types";
import { TimeOffManager } from "@/components/admin/settings";
import { SettingsTabs } from "@/components/admin/Nav";

export default async function BlocksPage() {
  const { sb } = await requireAdminPage();
  const settings = await loadSettingsFor(sb);
  const tz = settings.timezone;
  const today = todayInTz(nowMs(), tz);
  const [off, blk] = await Promise.all([
    sb.from("time_off").select("*").gte("end_date", today).order("start_date"),
    sb.from("time_blocks").select("*").gt("end_at", new Date().toISOString()).order("start_at"),
  ]);
  const blocks = ((blk.data ?? []) as TimeBlockRow[]).map((b) => ({
    ...b,
    date: utcToZoned(Date.parse(b.start_at), tz).date,
    start: formatTimeInTz(Date.parse(b.start_at), tz),
    end: formatTimeInTz(Date.parse(b.end_at), tz),
  }));
  return (
    <div>
      <SettingsTabs />
      <TimeOffManager timeOff={(off.data ?? []) as TimeOffRow[]} blocks={blocks} tz={tz} today={today} />
    </div>
  );
}
