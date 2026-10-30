"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Availability, Menu, MenuItem } from "@/lib/domain/menu/schema";
import { api } from "../shared/api";
import { centsToInput, parseDollars } from "./money";

const AVAILABILITY: { value: Availability; label: string }[] = [
  { value: "AVAILABLE", label: "Available" },
  { value: "SOLD_OUT", label: "Sold out" },
  { value: "HIDDEN", label: "Hidden" },
];

function AvailabilitySelect({ value, onChange, label }: { value: Availability; onChange: (v: Availability) => void; label: string }) {
  return (
    <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value as Availability)} className="rounded border border-line bg-card px-2 py-1.5">
      {AVAILABILITY.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
    </select>
  );
}

function PriceInput({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  const invalid = parseDollars(value) === undefined;
  return (
    <label className="inline-flex items-center gap-1">
      <span className="sr-only">{label}</span>$
      <input aria-label={label} aria-invalid={invalid} inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} className={`tabular w-20 rounded border px-2 py-1.5 ${invalid ? "border-ketchup" : "border-line"}`} />
    </label>
  );
}

/** One item's editable row. Saves only the fields that changed, against the menu version the page loaded. */
function ItemRow({ item, menuUpdatedAt }: { item: MenuItem; menuUpdatedAt: string }) {
  const router = useRouter();
  const [description, setDescription] = useState(item.description);
  const [availability, setAvailability] = useState(item.availability);
  const [price, setPrice] = useState(item.category === "BURGER" ? centsToInput(item.basePriceCents) : "");
  const [sizes, setSizes] = useState(
    item.category === "BURGER"
      ? null
      : {
          REGULAR: { price: centsToInput(item.sizes.REGULAR.priceCents), availability: item.sizes.REGULAR.availability },
          LARGE: { price: centsToInput(item.sizes.LARGE.priceCents), availability: item.sizes.LARGE.availability },
        },
  );
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    const patch: Record<string, unknown> = {};
    if (description !== item.description) patch.description = description;
    if (availability !== item.availability) patch.availability = availability;
    if (item.category === "BURGER") {
      const cents = parseDollars(price);
      if (cents === undefined) return setMessage({ ok: false, text: "Enter the price like 7.00." });
      if (cents !== item.basePriceCents) patch.basePriceCents = cents;
    } else if (sizes) {
      const sizePatch: Record<string, Record<string, unknown>> = {};
      for (const s of ["REGULAR", "LARGE"] as const) {
        const cents = parseDollars(sizes[s].price);
        if (cents === undefined) return setMessage({ ok: false, text: "Enter prices like 1.50." });
        const p: Record<string, unknown> = {};
        if (cents !== item.sizes[s].priceCents) p.priceCents = cents;
        if (sizes[s].availability !== item.sizes[s].availability) p.availability = sizes[s].availability;
        if (Object.keys(p).length) sizePatch[s] = p;
      }
      if (Object.keys(sizePatch).length) patch.sizes = sizePatch;
    }
    if (Object.keys(patch).length === 0) return setMessage({ ok: true, text: "No changes to save." });
    setBusy(true);
    const r = await api(`/api/admin/menu/items/${item.id}`, { method: "PATCH", body: { patch, expectedUpdatedAt: menuUpdatedAt } });
    setBusy(false);
    setMessage(r.ok ? { ok: true, text: "Saved. Customers and the chat see this now." } : { ok: false, text: r.error.message });
    router.refresh();
  }

  return (
    <li className="border-b border-line py-4 last:border-b-0">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-display text-xl font-bold">{item.name} <span className="font-body text-sm font-normal text-ink-soft">{item.id}</span></h3>
        <div className="flex flex-wrap items-center gap-3">
          {item.category === "BURGER" && <PriceInput label={`${item.name} price`} value={price} onChange={setPrice} />}
          <AvailabilitySelect label={`${item.name} availability`} value={availability} onChange={setAvailability} />
        </div>
      </div>
      {sizes && (
        <div className="mt-2 flex flex-wrap gap-x-8 gap-y-2 text-[15px]">
          {(["REGULAR", "LARGE"] as const).map((s) => (
            <div key={s} className="flex items-center gap-2">
              <span className="w-16">{s === "LARGE" ? "Large" : "Regular"}</span>
              <PriceInput label={`${item.name} ${s.toLowerCase()} price`} value={sizes[s].price} onChange={(v) => setSizes({ ...sizes, [s]: { ...sizes[s], price: v } })} />
              <AvailabilitySelect label={`${item.name} ${s.toLowerCase()} availability`} value={sizes[s].availability} onChange={(v) => setSizes({ ...sizes, [s]: { ...sizes[s], availability: v } })} />
            </div>
          ))}
        </div>
      )}
      <label className="mt-2 block">
        <span className="sr-only">{item.name} description</span>
        <textarea value={description} maxLength={300} rows={2} onChange={(e) => setDescription(e.target.value)} className="w-full rounded border border-line bg-card px-3 py-2 text-[15px]" />
      </label>
      <div className="mt-2 flex items-center gap-3">
        <button type="button" disabled={busy} onClick={save} className="rounded bg-mustard px-3 py-1.5 font-bold hover:bg-mustard-deep disabled:opacity-60">Save {item.name}</button>
        {message && <span role="status" className={`text-sm ${message.ok ? "text-leaf" : "text-ketchup"}`}>{message.text}</span>}
      </div>
    </li>
  );
}

export function MenuEditor({ menu }: { menu: Menu }) {
  return (
    <ul>
      {menu.items.map((i) => (
        // Re-mount rows when the menu version changes so they show the saved values.
        <ItemRow key={`${i.id}-${menu.updatedAt}`} item={i} menuUpdatedAt={menu.updatedAt} />
      ))}
    </ul>
  );
}
