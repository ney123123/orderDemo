import { OrderStatus } from "@/components/customer/OrderStatus";
import { SiteHeader } from "@/components/shared/SiteHeader";
import { openStatusText } from "@/lib/domain/settings/hours";
import { container } from "@/lib/server/container";

export const dynamic = "force-dynamic";
export const metadata = { title: "Your order | Patty Lane Burgers" };

// The order itself is loaded client-side from /api/orders/[id], which checks the cart cookie.
export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const settings = await container().repo.getSettings();
  return (
    <>
      <SiteHeader name={settings.name} status={openStatusText(settings, new Date())} />
      <main className="mx-auto max-w-3xl px-4 py-10">
        <OrderStatus orderId={id} />
      </main>
    </>
  );
}
