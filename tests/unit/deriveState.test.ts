import { describe, expect, it } from "vitest";
import { emptyCart, type Cart, type CartLine } from "../../src/lib/domain/cart/schema";
import { seedMenu } from "../../src/lib/domain/menu/seed";
import { deriveState } from "../../src/lib/domain/stateMachine/deriveState";

const menu = seedMenu();
const cart = (lines: Omit<CartLine, "lineId" | "quantity">[], extra: Partial<Cart> = {}): Cart => ({
  ...emptyCart("c", new Date(0)),
  lines: lines.map((l, i) => ({ lineId: `L${i + 1}`, quantity: 1, ...l })),
  ...extra,
});

describe("deriveState", () => {
  it("is GENERAL for an empty cart", () => {
    expect(deriveState(cart([]), menu).state).toBe("GENERAL");
  });

  it("asks item fields before combo slots", () => {
    const s = deriveState(cart([{ itemId: "beef", format: "COMBO" }]), menu);
    expect(s).toMatchObject({ state: "ITEM_CONFIG", missing: ["spicy", "side", "sideSize", "drink", "drinkSize"] });
  });

  it("is COMBO_CONFIG once only slots are missing", () => {
    const s = deriveState(cart([{ itemId: "beef", format: "COMBO", spicy: true, sideId: "fries", sideSize: "LARGE" }]), menu);
    expect(s).toMatchObject({ state: "COMBO_CONFIG", missing: ["drink", "drinkSize"] });
  });

  it("works through incomplete lines in cart order", () => {
    const s = deriveState(cart([{ itemId: "coke", size: "LARGE" }, { itemId: "fries" }, { itemId: "beef" }]), menu);
    expect(s).toMatchObject({ state: "ITEM_CONFIG", line: { lineId: "L2" } });
  });

  it("is CONFIRM only with a review, and SUBMITTED once ordered", () => {
    const done = [{ itemId: "coke", size: "LARGE" as const }];
    expect(deriveState(cart(done), menu).state).toBe("GENERAL");
    expect(deriveState(cart(done, { review: { token: "t", totalCents: 250, cartVersion: 1 } }), menu).state).toBe("CONFIRM");
    expect(deriveState(cart(done, { orderId: "PL-1" }), menu).state).toBe("SUBMITTED");
  });
});
