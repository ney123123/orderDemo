import { missingFields } from "../domain/cart/lines";
import type { Cart } from "../domain/cart/schema";
import type { Menu } from "../domain/menu/schema";
import type { Order } from "../domain/order/schema";
import { priceCart, priceText } from "../domain/pricing/priceLine";
import { deriveState } from "../domain/stateMachine/deriveState";

/** What the cart panel shows. Prices come from priceLine; the cart id itself is never sent to the browser. */
export function cartView(cart: Cart, menu: Menu) {
  const pricing = priceCart(cart, menu);
  return {
    version: cart.version,
    state: deriveState(cart, menu).state,
    lines: pricing.lines.map(({ line, price }) => {
      const item = menu.items.find((i) => i.id === line.itemId);
      return {
        lineId: line.lineId,
        itemId: line.itemId,
        quantity: line.quantity,
        description: price.description,
        priceText: priceText(price),
        lineCents: price.priced ? price.lineCents : null,
        missing: item ? missingFields(line, item) : [],
      };
    }),
    totalCents: pricing.totalCents,
    complete: pricing.complete,
    review: cart.review ? { token: cart.review.token, totalCents: cart.review.totalCents } : null,
    orderId: cart.orderId ?? null,
  };
}
export type CartView = ReturnType<typeof cartView>;

/** Menu for customers: hidden items and hidden sizes are removed. */
export function publicMenu(menu: Menu) {
  return {
    combo: menu.combo,
    items: menu.items
      .filter((i) => i.availability !== "HIDDEN")
      .map((i) => {
        const { createdAt: _c, updatedAt: _u, ...rest } = i;
        if (rest.category === "BURGER") return rest;
        const sizes = Object.fromEntries(Object.entries(rest.sizes).filter(([, s]) => s.availability !== "HIDDEN"));
        return { ...rest, sizes };
      }),
  };
}
export type PublicMenu = ReturnType<typeof publicMenu>;

/** Order status for the customer who placed it (no cart id). */
export function orderView(order: Order) {
  return {
    id: order.id,
    status: order.status,
    lines: order.lines.map((l) => ({ description: l.description, quantity: l.quantity, lineCents: l.lineCents })),
    totalCents: order.totalCents,
    customerName: order.customerName,
    pickupNote: order.pickupNote ?? null,
    pickupInfo: order.pickupInfo,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  };
}
export type OrderView = ReturnType<typeof orderView>;
