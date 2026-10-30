import { SettingsForm } from "@/components/admin/SettingsForm";
import { requireAdminPage } from "@/lib/server/pageAuth";
import { container } from "@/lib/server/container";

export const dynamic = "force-dynamic";
export const metadata = { title: "Settings | Kitchen" };

export default async function SettingsPage() {
  await requireAdminPage();
  const settings = await container().repo.getSettings();
  return (
    <>
      <h1 className="mb-6 font-display text-3xl font-extrabold">Settings</h1>
      <SettingsForm key={settings.updatedAt} settings={settings} />
    </>
  );
}
