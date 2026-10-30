import { describe, expect, it } from "vitest";
import { localTime, openStatus, openStatusText } from "../../src/lib/domain/settings/hours";
import { OpeningWindowSchema, seedSettings } from "../../src/lib/domain/settings/schema";
import { CLOSED_NOW, OPEN_NOW } from "../helpers";

describe("opening hours", () => {
  it("uses the restaurant time zone, not UTC", () => {
    expect(localTime(OPEN_NOW, "America/Toronto")).toEqual({ weekday: "THU", hhmm: "12:00" });
    expect(localTime(CLOSED_NOW, "America/Toronto")).toEqual({ weekday: "WED", hhmm: "23:00" });
  });

  it("reports open, closed, paused and no-pickup", () => {
    const s = seedSettings();
    expect(openStatus(s, OPEN_NOW)).toEqual({ open: true });
    expect(openStatus(s, CLOSED_NOW)).toEqual({ open: false, reason: "CLOSED" });
    expect(openStatus({ ...s, acceptingOrders: false }, OPEN_NOW)).toEqual({ open: false, reason: "PAUSED" });
    expect(openStatus({ ...s, pickupAvailable: false }, OPEN_NOW)).toEqual({ open: false, reason: "NO_PICKUP" });
  });

  it("treats closing time as closed", () => {
    // Thursday 21:00 Toronto = 01:00Z Friday
    expect(openStatus(seedSettings(), new Date("2026-10-30T01:00:00Z"))).toEqual({ open: false, reason: "CLOSED" });
  });

  it("supports windows that close after midnight (close <= open means the next day)", () => {
    const late = [{ open: "09:00", close: "02:00" }];
    const s = { ...seedSettings(), hours: { ...seedSettings().hours, THU: late, FRI: [] } };
    // Thursday 23:00 Toronto (EDT, UTC-4) = 03:00Z Friday
    expect(openStatus(s, new Date("2026-10-30T03:00:00Z"))).toEqual({ open: true });
    expect(openStatusText(s, new Date("2026-10-30T03:00:00Z"))).toBe("Open now until 02:00");
    // Friday 01:30 Toronto still belongs to Thursday's window, even though Friday is closed
    expect(openStatus(s, new Date("2026-10-30T05:30:00Z"))).toEqual({ open: true });
    // Friday 02:00 Toronto: closed
    expect(openStatus(s, new Date("2026-10-30T06:00:00Z"))).toEqual({ open: false, reason: "CLOSED" });
    // Thursday 08:59 Toronto: not open yet
    expect(openStatus(s, new Date("2026-10-29T12:59:00Z"))).toEqual({ open: false, reason: "CLOSED" });
  });

  it("accepts overnight windows but rejects zero-length ones", () => {
    expect(OpeningWindowSchema.safeParse({ open: "09:00", close: "02:00" }).success).toBe(true);
    expect(OpeningWindowSchema.safeParse({ open: "09:00", close: "09:00" }).success).toBe(false);
  });
});
