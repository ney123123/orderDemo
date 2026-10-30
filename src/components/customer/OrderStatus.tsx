"use client";

import { useEffect, useState } from "react";
import { formatCents } from "@/lib/domain/money";
import type { OrderView } from "@/lib/http/views";
import { api } from "../shared/api";

const STEPS = ["PENDING", "ACCEPTED", "PREPARING", "READY", "COMPLETED"] as const;
const LABEL: Record<string, string> = {
  PENDING: "Sent to the kitchen",
  ACCEPTED: "Accepted",
  PREPARING: "Being made",
  READY: "Ready for pickup",
  COMPLETED: "Picked up",
  CANCELLED: "Cancelled",
  REJECTED: "Declined by the restaurant",
};
const FINAL = new Set(["COMPLETED", "CANCELLED", "REJECTED"]);

/** Polls the persisted order status; what you see is always the backend state. */
export function OrderStatus({ orderId }: { orderId: string }) {
  const [order, setOrder] = useState<OrderView | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let stopped = false;
    const load = async () => {
      const r = await api<{ order: OrderView }>(`/api/orders/${encodeURIComponent(orderId)}`);
      if (stopped) return;
      if (!r.ok) {
        if (r.error.code === "NOT_FOUND") return setMissing(true);
      } else {
        setOrder(r.data.order);
        if (FINAL.has(r.data.order.status)) return;
      }
      timer = setTimeout(load, 5000);
    };
    load();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [orderId]);

  if (missing) return <p>We can’t find that order in this browser. Orders can only be viewed from the browser that placed them.</p>;
  if (!order) return <p className="text-ink-soft">Loading your order…</p>;

  const stopped = order.status === "CANCELLED" || order.status === "REJECTED";
  const reached = STEPS.indexOf(order.status as (typeof STEPS)[number]);
  return (
    <div className="space-y-8">
      <div>
        <p className="text-ink-soft">Order {order.id} for {order.customerName}</p>
        <h1 aria-live="polite" className={`font-display text-5xl font-extrabold tracking-tight sm:text-6xl ${stopped ? "text-ketchup" : ""}`}>{LABEL[order.status]}</h1>
      </div>
      {!stopped && (
        <ol className="grid grid-cols-5 gap-1.5" aria-label="Order progress">
          {STEPS.map((s, i) => (
            <li key={s} className="text-xs sm:text-sm">
              <span className={`block h-2 rounded-full ${i <= reached ? "bg-mustard" : "bg-line"}`} />
              <span className={`mt-1 block ${i === reached ? "font-bold" : "text-ink-soft"}`}>{LABEL[s]}</span>
            </li>
          ))}
        </ol>
      )}
      <section aria-labelledby="items" className="rounded-lg border border-line bg-card p-5">
        <h2 id="items" className="font-display text-xl font-bold">What you ordered</h2>
        <ul className="mt-2 divide-y divide-line">
          {order.lines.map((l, i) => (
            <li key={i} className="tabular flex justify-between gap-3 py-2"><span>{l.description}</span><span>{formatCents(l.lineCents)}</span></li>
          ))}
        </ul>
        <p className="tabular mt-2 flex justify-between border-t-2 border-ink pt-2 text-lg font-bold"><span>Total, pay at pickup</span><span>{formatCents(order.totalCents)}</span></p>
        {order.pickupNote && <p className="mt-3 text-sm">Your note: {order.pickupNote}</p>}
        <p className="mt-3 text-sm text-ink-soft">{order.pickupInfo}</p>
      </section>
    </div>
  );
}
