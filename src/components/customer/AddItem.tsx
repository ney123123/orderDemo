"use client";

import { useState } from "react";
import { formatCents } from "@/lib/domain/money";
import type { PublicMenu } from "@/lib/http/views";
import { announceCartChange, api } from "../shared/api";

type Item = PublicMenu["items"][number];
type Size = "REGULAR" | "LARGE";
const SIZE_LABEL: Record<Size, string> = { REGULAR: "Regular", LARGE: "Large" };

function slotChoices(menu: PublicMenu, category: "SIDE" | "DRINK") {
  const out: { id: string; size: Size; label: string }[] = [];
  for (const i of menu.items) {
    if (i.category !== category || i.availability !== "AVAILABLE" || !("sizes" in i)) continue;
    for (const size of ["REGULAR", "LARGE"] as const) {
      if (i.sizes[size]?.availability === "AVAILABLE") out.push({ id: i.id, size, label: `${SIZE_LABEL[size]} ${i.name}` });
    }
  }
  return out;
}

/** Option picker for one menu item. Sends choices to the same cart service the AI uses; the server prices it. */
export function AddItem({ item, menu }: { item: Item; menu: PublicMenu }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [format, setFormat] = useState<"SINGLE" | "COMBO">("SINGLE");
  const [spicy, setSpicy] = useState(false);
  const [side, setSide] = useState("");
  const [drink, setDrink] = useState("");
  const [size, setSize] = useState<Size | "">("");

  if (item.availability === "SOLD_OUT") return <span className="text-sm font-bold text-ketchup">Sold out today</span>;

  const sides = slotChoices(menu, "SIDE");
  const drinks = slotChoices(menu, "DRINK");
  const sizes = "sizes" in item ? (["REGULAR", "LARGE"] as const).filter((s) => item.sizes[s]?.availability === "AVAILABLE") : [];

  async function add(e: React.FormEvent) {
    e.preventDefault();
    let body: Record<string, unknown> = { itemId: item.id, quantity };
    if (item.category === "BURGER") {
      body = { ...body, format, spicy };
      if (format === "COMBO") {
        const [sideId, sideSize] = side.split(":");
        const [drinkId, drinkSize] = drink.split(":");
        body = { ...body, sideId, sideSize, drinkId, drinkSize };
      }
    } else {
      body.size = size;
    }
    setBusy(true);
    const r = await api("/api/cart/lines", { method: "POST", body });
    setBusy(false);
    if (r.ok) {
      announceCartChange();
      setMessage({ ok: true, text: "Added to your order." });
      setOpen(false);
    } else {
      setMessage({ ok: false, text: r.error.message });
    }
  }

  if (!open) {
    return (
      <div className="flex flex-col items-end gap-1">
        <button type="button" onClick={() => { setOpen(true); setMessage(null); }} className="rounded bg-mustard px-3 py-1.5 text-sm font-bold hover:bg-mustard-deep">
          Add
        </button>
        {message && <span role="status" className={`text-sm ${message.ok ? "text-leaf" : "text-ketchup"}`}>{message.text}</span>}
      </div>
    );
  }

  const radio = "mr-1.5 accent-[#2f5d3a]";
  return (
    <form onSubmit={add} className="mt-3 w-full space-y-3 rounded border border-line bg-paper p-4 text-[15px]">
      {item.category === "BURGER" ? (
        <>
          <fieldset className="flex flex-wrap gap-x-5 gap-y-1">
            <legend className="mb-1 text-sm font-bold">How would you like it?</legend>
            <label><input type="radio" className={radio} checked={format === "SINGLE"} onChange={() => setFormat("SINGLE")} />On its own</label>
            <label><input type="radio" className={radio} checked={format === "COMBO"} onChange={() => setFormat("COMBO")} />Combo with a side and a drink (+{formatCents(menu.combo.baseFeeCents)}, +{formatCents(menu.combo.largeUpgradeCents)} per large)</label>
          </fieldset>
          <fieldset className="flex gap-5">
            <legend className="mb-1 text-sm font-bold">Spicy?</legend>
            <label><input type="radio" className={radio} checked={!spicy} onChange={() => setSpicy(false)} />Not spicy</label>
            <label><input type="radio" className={radio} checked={spicy} onChange={() => setSpicy(true)} />Spicy</label>
          </fieldset>
          {format === "COMBO" && (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="text-sm font-bold">Side</span>
                <select required value={side} onChange={(e) => setSide(e.target.value)} className="mt-1 w-full rounded border border-line bg-card px-2 py-2">
                  <option value="">Choose a side</option>
                  {sides.map((s) => <option key={`${s.id}:${s.size}`} value={`${s.id}:${s.size}`}>{s.label}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="text-sm font-bold">Drink</span>
                <select required value={drink} onChange={(e) => setDrink(e.target.value)} className="mt-1 w-full rounded border border-line bg-card px-2 py-2">
                  <option value="">Choose a drink</option>
                  {drinks.map((d) => <option key={`${d.id}:${d.size}`} value={`${d.id}:${d.size}`}>{d.label}</option>)}
                </select>
              </label>
            </div>
          )}
        </>
      ) : (
        <fieldset className="flex gap-5">
          <legend className="mb-1 text-sm font-bold">Size</legend>
          {sizes.map((s) => (
            <label key={s}>
              <input type="radio" required name={`size-${item.id}`} className={radio} checked={size === s} onChange={() => setSize(s)} />
              {SIZE_LABEL[s]} {"sizes" in item && item.sizes[s] ? formatCents(item.sizes[s].priceCents) : ""}
            </label>
          ))}
        </fieldset>
      )}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <label className="block">
          <span className="text-sm font-bold">Quantity</span>
          <input type="number" min={1} max={20} value={quantity} onChange={(e) => setQuantity(Math.max(1, Math.min(20, Number(e.target.value) || 1)))} className="tabular mt-1 block w-20 rounded border border-line bg-card px-2 py-1.5" />
        </label>
        <div className="flex gap-3">
          <button type="button" onClick={() => setOpen(false)} className="px-2 py-2 text-ink-soft underline underline-offset-2">Cancel</button>
          <button type="submit" disabled={busy} className="rounded bg-mustard px-4 py-2 font-bold hover:bg-mustard-deep disabled:opacity-60">Add to order</button>
        </div>
      </div>
      {message && !message.ok && <p role="alert" className="text-sm text-ketchup">{message.text}</p>}
    </form>
  );
}
