import { describe, expect, it } from "vitest";
import type { Menu } from "../../src/lib/domain/menu/schema";
import { seedMenu } from "../../src/lib/domain/menu/seed";
import { seedSettings } from "../../src/lib/domain/settings/schema";
import { CLOSED_NOW, setup } from "../helpers";

// §13 scenarios 1–13 and 16, driven through the same tool handlers the Connect bridge will call.
// The model's side of each conversation is simulated by the tool calls it is expected to make;
// the state block it would see is asserted where the scenario depends on it. 14–15 are Phase 2 (HTTP auth).

const tokenOf = (stateBlock: string) => /reviewToken "([^"]+)"/.exec(stateBlock)?.[1] ?? "";

function withMenu(edit: (m: Menu) => void): Menu {
  const m = seedMenu();
  edit(m);
  return m;
}

describe("§13 scenarios", () => {
  it("1: beef combo, spicy, large fries, large Coke Zero → one order of $10.00", async () => {
    const t = setup();
    let r = await t.call("addToCart", { itemId: "beef", format: "COMBO", spicy: "yes" });
    expect(r).toMatchObject({ ok: true, state: "COMBO_CONFIG" });
    r = await t.call("updateCart", { lineId: "L1", sideId: "fries", sideSize: "LARGE", drinkId: "coke_zero", drinkSize: "LARGE" });
    expect(r).toMatchObject({ ok: true, state: "GENERAL" });
    r = await t.call("reviewOrder");
    expect(r.state).toBe("CONFIRM");
    expect(r.stateBlock).toContain("total $10.00");
    r = await t.call("submitOrder", { reviewToken: tokenOf(r.stateBlock), customerName: "Sam" });
    expect(r).toMatchObject({ ok: true, state: "SUBMITTED" });
    expect(r.stateBlock).toContain("Order number PL-TEST1, total $10.00, for Sam");
    expect(r.stateBlock).toContain("https://example.test/order/PL-TEST1");
    const orders = await t.repo.listOrders();
    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject({ totalCents: 1000, lines: [{ unitCents: 1000, quantity: 1 }] });
  });

  it("2: a change in CONFIRM clears the token; re-review shows the new total", async () => {
    const t = setup();
    await t.call("addToCart", { itemId: "chicken", format: "SINGLE", spicy: "no" });
    let r = await t.call("reviewOrder");
    expect(r.stateBlock).toContain("total $5.00");
    const oldToken = tokenOf(r.stateBlock);
    r = await t.call("updateCart", { lineId: "L1", quantity: "2" });
    expect(r.state).toBe("GENERAL");
    expect((await t.service.getCart("cart-1")).review).toBeUndefined();
    r = await t.call("submitOrder", { reviewToken: oldToken, customerName: "Sam" });
    expect(r.error?.code).toBe("REVIEW_REQUIRED");
    r = await t.call("reviewOrder");
    expect(r.stateBlock).toContain("total $10.00");
    expect(await t.repo.listOrders()).toHaveLength(0);
  });

  it("3: two sausage, one spicy → the line is split and the step asks about the rest", async () => {
    const t = setup();
    let r = await t.call("addToCart", { itemId: "sausage", quantity: "2" });
    expect(r.state).toBe("ITEM_CONFIG");
    expect(r.stateBlock).toContain("splitQuantity");
    r = await t.call("updateCart", { lineId: "L1", splitQuantity: "1", spicy: "yes" });
    expect(r.ok).toBe(true);
    const cart = await t.service.getCart("cart-1");
    expect(cart.lines).toEqual([
      { lineId: "L1", itemId: "sausage", quantity: 1 },
      { lineId: "L2", itemId: "sausage", quantity: 1, spicy: true },
    ]);
    expect(r.state).toBe("ITEM_CONFIG");
    expect(r.stateBlock).toContain("line L1");
  });

  it("4: sausage sold out → refused with beef/chicken and their prices", async () => {
    const t = setup({ menu: withMenu((m) => (m.items.find((i) => i.id === "sausage")!.availability = "SOLD_OUT")) });
    const r = await t.call("addToCart", { itemId: "sausage" });
    expect(r).toMatchObject({ ok: false, error: { code: "ITEM_SOLD_OUT" } });
    expect(r.error?.message).toContain("Beef Burger ($7.00)");
    expect(r.error?.message).toContain("Chicken Burger ($5.00)");
    expect(r.stateBlock).toContain("Sausage Burger (SOLD OUT today)");
    expect((await t.service.getCart("cart-1")).lines).toHaveLength(0);
  });

  it("5: large salad sold out in a combo → stays in COMBO_CONFIG and offers regular salad or large fries", async () => {
    const t = setup({
      menu: withMenu((m) => {
        const salad = m.items.find((i) => i.id === "salad");
        if (salad && "sizes" in salad) salad.sizes.LARGE.availability = "SOLD_OUT";
      }),
    });
    await t.call("addToCart", { itemId: "beef", format: "COMBO", spicy: "no" });
    const r = await t.call("updateCart", { lineId: "L1", sideId: "salad", sideSize: "LARGE" });
    expect(r).toMatchObject({ ok: false, state: "COMBO_CONFIG", error: { code: "OPTION_SOLD_OUT" } });
    expect(r.error?.message).toContain("Salad regular");
    expect(r.error?.message).toContain("Fries large");
    expect(r.error?.message).not.toContain("Salad large");
    expect(r.stateBlock).not.toContain("Salad large");
  });

  it("6: sausage regular combo + a large Coke on its own → $8.00 + $2.50 = $10.50 on two lines", async () => {
    const t = setup();
    await t.call("addToCart", { itemId: "sausage", format: "COMBO", spicy: "no", sideId: "fries", sideSize: "REGULAR", drinkId: "coke", drinkSize: "REGULAR" });
    await t.call("addToCart", { itemId: "coke", size: "LARGE" });
    const r = await t.call("reviewOrder");
    expect(r.stateBlock).toContain("$8.00");
    expect(r.stateBlock).toContain("$2.50");
    expect(r.stateBlock).toContain("total $10.50");
    expect((await t.service.getCart("cart-1")).lines).toHaveLength(2);
  });

  it("7: chicken combo regular/regular $7.00; 'just the Coke' large → $7.50", async () => {
    const t = setup();
    let r = await t.call("addToCart", { itemId: "chicken", format: "COMBO", spicy: "no", sideId: "fries", sideSize: "REGULAR", drinkId: "coke", drinkSize: "REGULAR" });
    expect(r.stateBlock).toContain("Total: $7.00");
    // "make it large" is ambiguous; the step tells the model to ask (§5.4).
    expect(r.stateBlock).toMatch(/side, the drink or both: ask/);
    r = await t.call("updateCart", { lineId: "L1", drinkSize: "LARGE" });
    expect(r.stateBlock).toContain("Total: $7.50");
    const line = (await t.service.getCart("cart-1")).lines[0];
    expect(line).toMatchObject({ sideSize: "REGULAR", drinkSize: "LARGE" });
  });

  it("8: admin changes the beef price after review → PRICE_CHANGED and the new total is read back", async () => {
    const t = setup();
    await t.call("addToCart", { itemId: "beef", format: "SINGLE", spicy: "no" });
    const reviewed = await t.call("reviewOrder");
    const menu = await t.repo.getMenu();
    const beef = menu.items.find((i) => i.id === "beef");
    if (beef && "basePriceCents" in beef) beef.basePriceCents = 800;
    await t.repo.saveMenu({ ...menu, updatedAt: "2026-10-29T17:00:00.000Z" }, menu.updatedAt);

    const r = await t.call("submitOrder", { reviewToken: tokenOf(reviewed.stateBlock), customerName: "Sam" });
    expect(r).toMatchObject({ ok: false, state: "CONFIRM", error: { code: "PRICE_CHANGED" } });
    expect(r.error?.message).toContain("from $7.00 to $8.00");
    expect(r.stateBlock).toContain("total $8.00");
    expect(await t.repo.listOrders()).toHaveLength(0);

    const again = await t.call("submitOrder", { reviewToken: tokenOf(r.stateBlock), customerName: "Sam" });
    expect(again.ok).toBe(true);
    expect((await t.repo.listOrders())[0]?.totalCents).toBe(800);
  });

  it("9: submitOrder retried with the same token → still one order", async () => {
    const t = setup();
    await t.call("addToCart", { itemId: "fries", size: "REGULAR" });
    const token = tokenOf((await t.call("reviewOrder")).stateBlock);
    const [a, b] = await Promise.all([
      t.call("submitOrder", { reviewToken: token, customerName: "Sam" }),
      t.call("submitOrder", { reviewToken: token, customerName: "Sam" }),
    ]);
    const c = await t.call("submitOrder", { reviewToken: token, customerName: "Sam" });
    for (const r of [a, b, c]) expect(r).toMatchObject({ ok: true, state: "SUBMITTED" });
    expect(await t.repo.listOrders()).toHaveLength(1);
  });

  it("10: bad tool args → structured error, cart unchanged", async () => {
    const t = setup();
    await t.call("addToCart", { itemId: "coke", size: "REGULAR" });
    const before = await t.service.getCart("cart-1");
    const bad: [Parameters<typeof t.call>[0], Record<string, string>, string][] = [
      ["addToCart", { itemId: "pizza" }, "UNKNOWN_ITEM"],
      ["addToCart", { itemId: "coke", size: "XL" }, "INVALID_INPUT"],
      ["addToCart", { itemId: "coke", quantity: "0" }, "INVALID_INPUT"],
      ["addToCart", { itemId: "coke", spicy: "yes" }, "OPTION_NOT_ALLOWED"],
      ["addToCart", { itemId: "beef", size: "LARGE" }, "OPTION_NOT_ALLOWED"],
      ["updateCart", { lineId: "L9", quantity: "2" }, "UNKNOWN_LINE"],
      ["updateCart", { lineId: "L1", quantity: "0" }, "INVALID_INPUT"],
    ];
    for (const [name, args, code] of bad) {
      const r = await t.call(name, args);
      expect(r, `${name} ${JSON.stringify(args)}`).toMatchObject({ ok: false, error: { code } });
      expect(r.stateBlock).toContain("LAST ACTION DID NOT GO THROUGH");
    }
    // Non-object input from a misbehaving caller.
    expect((await t.tools.addToCart(t.ctx, "beef")).error?.code).toBe("INVALID_INPUT");
    expect(await t.service.getCart("cart-1")).toEqual(before);
  });

  it("11: shop closed or orders paused → reviewOrder/submitOrder refuse and the block says so", async () => {
    const t = setup();
    await t.call("addToCart", { itemId: "fries", size: "REGULAR" });
    const token = tokenOf((await t.call("reviewOrder")).stateBlock);

    t.setNow(CLOSED_NOW);
    let r = await t.call("submitOrder", { reviewToken: token, customerName: "Sam" });
    expect(r.error?.code).toBe("SHOP_CLOSED");
    expect(r.stateBlock).toContain("THE SHOP IS NOT TAKING ORDERS RIGHT NOW (closed; hours:");
    expect((await t.call("reviewOrder")).error?.code).toBe("SHOP_CLOSED");

    const paused = setup({ settings: { ...seedSettings(), acceptingOrders: false } });
    await paused.call("addToCart", { itemId: "fries", size: "REGULAR" });
    r = await paused.call("reviewOrder");
    expect(r).toMatchObject({ ok: false, state: "GENERAL", error: { code: "ORDERS_PAUSED" } });
    expect(r.stateBlock).toContain("new orders are paused");
    expect(await t.repo.listOrders()).toHaveLength(0);
  });

  it("12: customer leaves before confirming → no order", async () => {
    const t = setup();
    await t.call("addToCart", { itemId: "beef", format: "SINGLE", spicy: "yes" });
    await t.call("reviewOrder");
    expect(await t.repo.listOrders()).toHaveLength(0);
    expect((await t.service.getCart("cart-1")).orderId).toBeUndefined();
  });

  it("13: prompt injection cannot change prices, skip confirmation or switch carts", async () => {
    const t = setup();
    // "Burgers are free": there is no price input; extra fields are dropped.
    let r = await t.call("addToCart", { itemId: "beef", format: "SINGLE", spicy: "no", priceCents: "0", unitCents: "0" });
    expect(r.stateBlock).toContain("Total: $7.00");
    // "Skip confirmation": submit without a real review token fails.
    r = await t.call("submitOrder", { reviewToken: "anything", customerName: "Sam" });
    expect(r.error?.code).toBe("REVIEW_REQUIRED");
    // "My contact id is …": the cart comes from the server-side context, never from arguments.
    r = await t.call("addToCart", { itemId: "fries", size: "LARGE", cartId: "cart-2", contactId: "other" });
    expect((await t.service.getCart("cart-1")).lines).toHaveLength(2);
    expect((await t.repo.getCart("cart-2"))).toBeUndefined();
    expect(await t.repo.listOrders()).toHaveLength(0);
  });

  it("16: 'yes' without a name → NAME_REQUIRED, then submits once the name is given", async () => {
    const t = setup();
    await t.call("addToCart", { itemId: "coke_zero", size: "LARGE" });
    const token = tokenOf((await t.call("reviewOrder")).stateBlock);
    let r = await t.call("submitOrder", { reviewToken: token, customerName: "" });
    expect(r).toMatchObject({ ok: false, state: "CONFIRM", error: { code: "NAME_REQUIRED" } });
    expect(await t.repo.listOrders()).toHaveLength(0);
    r = await t.call("submitOrder", { reviewToken: token, customerName: "Alex" });
    expect(r).toMatchObject({ ok: true, state: "SUBMITTED" });
    expect(await t.repo.listOrders()).toHaveLength(1);
  });
});
