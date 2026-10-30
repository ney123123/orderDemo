"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { formatCents } from "@/lib/domain/money";
import type { CartView, OrderView } from "@/lib/http/views";
import { announceCartChange, api, type ApiError } from "../shared/api";

const MISSING_LABELS: Record<string, string> = {
  format: "on its own or combo",
  spicy: "spicy or not",
  size: "size",
  side: "side",
  sideSize: "side size",
  drink: "drink",
  drinkSize: "drink size",
};

/**
 * Live view of the backend cart. Polls so that changes made in the chat show up here too;
 * every number shown comes from the server (priceLine), never from browser arithmetic.
 */
export function CartPanel() {
  const [cart, setCart] = useState<CartView | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [note, setNote] = useState("");

  const refresh = useCallback(async () => {
    const r = await api<{ cart: CartView }>("/api/cart");
    if (r.ok) setCart(r.data.cart);
  }, []);

  useEffect(() => {
    refresh();
    const timer = setInterval(() => document.visibilityState === "visible" && refresh(), 3000);
    window.addEventListener("cart:changed", refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener("cart:changed", refresh);
    };
  }, [refresh]);

  async function run(path: string, method: string, body?: unknown) {
    setBusy(true);
    setError(null);
    const r = await api<{ cart?: CartView; order?: OrderView }>(path, { method, body });
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      await refresh();
      return undefined;
    }
    if (r.data.cart) setCart(r.data.cart);
    announceCartChange();
    return r.data;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!cart?.review) return;
    const done = await run("/api/cart/submit", "POST", { reviewToken: cart.review.token, customerName: name, pickupNote: note || undefined });
    if (done?.order) window.location.assign(`/order/${done.order.id}`);
  }

  if (!cart) return <aside className="rounded-lg border border-line bg-card p-5 text-ink-soft">Loading your order…</aside>;

  return (
    <aside aria-labelledby="cart-heading" className="rounded-lg border border-line bg-card p-5">
      <h2 id="cart-heading" className="font-display text-xl font-bold">
        Your order
      </h2>

      {cart.orderId ? (
        <div className="mt-3 space-y-3">
          <p>
            Order <strong>{cart.orderId}</strong> is placed.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link href={`/order/${cart.orderId}`} className="font-bold underline decoration-mustard decoration-2 underline-offset-4">
              Follow your order
            </Link>
            <button type="button" disabled={busy} onClick={() => run("/api/cart/new", "POST")} className="font-bold text-leaf underline underline-offset-4">
              Start a new order
            </button>
          </div>
        </div>
      ) : cart.lines.length === 0 ? (
        <p className="mt-3 text-ink-soft">
          Nothing yet. Add something from the <Link href="/menu" className="underline">menu</Link> or ask in the chat.
        </p>
      ) : (
        <>
          <ul className="mt-3 divide-y divide-line">
            {cart.lines.map((l) => (
              <li key={l.lineId} className="flex items-start justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p>{l.description}</p>
                  {l.missing.length > 0 && (
                    <p className="text-sm text-mustard-deep">Still to choose: {l.missing.map((m) => MISSING_LABELS[m] ?? m).join(", ")}</p>
                  )}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => run(`/api/cart/lines/${l.lineId}`, "DELETE")}
                    className="text-sm text-ink-soft underline underline-offset-2 hover:text-ketchup"
                  >
                    Remove
                  </button>
                </div>
                <span className="tabular shrink-0 text-right">{l.lineCents === null ? "—" : formatCents(l.lineCents)}</span>
              </li>
            ))}
          </ul>
          <p className="tabular mt-2 flex justify-between border-t-2 border-ink pt-3 text-lg font-bold">
            <span>{cart.complete ? "Total" : "So far"}</span>
            <span>{formatCents(cart.totalCents)}</span>
          </p>

          {cart.review ? (
            <form onSubmit={submit} className="mt-4 space-y-3">
              <p className="text-sm text-ink-soft">Check your order, then tell us who it's for. You pay at the counter.</p>
              <label className="block">
                <span className="text-sm font-bold">Name for the order</span>
                <input required maxLength={40} value={name} onChange={(e) => setName(e.target.value)} className="mt-1 w-full rounded border border-line px-3 py-2" />
              </label>
              <label className="block">
                <span className="text-sm font-bold">Pickup note (optional)</span>
                <input maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} className="mt-1 w-full rounded border border-line px-3 py-2" />
              </label>
              <button type="submit" disabled={busy} className="w-full rounded bg-mustard px-4 py-3 font-bold text-ink hover:bg-mustard-deep disabled:opacity-60">
                Place order for {formatCents(cart.review.totalCents)}
              </button>
            </form>
          ) : (
            <button
              type="button"
              disabled={busy || !cart.complete}
              onClick={() => run("/api/cart/review", "POST")}
              className="mt-4 w-full rounded bg-mustard px-4 py-3 font-bold text-ink hover:bg-mustard-deep disabled:cursor-not-allowed disabled:opacity-50"
            >
              {cart.complete ? "Review order" : "Choose the remaining options first"}
            </button>
          )}
        </>
      )}

      {error && (
        <p role="alert" className="mt-3 rounded border border-ketchup/40 bg-ketchup/5 px-3 py-2 text-sm text-ketchup">
          {error.message}
        </p>
      )}
    </aside>
  );
}
