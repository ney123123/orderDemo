import { z } from "zod";

export const OrderStatusSchema = z.enum(["PENDING", "ACCEPTED", "PREPARING", "READY", "COMPLETED", "CANCELLED", "REJECTED"]);
export type OrderStatus = z.infer<typeof OrderStatusSchema>;

const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  PENDING: ["ACCEPTED", "REJECTED", "CANCELLED"],
  ACCEPTED: ["PREPARING", "CANCELLED"],
  PREPARING: ["READY", "CANCELLED"],
  READY: ["COMPLETED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
  REJECTED: [],
};

export const canTransition = (from: OrderStatus, to: OrderStatus): boolean => TRANSITIONS[from].includes(to);

// Snapshot: names, options and prices as they were at submit time. Later menu edits never change it.
export const OrderLineSchema = z.object({
  itemId: z.string(),
  itemName: z.string(),
  description: z.string(),
  options: z.object({
    format: z.enum(["SINGLE", "COMBO"]).optional(),
    spicy: z.boolean().optional(),
    side: z.object({ itemId: z.string(), name: z.string(), size: z.enum(["REGULAR", "LARGE"]) }).optional(),
    drink: z.object({ itemId: z.string(), name: z.string(), size: z.enum(["REGULAR", "LARGE"]) }).optional(),
    size: z.enum(["REGULAR", "LARGE"]).optional(),
  }),
  quantity: z.number().int().positive(),
  unitCents: z.number().int().nonnegative(),
  lineCents: z.number().int().nonnegative(),
});
export type OrderLine = z.infer<typeof OrderLineSchema>;

export const OrderSchema = z.object({
  id: z.string(),
  cartId: z.string(),
  lines: z.array(OrderLineSchema).min(1),
  totalCents: z.number().int().nonnegative(),
  customerName: z.string().min(1).max(40),
  pickupNote: z.string().max(200).optional(),
  pickupInfo: z.string(),
  status: OrderStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Order = z.infer<typeof OrderSchema>;
