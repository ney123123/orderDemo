import { MenuEditor } from "@/components/admin/MenuEditor";
import { requireAdminPage } from "@/lib/server/pageAuth";
import { container } from "@/lib/server/container";

export const dynamic = "force-dynamic";
export const metadata = { title: "Menu | Kitchen" };

export default async function AdminMenuPage() {
  await requireAdminPage();
  const menu = await container().repo.getMenu();
  return (
    <>
      <h1 className="font-display text-3xl font-extrabold">Menu</h1>
      <p className="mt-1 mb-4 max-w-prose text-ink-soft">
        Changes apply to new orders straight away, on the site and in the chat. Orders already placed keep the prices they were placed at. “Hidden” removes an item from the menu; “Sold out” shows it but stops orders.
      </p>
      <MenuEditor menu={menu} />
    </>
  );
}
