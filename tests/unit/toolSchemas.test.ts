import { describe, expect, it } from "vitest";
import { AddToCartInput, SubmitOrderInput, UpdateCartInput } from "../../src/lib/domain/tools/schemas";

describe("tool input schemas (string-only, from Connect)", () => {
  it("converts strings and treats blanks as not given", () => {
    const r = AddToCartInput.parse({ itemId: " Beef ", quantity: "2", format: "combo", spicy: "Yes", sideId: "", size: " " });
    expect(r).toEqual({ itemId: "Beef", quantity: 2, format: "COMBO", spicy: true });
  });

  it("accepts a bare item id", () => {
    expect(AddToCartInput.parse({ itemId: "fries" })).toEqual({ itemId: "fries" });
  });

  it.each([
    [{ itemId: "coke", size: "XL" }, "size"],
    [{ itemId: "coke", quantity: "0" }, "quantity"],
    [{ itemId: "coke", quantity: "two" }, "quantity"],
    [{ itemId: "coke", quantity: "21" }, "quantity"],
    [{ itemId: "beef", spicy: "maybe" }, "spicy"],
    [{}, "itemId"],
  ])("rejects %j", (input, field) => {
    const r = AddToCartInput.safeParse(input);
    expect(r.success).toBe(false);
    expect(r.error?.issues.map((i) => i.path[0])).toContain(field);
  });

  it("parses update and submit inputs", () => {
    expect(UpdateCartInput.parse({ lineId: "L1", remove: "true" })).toEqual({ lineId: "L1", remove: true });
    expect(SubmitOrderInput.parse({ reviewToken: "abc", customerName: "" })).toEqual({ reviewToken: "abc" });
    expect(SubmitOrderInput.safeParse({ customerName: "Sam" }).success).toBe(false);
  });

  it("drops fields that no tool accepts (prices, ids)", () => {
    const r = AddToCartInput.parse({ itemId: "beef", priceCents: "0", contactId: "someone-else", cartId: "x" });
    expect(r).toEqual({ itemId: "beef" });
  });
});
