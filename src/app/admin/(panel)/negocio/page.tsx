import { requireAdminPage } from "@/lib/server/admin";
import { loadSettingsFor } from "@/lib/server/admin-data";
import { BusinessForm } from "@/components/admin/settings";
import { SettingsTabs } from "@/components/admin/Nav";

export default async function BusinessPage() {
  const { sb } = await requireAdminPage();
  const settings = await loadSettingsFor(sb);
  return (
    <div>
      <SettingsTabs />
      <BusinessForm settings={settings} />
    </div>
  );
}
