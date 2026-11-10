import { requireAdminPage } from "@/lib/server/admin";
import type { Service } from "@/lib/types";
import { ServicesManager } from "@/components/admin/settings";

export default async function ServicesPage() {
  const { sb } = await requireAdminPage();
  const { data } = await sb.from("services").select("*").order("sort_order").order("created_at");
  return <ServicesManager services={(data ?? []) as Service[]} />;
}
