"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { formatCents } from "@/lib/domain/money";
import type { Order, OrderStatus } from "@/lib/domain/order/schema";
import { api } from "../shared/api";

// Mirrors the domain TRANSITIONS; the server enforces them regardless of what this UI offers.
const NEXT: Record<OrderStatus, { to: OrderStatus; label: string; tone: "go" | "stop" }[]> = {
  PENDING: [{ to: "ACCEPTED", label: "Accept", tone: "go" }, { to: "REJECTED", label: "Reject", tone: "stop" }],
  ACCEPTED: [{ to: "PREPARING", label: "Start preparing", tone: "go" }, { to: "CANCELLED", label: "Cancel", tone: "stop" }],
  PREPARING: [{ to: "READY", label: "Mark ready", tone: "go" }, { to: "CANCELLED", label: "Cancel", tone: "stop" }],
  READY: [{ to: "COMPLETED", label: "Picked up", tone: "go" }, { to: "CANCELLED", label: "Cancel", tone: "stop" }],
  COMPLETED: [],
  CANCELLED: [],
  REJECTED: [],
};
const STATUS_LABEL: Record<OrderStatus, string> = {
  PENDING: "New", ACCEPTED: "Accepted", PREPARING: "Preparing", READY: "Ready", COMPLETED: "Completed", CANCELLED: "Cancelled", REJECTED: "Rejected",
};

export function OrdersQueue({ orders, timezone }: { orders: Order[]; timezone: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    const t = setInterval(() => document.visibilityState === "visible" && router.refresh(), 10_000);
    return () => clearInterval(t);
  }, [router]);

  async function move(order: Order, to: OrderStatus) {
    if (to === "CANCELLED" || to === "REJECTED") {
      if (!window.confirm(`${to === "REJECTED" ? "Reject" : "Cancel"} order ${order.id} for ${order.customerName}?`)) return;
    }
    setBusy(order.id);
    const r = await api(`/api/admin/orders/${order.id}`, { method: "PATCH", body: { status: to, expectedUpdatedAt: order.updatedAt } });
    setBusy(null);
    setError(r.ok ? null : r.error.message);
    router.refresh();
  }

  const time = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: timezone, hour: "2-digit", minute: "2-digit", month: "short", day: "numeric" }).format(new Date(iso));

  if (orders.length === 0) return <p className="text-ink-soft">No orders here yet. New orders appear automatically.</p>;
  return (
    <>
      {error && <p role="alert" className="mb-3 rounded border border-ketchup/40 bg-ketchup/5 px-3 py-2 text-sm text-ketchup">{error}</p>}
      <ul className="space-y-3">
        {orders.map((o) => (
          <li key={o.id} className={`rounded-lg border bg-card p-4 ${o.status === "PENDING" ? "border-mustard-deep border-l-8" : "border-line"}`}>
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <p className="font-display text-xl font-bold">{o.customerName} <span className="font-body text-base font-normal text-ink-soft">{o.id}</span></p>
              <p className="tabular text-sm text-ink-soft">{time(o.createdAt)} <strong className="ml-2 text-ink">{STATUS_LABEL[o.status]}</strong></p>
            </div>
            <ul className="mt-2 text-[15px]">
              {o.lines.map((l, i) => (
                <li key={i} className="tabular flex justify-between gap-3"><span>{l.description}</span><span>{formatCents(l.lineCents)}</span></li>
              ))}
            </ul>
            {o.pickupNote && <p className="mt-2 rounded bg-mustard/15 px-2 py-1 text-[15px]">Note: {o.pickupNote}</p>}
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <p className="tabular font-bold">Total {formatCents(o.totalCents)}</p>
              <div className="flex gap-2">
                {NEXT[o.status].map((n) => (
                  <button
                    key={n.to}
                    type="button"
                    disabled={busy === o.id}
                    onClick={() => move(o, n.to)}
                    className={n.tone === "go" ? "rounded bg-mustard px-3 py-1.5 font-bold hover:bg-mustard-deep" : "rounded border border-ketchup/50 px-3 py-1.5 text-ketchup hover:bg-ketchup/5"}
                  >
                    {n.label}
                  </button>
                ))}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
