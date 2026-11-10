import type { Metadata } from "next";
import { requireAdminPage } from "@/lib/server/admin";
import { loadSettingsFor } from "@/lib/server/admin-data";
import { AdminNav } from "@/components/admin/Nav";

export const metadata: Metadata = { title: "Panel", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const { sb } = await requireAdminPage();
  const settings = await loadSettingsFor(sb);
  return (
    <div className="min-h-dvh bg-neutral-50">
      <AdminNav businessName={settings.name} />
      <main className="px-4 pb-28 pt-6 md:ml-56 md:px-8 md:pb-10">
        <div className="mx-auto max-w-3xl">{children}</div>
      </main>
    </div>
  );
}
