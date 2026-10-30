import { z } from "zod";
import { SizeSchema } from "../menu/schema";

export const FormatSchema = z.enum(["SINGLE", "COMBO"]);
export type Format = z.infer<typeof FormatSchema>;

export const MAX_QUANTITY = 20;
export const MAX_LINES = 30;

// One flat line shape for every item. Which fields apply depends on the item's category;
// cart/lines.ts enforces that. Every unit in a line shares the line's options.
export const CartLineSchema = z.object({
  lineId: z.string(),
  itemId: z.string(),
  quantity: z.number().int().min(1).max(MAX_QUANTITY),
  format: FormatSchema.optional(), // burgers
  spicy: z.boolean().optional(), // burgers
  sideId: z.string().optional(), // combo slot
  sideSize: SizeSchema.optional(),
  drinkId: z.string().optional(), // combo slot
  drinkSize: SizeSchema.optional(),
  size: SizeSchema.optional(), // side or drink ordered on its own
});
export type CartLine = z.infer<typeof CartLineSchema>;

export const ReviewSchema = z.object({
  token: z.string(),
  totalCents: z.number().int(),
  cartVersion: z.number().int(),
});
export type Review = z.infer<typeof ReviewSchema>;

export const CartSchema = z.object({
  id: z.string(),
  version: z.number().int().nonnegative(), // bumped on every change; optimistic concurrency
  lines: z.array(CartLineSchema).max(MAX_LINES),
  nextLineNo: z.number().int().positive(),
  review: ReviewSchema.optional(), // set by reviewOrder; any change clears it
  orderId: z.string().optional(), // set once, by the submit transaction
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Cart = z.infer<typeof CartSchema>;

export function emptyCart(id: string, now: Date): Cart {
  const t = now.toISOString();
  return { id, version: 0, lines: [], nextLineNo: 1, createdAt: t, updatedAt: t };
}
