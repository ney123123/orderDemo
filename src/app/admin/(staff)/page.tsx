import Link from "next/link";
import { OrdersQueue } from "@/components/admin/OrdersQueue";
import { formatCents } from "@/lib/domain/money";
import { openStatusText } from "@/lib/domain/settings/hours";
import { requireAdminPage } from "@/lib/server/pageAuth";
import { container } from "@/lib/server/container";

export const dynamic = "force-dynamic";
export const metadata = { title: "Today | Kitchen" };

const ACTIVE = new Set(["PENDING", "ACCEPTED", "PREPARING", "READY"]);

export default async function Overview() {
  await requireAdminPage();
  const { settings, menu, today } = await container().admin.overview();
  const active = today.filter((o) => ACTIVE.has(o.status));
  const takings = today.filter((o) => o.status === "COMPLETED").reduce((s, o) => s + o.totalCents, 0);
  const unavailable = menu.items.filter((i) => i.availability !== "AVAILABLE");
  const paused = !settings.acceptingOrders || !settings.pickupAvailable;

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_18rem]">
      <section aria-labelledby="active">
        <h1 id="active" className="font-display text-3xl font-extrabold">{active.length === 0 ? "No open orders" : `${active.length} open ${active.length === 1 ? "order" : "orders"}`}</h1>
        <p className="mt-1 mb-4 text-ink-soft">{today.length} today, {formatCents(takings)} picked up so far.</p>
        <OrdersQueue orders={active} timezone={settings.timezone} />
      </section>
      <aside className="space-y-4">
        <div className={`rounded-lg p-4 ${paused ? "bg-ketchup text-paper" : "bg-leaf text-paper"}`}>
          <p className="font-display text-xl font-bold">{openStatusText(settings, new Date())}</p>
          <Link href="/admin/settings" className="mt-1 inline-block underline underline-offset-4">{paused ? "Resume orders in settings" : "Pause new orders"}</Link>
        </div>
        <div className="rounded-lg border border-line bg-card p-4">
          <h2 className="font-display text-lg font-bold">Not available</h2>
          {unavailable.length === 0 ? (
            <p className="text-ink-soft">Everything on the menu is available.</p>
          ) : (
            <ul className="mt-1">{unavailable.map((i) => <li key={i.id}>{i.name}: {i.availability === "SOLD_OUT" ? "sold out" : "hidden"}</li>)}</ul>
          )}
          <Link href="/admin/menu" className="mt-2 inline-block text-sm underline underline-offset-4">Edit menu</Link>
        </div>
      </aside>
    </div>
  );
}
