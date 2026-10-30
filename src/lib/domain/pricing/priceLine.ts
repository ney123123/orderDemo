import { missingFields } from "../cart/lines";
import type { Cart, CartLine } from "../cart/schema";
import { formatCents, type Cents } from "../money";
import { findVisibleItem, isBurger, isSized, sizeLabel } from "../menu/queries";
import type { Menu } from "../menu/schema";

export type LinePrice =
  | { priced: true; unitCents: Cents; lineCents: Cents; description: string }
  | { priced: false; reason: "INCOMPLETE" | "UNKNOWN_ITEM"; description: string };

/**
 * The ONLY place prices are computed (§3). Customer UI, admin views, the prompt state block
 * and order snapshots all call this. Integer cents only.
 */
export function priceLine(line: CartLine, menu: Menu): LinePrice {
  const item = findVisibleItem(menu, line.itemId) ?? menu.items.find((i) => i.id === line.itemId);
  if (!item) return { priced: false, reason: "UNKNOWN_ITEM", description: line.itemId };
  const description = describeLine(line, menu);
  if (missingFields(line, item).length > 0) return { priced: false, reason: "INCOMPLETE", description };

  let unitCents: Cents;
  if (isBurger(item)) {
    unitCents = item.basePriceCents;
    if (line.format === "COMBO") {
      const larges = [line.sideSize, line.drinkSize].filter((s) => s === "LARGE").length;
      unitCents += menu.combo.baseFeeCents + menu.combo.largeUpgradeCents * larges;
    }
  } else if (isSized(item) && line.size) {
    unitCents = item.sizes[line.size].priceCents;
  } else {
    return { priced: false, reason: "INCOMPLETE", description };
  }
  return { priced: true, unitCents, lineCents: unitCents * line.quantity, description };
}

export function describeLine(line: CartLine, menu: Menu): string {
  const name = (id?: string) => (id ? (menu.items.find((i) => i.id === id)?.name ?? id) : "?");
  const item = menu.items.find((i) => i.id === line.itemId);
  const qty = `${line.quantity} × `;
  if (!item) return `${qty}${line.itemId}`;
  if (isBurger(item)) {
    const spicy = line.spicy === undefined ? "" : line.spicy ? ", spicy" : ", not spicy";
    if (line.format === "COMBO") {
      const slot = (label: string, id?: string, size?: CartLine["size"]) =>
        id ? `${size ? sizeLabel(size) + " " : ""}${name(id)}` : `${label} not chosen`;
      return `${qty}${item.name} combo${spicy} with ${slot("side", line.sideId, line.sideSize)} and ${slot("drink", line.drinkId, line.drinkSize)}`;
    }
    return `${qty}${item.name}${line.format === "SINGLE" ? " on its own" : ""}${spicy}`;
  }
  return `${qty}${line.size ? sizeLabel(line.size) + " " : ""}${item.name}`;
}

export interface CartPricing {
  lines: { line: CartLine; price: LinePrice }[];
  totalCents: Cents; // sum of priced lines only
  complete: boolean; // every line priced
}

export function priceCart(cart: Cart, menu: Menu): CartPricing {
  const lines = cart.lines.map((line) => ({ line, price: priceLine(line, menu) }));
  return {
    lines,
    totalCents: lines.reduce((sum, l) => sum + (l.price.priced ? l.price.lineCents : 0), 0),
    complete: lines.every((l) => l.price.priced),
  };
}

export const priceText = (p: LinePrice): string =>
  p.priced ? `${formatCents(p.lineCents)}${p.lineCents !== p.unitCents ? ` (${formatCents(p.unitCents)} each)` : ""}` : "price after options are chosen";
