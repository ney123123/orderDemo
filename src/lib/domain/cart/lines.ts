import { fail, ok, type Result } from "../errors";
import { alternativesText, comboSlotOptionsText, findVisibleItem, isBurger, isSized, sizeAvailable, sizeLabel } from "../menu/queries";
import type { Menu, MenuItem } from "../menu/schema";
import type { CartLine } from "./schema";

export type MissingField = "format" | "spicy" | "side" | "sideSize" | "drink" | "drinkSize" | "size";
export type LineStage = "COMPLETE" | "ITEM_CONFIG" | "COMBO_CONFIG";

const ITEM_FIELDS: MissingField[] = ["format", "spicy", "size"];

/** Fields the customer still has to choose, in the order they should be asked. */
export function missingFields(line: CartLine, item: MenuItem): MissingField[] {
  const missing: MissingField[] = [];
  if (isBurger(item)) {
    if (!line.format) missing.push("format");
    if (line.spicy === undefined) missing.push("spicy");
    if (line.format === "COMBO") {
      if (!line.sideId) missing.push("side");
      if (!line.sideSize) missing.push("sideSize");
      if (!line.drinkId) missing.push("drink");
      if (!line.drinkSize) missing.push("drinkSize");
    }
  } else if (!line.size) {
    missing.push("size");
  }
  return missing;
}

export function lineStage(line: CartLine, item: MenuItem): LineStage {
  const missing = missingFields(line, item);
  if (missing.length === 0) return "COMPLETE";
  return missing.some((f) => ITEM_FIELDS.includes(f)) ? "ITEM_CONFIG" : "COMBO_CONFIG";
}

/**
 * Checks a (possibly partial) line against the menu: ids exist, fields fit the item's
 * category, and everything chosen is currently orderable. Missing fields are fine here.
 */
export function validateLine(line: CartLine, menu: Menu): Result<MenuItem> {
  const item = findVisibleItem(menu, line.itemId);
  if (!item) return fail("UNKNOWN_ITEM", `"${line.itemId}" is not on the menu.`);
  if (item.availability === "SOLD_OUT") {
    return fail("ITEM_SOLD_OUT", `${item.name} is sold out. Available instead: ${alternativesText(menu, item.category, item.id)}.`);
  }

  if (isBurger(item)) {
    if (line.size) return fail("OPTION_NOT_ALLOWED", `A burger has no size; sizes apply to sides and drinks.`);
    const hasSlots = line.sideId || line.sideSize || line.drinkId || line.drinkSize;
    if (hasSlots && line.format !== "COMBO") {
      return fail("OPTION_NOT_ALLOWED", `A side or drink inside the burger line needs format COMBO. Order it as its own item instead, or make the burger a combo.`);
    }
    for (const slot of ["side", "drink"] as const) {
      const id = slot === "side" ? line.sideId : line.drinkId;
      const size = slot === "side" ? line.sideSize : line.drinkSize;
      const category = slot === "side" ? "SIDE" : "DRINK";
      if (!id) continue;
      const slotItem = findVisibleItem(menu, id);
      if (!slotItem || slotItem.category !== category) {
        return fail("UNKNOWN_ITEM", `"${id}" is not a ${slot} on the menu.`);
      }
      if (!isSized(slotItem)) continue;
      if (slotItem.availability === "SOLD_OUT") {
        return fail("OPTION_SOLD_OUT", `${slotItem.name} is sold out. Available ${slot}s for the combo: ${comboSlotOptionsText(menu, category)}.`);
      }
      if (size && !sizeAvailable(slotItem, size)) {
        return fail(
          "OPTION_SOLD_OUT",
          `${sizeLabel(size)} ${slotItem.name} is sold out. Available ${slot}s for the combo: ${comboSlotOptionsText(menu, category, { id: slotItem.id, size })}.`,
        );
      }
    }
    return ok(item);
  }

  if (line.format || line.spicy !== undefined || line.sideId || line.sideSize || line.drinkId || line.drinkSize) {
    return fail("OPTION_NOT_ALLOWED", `${item.name} on its own only takes a size and a quantity.`);
  }
  if (isSized(item) && line.size && !sizeAvailable(item, line.size)) {
    return fail("OPTION_SOLD_OUT", `${sizeLabel(line.size)} ${item.name} is sold out. Available instead: ${alternativesText(menu, item.category)}.`);
  }
  return ok(item);
}
