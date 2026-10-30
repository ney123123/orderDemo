"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { WEEKDAYS, type RestaurantSettings, type Weekday } from "@/lib/domain/settings/schema";
import { api } from "../shared/api";

const DAY: Record<Weekday, string> = { MON: "Monday", TUE: "Tuesday", WED: "Wednesday", THU: "Thursday", FRI: "Friday", SAT: "Saturday", SUN: "Sunday" };

export function SettingsForm({ settings }: { settings: RestaurantSettings }) {
  const router = useRouter();
  const [s, setS] = useState(settings);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const setDay = (d: Weekday, field: "open" | "close" | "closed", value: string | boolean) => {
    const current = s.hours[d]?.[0] ?? { open: "11:00", close: "21:00" };
    const hours = { ...s.hours, [d]: field === "closed" ? (value ? [] : [current]) : [{ ...current, [field]: value as string }] };
    setS({ ...s, hours });
  };

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const { updatedAt, ...patch } = s;
    setBusy(true);
    const r = await api("/api/admin/settings", { method: "PATCH", body: { patch, expectedUpdatedAt: updatedAt } });
    setBusy(false);
    setMessage(r.ok ? { ok: true, text: "Settings saved." } : { ok: false, text: r.error.message });
    router.refresh();
  }

  const input = "mt-1 w-full rounded border border-line bg-card px-3 py-2";
  return (
    <form onSubmit={save} className="space-y-8">
      <fieldset className="space-y-3 rounded-lg border-2 border-ink p-4">
        <legend className="px-1 font-display text-xl font-bold">Taking orders</legend>
        <label className="flex items-center gap-3 text-lg">
          <input type="checkbox" className="size-5 accent-[#2f5d3a]" checked={s.acceptingOrders} onChange={(e) => setS({ ...s, acceptingOrders: e.target.checked })} />
          Accept new orders
        </label>
        <label className="flex items-center gap-3 text-lg">
          <input type="checkbox" className="size-5 accent-[#2f5d3a]" checked={s.pickupAvailable} onChange={(e) => setS({ ...s, pickupAvailable: e.target.checked })} />
          Pickup available
        </label>
        <p className="text-sm text-ink-soft">Turning either off stops new orders on the site and in the chat straight away. Orders already placed are not affected.</p>
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 font-display text-xl font-bold">Restaurant</legend>
        <label className="block"><span className="text-sm font-bold">Name</span><input required maxLength={80} className={input} value={s.name} onChange={(e) => setS({ ...s, name: e.target.value })} /></label>
        <label className="block"><span className="text-sm font-bold">Time zone</span><input required className={input} value={s.timezone} onChange={(e) => setS({ ...s, timezone: e.target.value })} /></label>
        <label className="block"><span className="text-sm font-bold">Phone</span><input maxLength={40} className={input} value={s.contact.phone} onChange={(e) => setS({ ...s, contact: { ...s.contact, phone: e.target.value } })} /></label>
        <label className="block"><span className="text-sm font-bold">Email</span><input maxLength={120} className={input} value={s.contact.email} onChange={(e) => setS({ ...s, contact: { ...s.contact, email: e.target.value } })} /></label>
        <label className="block sm:col-span-2"><span className="text-sm font-bold">Address</span><input maxLength={200} className={input} value={s.contact.address} onChange={(e) => setS({ ...s, contact: { ...s.contact, address: e.target.value } })} /></label>
        <label className="block sm:col-span-2"><span className="text-sm font-bold">Pickup info shown to customers</span><textarea maxLength={300} rows={2} className={input} value={s.pickupInfo} onChange={(e) => setS({ ...s, pickupInfo: e.target.value })} /></label>
      </fieldset>

      <fieldset>
        <legend className="mb-2 font-display text-xl font-bold">Opening hours</legend>
        <table className="tabular text-[15px]">
          <tbody>
            {WEEKDAYS.map((d) => {
              const w = s.hours[d]?.[0];
              return (
                <tr key={d}>
                  <th scope="row" className="py-1 pr-4 text-left font-normal">{DAY[d]}</th>
                  <td className="py-1 pr-3"><input type="time" aria-label={`${DAY[d]} opens`} disabled={!w} value={w?.open ?? ""} onChange={(e) => setDay(d, "open", e.target.value)} className="rounded border border-line bg-card px-2 py-1 disabled:opacity-40" /></td>
                  <td className="py-1 pr-3"><input type="time" aria-label={`${DAY[d]} closes`} disabled={!w} value={w?.close ?? ""} onChange={(e) => setDay(d, "close", e.target.value)} className="rounded border border-line bg-card px-2 py-1 disabled:opacity-40" /></td>
                  <td className="py-1"><label className="flex items-center gap-1.5"><input type="checkbox" className="accent-[#2f5d3a]" checked={!w} onChange={(e) => setDay(d, "closed", e.target.checked)} />Closed</label></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </fieldset>

      <div className="flex items-center gap-3">
        <button type="submit" disabled={busy} className="rounded bg-mustard px-4 py-2 font-bold hover:bg-mustard-deep disabled:opacity-60">Save settings</button>
        {message && <span role="status" className={`text-sm ${message.ok ? "text-leaf" : "text-ketchup"}`}>{message.text}</span>}
      </div>
    </form>
  );
}
