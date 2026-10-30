import { lineStage, missingFields, type MissingField } from "../cart/lines";
import type { Cart, CartLine } from "../cart/schema";
import type { Menu, MenuItem } from "../menu/schema";

export const STATES = ["GENERAL", "ITEM_CONFIG", "COMBO_CONFIG", "CONFIRM", "SUBMITTED"] as const;
export type State = (typeof STATES)[number];

export type DerivedState =
  | { state: "GENERAL" | "CONFIRM" | "SUBMITTED" }
  | { state: "ITEM_CONFIG" | "COMBO_CONFIG"; line: CartLine; item: MenuItem; missing: MissingField[] };

/**
 * §5.2: the state is derived from the cart, never stored. One incomplete line at a time,
 * in cart order. A change after review clears `cart.review`, which drops CONFIRM by itself.
 */
export function deriveState(cart: Cart, menu: Menu): DerivedState {
  if (cart.orderId) return { state: "SUBMITTED" };
  for (const line of cart.lines) {
    const item = menu.items.find((i) => i.id === line.itemId);
    if (!item) continue; // unknown ids never enter a cart; a deleted item is caught at review
    const stage = lineStage(line, item);
    if (stage !== "COMPLETE") return { state: stage, line, item, missing: missingFields(line, item) };
  }
  if (cart.review) return { state: "CONFIRM" };
  return { state: "GENERAL" };
}
