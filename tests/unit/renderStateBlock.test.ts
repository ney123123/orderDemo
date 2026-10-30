import { describe, expect, it } from "vitest";
import { emptyCart } from "../../src/lib/domain/cart/schema";
import { seedMenu } from "../../src/lib/domain/menu/seed";
import { seedSettings } from "../../src/lib/domain/settings/schema";
import { fill, renderStateBlock } from "../../src/lib/domain/stateBlock/renderStateBlock";
import { loadStateTemplates } from "../../src/lib/prompts/loadStateTemplates";
import { OPEN_NOW } from "../helpers";

const base = { menu: seedMenu(), settings: seedSettings(), now: OPEN_NOW, templates: loadStateTemplates(), statusUrlBase: "https://x.test" };

describe("renderStateBlock", () => {
  it("renders GENERAL with the backend menu and combo prices", () => {
    const { state, text } = renderStateBlock({ ...base, cart: emptyCart("c", OPEN_NOW) });
    expect(state).toBe("GENERAL");
    expect(text).toMatch(/^STEP: GENERAL\n/);
    expect(text).toContain("Beef Burger (id beef) $7.00");
    expect(text).toContain("Coke Zero (id coke_zero) regular $1.50, large $2.50");
    expect(text).toContain("plus $2.00 with both regular, plus $2.50 with one large, plus $3.00 with both large");
    expect(text).not.toMatch(/\{\{\w+\}\}/);
  });

  it("only offers sizes that are available", () => {
    const menu = seedMenu();
    const coke = menu.items.find((i) => i.id === "coke");
    if (coke && "sizes" in coke) coke.sizes.LARGE.availability = "SOLD_OUT";
    const cart = { ...emptyCart("c", OPEN_NOW), lines: [{ lineId: "L1", itemId: "coke", quantity: 1 }] };
    const { text } = renderStateBlock({ ...base, menu, cart });
    expect(text).toContain('"Only regular ($1.50) is available today. Is that OK?"');
  });

  it("fill throws on a placeholder without a value (template bug)", () => {
    expect(() => fill("a {{b}}", {})).toThrow("{{b}}");
  });
});
