import { AdminNav } from "@/components/admin/AdminNav";
import { requireAdminPage } from "@/lib/server/pageAuth";
import { container } from "@/lib/server/container";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false } };

// Pages check the session themselves too; a layout alone is not an auth boundary.
export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const claims = await requireAdminPage();
  const settings = await container().repo.getSettings();
  return (
    <>
      <AdminNav restaurant={settings.name} user={claims.sub} />
      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
    </>
  );
}
