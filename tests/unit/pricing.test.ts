import { describe, expect, it } from "vitest";
import type { CartLine } from "../../src/lib/domain/cart/schema";
import { seedMenu } from "../../src/lib/domain/menu/seed";
import { priceLine } from "../../src/lib/domain/pricing/priceLine";

const menu = seedMenu();
const line = (l: Partial<CartLine> & { itemId: string }): CartLine => ({ lineId: "L1", quantity: 1, ...l });
const cents = (l: CartLine) => {
  const p = priceLine(l, menu);
  return p.priced ? p.lineCents : null;
};

describe("priceLine", () => {
  it("prices a single burger at its base price", () => {
    expect(cents(line({ itemId: "beef", format: "SINGLE", spicy: false }))).toBe(700);
  });

  it("adds the combo fee and $0.50 per large slot", () => {
    const combo = { itemId: "chicken", format: "COMBO" as const, spicy: true, sideId: "fries", drinkId: "coke" };
    expect(cents(line({ ...combo, sideSize: "REGULAR", drinkSize: "REGULAR" }))).toBe(700);
    expect(cents(line({ ...combo, sideSize: "LARGE", drinkSize: "REGULAR" }))).toBe(750);
    expect(cents(line({ ...combo, sideSize: "LARGE", drinkSize: "LARGE" }))).toBe(800);
  });

  it("prices sides and drinks by size and multiplies by quantity", () => {
    expect(cents(line({ itemId: "coke", size: "LARGE", quantity: 3 }))).toBe(750);
    expect(cents(line({ itemId: "fries", size: "REGULAR" }))).toBe(150);
  });

  it("does not price incomplete or unknown lines", () => {
    expect(priceLine(line({ itemId: "beef" }), menu)).toMatchObject({ priced: false, reason: "INCOMPLETE" });
    expect(priceLine(line({ itemId: "beef", format: "COMBO", spicy: false }), menu)).toMatchObject({ priced: false });
    expect(priceLine(line({ itemId: "pizza" }), menu)).toMatchObject({ priced: false, reason: "UNKNOWN_ITEM" });
  });
});
