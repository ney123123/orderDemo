import { CartPanel } from "@/components/customer/CartPanel";
import { MenuBoard } from "@/components/customer/MenuBoard";
import { SiteHeader } from "@/components/shared/SiteHeader";
import { openStatusText } from "@/lib/domain/settings/hours";
import { publicMenu } from "@/lib/http/views";
import { container } from "@/lib/server/container";

export const dynamic = "force-dynamic";
export const metadata = { title: "Menu | Patty Lane Burgers" };

export default async function MenuPage() {
  const c = container();
  const [menu, settings] = await Promise.all([c.repo.getMenu(), c.repo.getSettings()]);
  return (
    <>
      <SiteHeader name={settings.name} status={openStatusText(settings, new Date())} />
      <main className="mx-auto grid max-w-6xl gap-8 px-4 py-8 lg:grid-cols-[1fr_22rem]">
        <div className="min-w-0"><MenuBoard menu={publicMenu(menu)} /></div>
        <div className="lg:sticky lg:top-6 lg:self-start">
          <CartPanel />
        </div>
      </main>
    </>
  );
}
