import { z } from "zod";

export const AvailabilitySchema = z.enum(["AVAILABLE", "SOLD_OUT", "HIDDEN"]);
export type Availability = z.infer<typeof AvailabilitySchema>;

export const SizeSchema = z.enum(["REGULAR", "LARGE"]);
export type Size = z.infer<typeof SizeSchema>;
export const SIZES = SizeSchema.options;

export const CategorySchema = z.enum(["BURGER", "SIDE", "DRINK"]);
export type Category = z.infer<typeof CategorySchema>;

const cents = z.number().int().nonnegative();

const ItemBase = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_]{0,31}$/),
  name: z.string().min(1).max(60),
  description: z.string().max(300),
  availability: AvailabilitySchema,
  imageUrl: z.string().url().optional(),
  ingredients: z.array(z.string()).default([]),
  allergens: z.array(z.string()).default([]),
  dietary: z.array(z.string()).default([]),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const BurgerItemSchema = ItemBase.extend({
  category: z.literal("BURGER"),
  basePriceCents: cents,
});

// Sides and drinks are sold by size; each size has its own price and availability.
export const SizedItemSchema = ItemBase.extend({
  category: z.enum(["SIDE", "DRINK"]),
  sizes: z.object({
    REGULAR: z.object({ priceCents: cents, availability: AvailabilitySchema }),
    LARGE: z.object({ priceCents: cents, availability: AvailabilitySchema }),
  }),
});

export const MenuItemSchema = z.discriminatedUnion("category", [BurgerItemSchema, SizedItemSchema]);
export type BurgerItem = z.infer<typeof BurgerItemSchema>;
export type SizedItem = z.infer<typeof SizedItemSchema>;
export type MenuItem = z.infer<typeof MenuItemSchema>;

export const ComboRuleSchema = z.object({
  baseFeeCents: cents, // added to the burger price
  largeUpgradeCents: cents, // per Large slot (side and/or drink)
});
export type ComboRule = z.infer<typeof ComboRuleSchema>;

export const MenuSchema = z.object({
  items: z.array(MenuItemSchema),
  combo: ComboRuleSchema,
  updatedAt: z.string(),
});
export type Menu = z.infer<typeof MenuSchema>;

export const CATEGORY_LABELS: Record<Category, string> = {
  BURGER: "Burgers",
  SIDE: "Sides",
  DRINK: "Drinks",
};
