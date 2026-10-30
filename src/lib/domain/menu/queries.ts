import { formatCents } from "../money";
import type { BurgerItem, Category, Menu, MenuItem, Size, SizedItem } from "./schema";
import { SIZES } from "./schema";

// Customer-facing lookups. HIDDEN items behave as if they do not exist.

export function findVisibleItem(menu: Menu, id: string): MenuItem | undefined {
  const item = menu.items.find((i) => i.id === id.trim().toLowerCase());
  return item && item.availability !== "HIDDEN" ? item : undefined;
}

export function isBurger(item: MenuItem): item is BurgerItem {
  return item.category === "BURGER";
}

export function isSized(item: MenuItem): item is SizedItem {
  return item.category === "SIDE" || item.category === "DRINK";
}

export function sizeAvailable(item: SizedItem, size: Size): boolean {
  return item.availability === "AVAILABLE" && item.sizes[size].availability === "AVAILABLE";
}

export function availableSizes(item: SizedItem): Size[] {
  return SIZES.filter((s) => sizeAvailable(item, s));
}

export function orderableItems(menu: Menu, category: Category): MenuItem[] {
  return menu.items.filter((i) => {
    if (i.category !== category || i.availability !== "AVAILABLE") return false;
    return isSized(i) ? availableSizes(i).length > 0 : true;
  });
}

export const sizeLabel = (size: Size): string => (size === "LARGE" ? "large" : "regular");

/** Alternatives in the same category, with backend prices, for "sold out" replies. */
export function alternativesText(menu: Menu, category: Category, excludeId?: string): string {
  const items = orderableItems(menu, category).filter((i) => i.id !== excludeId);
  if (items.length === 0) return "nothing else in that category is available right now";
  return items
    .map((i) =>
      isBurger(i)
        ? `${i.name} (${formatCents(i.basePriceCents)})`
        : `${i.name} (${availableSizes(i)
            .map((s) => `${sizeLabel(s)} ${formatCents(i.sizes[s].priceCents)}`)
            .join(", ")})`,
    )
    .join("; ");
}

/** Available (item, size) pairs for a combo slot, e.g. "Salad regular; Fries large". */
export function comboSlotOptionsText(menu: Menu, category: "SIDE" | "DRINK", exclude?: { id: string; size: Size }): string {
  const pairs: string[] = [];
  for (const item of orderableItems(menu, category)) {
    if (!isSized(item)) continue;
    for (const size of availableSizes(item)) {
      if (exclude && exclude.id === item.id && exclude.size === size) continue;
      pairs.push(`${item.name} ${sizeLabel(size)} (id ${item.id}, size ${size})`);
    }
  }
  return pairs.length ? pairs.join("; ") : "none available";
}
