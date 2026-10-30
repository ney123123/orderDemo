import { z } from "zod";

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const WEEKDAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export const OpeningWindowSchema = z
  .object({ open: hhmm, close: hhmm })
  // close <= open means the window runs past midnight (e.g. 09:00-02:00 closes at 02:00 the next day).
  .refine((w) => w.open !== w.close, { message: "open and close can't be the same time" });

export const RestaurantSettingsSchema = z.object({
  name: z.string().min(1).max(80),
  timezone: z.string().min(1),
  hours: z.record(z.enum(WEEKDAYS), z.array(OpeningWindowSchema)),
  contact: z.object({ phone: z.string().max(40), email: z.string().max(120), address: z.string().max(200) }),
  pickupInfo: z.string().max(300),
  pickupAvailable: z.boolean(),
  acceptingOrders: z.boolean(),
  updatedAt: z.string(),
});
export type RestaurantSettings = z.infer<typeof RestaurantSettingsSchema>;

export function seedSettings(): RestaurantSettings {
  const day = [{ open: "11:00", close: "21:00" }];
  return {
    name: "Patty Lane Burgers",
    timezone: "America/Toronto",
    hours: { MON: day, TUE: day, WED: day, THU: day, FRI: [{ open: "11:00", close: "22:00" }], SAT: [{ open: "11:00", close: "22:00" }], SUN: [{ open: "12:00", close: "20:00" }] },
    contact: { phone: "555-0100 (fictional)", email: "hello@pattylane.example", address: "1 Fictional Lane, Toronto" },
    pickupInfo: "Pick up at the front counter. Pay in store.",
    pickupAvailable: true,
    acceptingOrders: true,
    updatedAt: "2026-10-29T00:00:00.000Z",
  };
}
