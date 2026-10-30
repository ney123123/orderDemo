import { WEEKDAYS, type RestaurantSettings, type Weekday } from "./schema";

export type OpenStatus = { open: true } | { open: false; reason: "PAUSED" | "CLOSED" | "NO_PICKUP" };

const WEEKDAY_BY_SHORT: Record<string, Weekday> = {
  Mon: "MON", Tue: "TUE", Wed: "WED", Thu: "THU", Fri: "FRI", Sat: "SAT", Sun: "SUN",
};

/** Local weekday and HH:MM for `now` in the restaurant's time zone. */
export function localTime(now: Date, timezone: string): { weekday: Weekday; hhmm: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const weekday = WEEKDAY_BY_SHORT[get("weekday")];
  if (!weekday) throw new Error(`Unrecognised weekday for ${timezone}`);
  return { weekday, hhmm: `${get("hour")}:${get("minute")}` };
}

export function openStatus(settings: RestaurantSettings, now: Date): OpenStatus {
  if (!settings.acceptingOrders) return { open: false, reason: "PAUSED" };
  if (!settings.pickupAvailable) return { open: false, reason: "NO_PICKUP" };
  return currentWindow(settings, now) ? { open: true } : { open: false, reason: "CLOSED" };
}

/**
 * The opening window `now` falls in, if any. A window belongs to the day it opens; one whose close is
 * at or before its open runs past midnight, so after midnight the previous day's late window counts too.
 */
function currentWindow(settings: RestaurantSettings, now: Date): { open: string; close: string } | undefined {
  const { weekday, hhmm } = localTime(now, settings.timezone);
  const yesterday = WEEKDAYS[(WEEKDAYS.indexOf(weekday) + 6) % 7] as Weekday;
  const overnight = (w: { open: string; close: string }) => w.close <= w.open;
  return (
    (settings.hours[weekday] ?? []).find((w) => hhmm >= w.open && (overnight(w) || hhmm < w.close)) ??
    (settings.hours[yesterday] ?? []).find((w) => overnight(w) && hhmm < w.close)
  );
}

export function hoursText(settings: RestaurantSettings): string {
  return Object.entries(settings.hours)
    .map(([day, windows]) => `${day} ${windows.length ? windows.map((w) => `${w.open}-${w.close}`).join(", ") : "closed"}`)
    .join("; ");
}

/** ISO timestamp of local midnight (restaurant time zone) for the day containing `now`. */
export function startOfLocalDay(now: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const n = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const localAsUtc = Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute"), n("second"));
  const offsetMs = localAsUtc - Math.floor(now.getTime() / 1000) * 1000;
  return new Date(Date.UTC(n("year"), n("month") - 1, n("day")) - offsetMs).toISOString();
}

/** Plain-words status for the site header, e.g. "Open now until 21:00" or "Closed now". */
export function openStatusText(settings: RestaurantSettings, now: Date): string {
  const status = openStatus(settings, now);
  if (!status.open) {
    if (status.reason === "PAUSED") return "Not taking new orders right now";
    if (status.reason === "NO_PICKUP") return "Pickup is unavailable right now";
    return "Closed now";
  }
  const window = currentWindow(settings, now);
  return window ? `Open now until ${window.close}` : "Open now";
}
