import Link from "next/link";
import { OrdersQueue } from "@/components/admin/OrdersQueue";
import { OrderStatusSchema, type OrderStatus } from "@/lib/domain/order/schema";
import { requireAdminPage } from "@/lib/server/pageAuth";
import { container } from "@/lib/server/container";

export const dynamic = "force-dynamic";
export const metadata = { title: "Orders | Kitchen" };

const FILTERS: { status?: OrderStatus; label: string }[] = [
  { label: "All" },
  { status: "PENDING", label: "New" },
  { status: "ACCEPTED", label: "Accepted" },
  { status: "PREPARING", label: "Preparing" },
  { status: "READY", label: "Ready" },
  { status: "COMPLETED", label: "Completed" },
  { status: "CANCELLED", label: "Cancelled" },
  { status: "REJECTED", label: "Rejected" },
];

export default async function OrdersPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  await requireAdminPage();
  const parsed = OrderStatusSchema.safeParse((await searchParams).status);
  const status = parsed.success ? parsed.data : undefined;
  const c = container();
  const [orders, settings] = await Promise.all([c.repo.listOrders({ status }), c.repo.getSettings()]);
  return (
    <>
      <h1 className="font-display text-3xl font-extrabold">Orders</h1>
      <nav aria-label="Filter by status" className="mt-3 mb-5 flex flex-wrap gap-2 text-[15px]">
        {FILTERS.map((f) => (
          <Link key={f.label} href={f.status ? `/admin/orders?status=${f.status}` : "/admin/orders"} aria-current={f.status === status ? "page" : undefined} className={`rounded border px-3 py-1 ${f.status === status ? "border-ink bg-ink text-paper" : "border-line bg-card hover:border-ink"}`}>
            {f.label}
          </Link>
        ))}
      </nav>
      <OrdersQueue orders={orders} timezone={settings.timezone} />
    </>
  );
}
