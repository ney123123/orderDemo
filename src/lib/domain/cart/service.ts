import { createHash } from "node:crypto";
import type { Repository } from "../../repositories/repository";
import { fail, ok, type DomainError, type Result } from "../errors";
import { formatCents } from "../money";
import { isBurger, isSized } from "../menu/queries";
import type { Menu } from "../menu/schema";
import type { Order, OrderLine } from "../order/schema";
import { priceCart } from "../pricing/priceLine";
import { openStatus } from "../settings/hours";
import type { RestaurantSettings } from "../settings/schema";
import { missingFields, validateLine } from "./lines";
import { emptyCart, MAX_LINES, type Cart, type CartLine } from "./schema";

export type LineOptions = Omit<CartLine, "lineId" | "itemId" | "quantity">;
export type NewLine = Omit<CartLine, "lineId">;

export interface LineChange {
  patch?: Partial<LineOptions>;
  quantity?: number;
  remove?: boolean;
  /** Move this many units to a new line (with `patch` applied to the new line only). */
  splitQuantity?: number;
}

export interface SubmitInput {
  reviewToken: string;
  customerName: string;
  pickupNote?: string;
}

export interface CartServiceDeps {
  repo: Repository;
  now?: () => Date;
  newOrderId?: () => string;
}

const COMBO_SLOT_FIELDS = ["sideId", "sideSize", "drinkId", "drinkSize"] as const;

/**
 * The single cart service used by the customer UI, the AI tools and (read-only) the admin API.
 * Every write bumps `version`, clears any review, and is a conditional write (no lost updates).
 */
export class CartService {
  private readonly repo: Repository;
  private readonly now: () => Date;
  private readonly newOrderId: () => string;

  constructor(deps: CartServiceDeps) {
    this.repo = deps.repo;
    this.now = deps.now ?? (() => new Date());
    this.newOrderId = deps.newOrderId ?? defaultOrderId;
  }

  async getCart(cartId: string): Promise<Cart> {
    return (await this.repo.getCart(cartId)) ?? emptyCart(cartId, this.now());
  }

  async addLine(cartId: string, input: NewLine): Promise<Result<{ cart: Cart; line: CartLine }>> {
    const [cart, menu] = await Promise.all([this.getCart(cartId), this.repo.getMenu()]);
    if (cart.orderId) return alreadySubmitted();
    if (cart.lines.length >= MAX_LINES) return fail("INVALID_INPUT", `A cart can hold at most ${MAX_LINES} lines.`);

    const line: CartLine = normalizeLine({ ...input, itemId: input.itemId.trim().toLowerCase(), lineId: `L${cart.nextLineNo}` });
    const valid = validateLine(line, menu);
    if (!valid.ok) return valid;

    const next = { ...cart, lines: [...cart.lines, line], nextLineNo: cart.nextLineNo + 1 };
    const saved = await this.save(cart, next);
    return saved.ok ? ok({ cart: saved.value, line }) : saved;
  }

  async updateLine(cartId: string, lineId: string, change: LineChange): Promise<Result<{ cart: Cart }>> {
    const [cart, menu] = await Promise.all([this.getCart(cartId), this.repo.getMenu()]);
    if (cart.orderId) return alreadySubmitted();
    const index = cart.lines.findIndex((l) => l.lineId === lineId.trim().toUpperCase());
    const current = cart.lines[index];
    if (!current) return fail("UNKNOWN_LINE", `There is no line "${lineId}" in the cart.`);

    let lines = [...cart.lines];
    let nextLineNo = cart.nextLineNo;
    if (change.remove) {
      lines.splice(index, 1);
    } else if (change.splitQuantity !== undefined) {
      if (change.splitQuantity < 1 || change.splitQuantity >= current.quantity) {
        return fail("INVALID_INPUT", `splitQuantity must be between 1 and ${current.quantity - 1} for line ${current.lineId}.`);
      }
      const rest: CartLine = { ...current, quantity: current.quantity - change.splitQuantity };
      const split = normalizeLine({ ...current, ...change.patch, quantity: change.splitQuantity, lineId: `L${nextLineNo++}` });
      for (const l of [rest, split]) {
        const valid = validateLine(l, menu);
        if (!valid.ok) return valid;
      }
      lines.splice(index, 1, rest, split);
    } else {
      if (!change.patch && change.quantity === undefined) return fail("INVALID_INPUT", "Nothing to change.");
      const updated = normalizeLine({ ...current, ...change.patch, quantity: change.quantity ?? current.quantity });
      const valid = validateLine(updated, menu);
      if (!valid.ok) return valid;
      lines[index] = updated;
    }

    const saved = await this.save(cart, { ...cart, lines, nextLineNo });
    return saved.ok ? ok({ cart: saved.value }) : saved;
  }

  /** The customer's "I'm done": checks and prices the cart, then issues a review token (→ CONFIRM). */
  async review(cartId: string): Promise<Result<{ cart: Cart; totalCents: number }>> {
    const [cart, menu, settings] = await Promise.all([this.getCart(cartId), this.repo.getMenu(), this.repo.getSettings()]);
    if (cart.orderId) return alreadySubmitted();
    const blocked = this.shopBlocked(settings);
    if (blocked) return { ok: false, error: blocked };
    const checked = checkOrderable(cart, menu);
    if (!checked.ok) return checked;

    const totalCents = priceCart(cart, menu).totalCents;
    return this.issueReview(cart, totalCents);
  }

  /** §9: high-integrity submit. Idempotent: a retry after success returns the same order. */
  async submit(cartId: string, input: SubmitInput): Promise<Result<{ order: Order; cart: Cart }>> {
    const cart = await this.getCart(cartId);
    if (cart.orderId) return this.existingOrder(cart);

    const customerName = input.customerName?.trim() ?? "";
    if (customerName.length < 1 || customerName.length > 40) {
      return fail("NAME_REQUIRED", "A name for the order (1–40 characters) is required before submitting.");
    }
    const pickupNote = input.pickupNote?.trim() || undefined;
    if (pickupNote && pickupNote.length > 200) return fail("INVALID_INPUT", "The pickup note can be at most 200 characters.");

    const [menu, settings] = await Promise.all([this.repo.getMenu(), this.repo.getSettings()]);
    const blocked = this.shopBlocked(settings);
    if (blocked) return { ok: false, error: blocked };

    const review = cart.review;
    if (!review || review.token !== input.reviewToken || review.cartVersion !== cart.version) {
      return fail("REVIEW_REQUIRED", "The order must be reviewed again before it can be submitted.");
    }

    const checked = checkOrderable(cart, menu);
    if (!checked.ok) {
      const cleared = await this.save(cart, { ...cart, review: undefined });
      if (!cleared.ok) return cleared;
      return fail("ITEM_UNAVAILABLE", `${checked.error.message} The order was not placed.`);
    }

    const pricing = priceCart(cart, menu);
    if (pricing.totalCents !== review.totalCents) {
      // The cart is still valid, so re-issue a review with the new total; the customer confirms again.
      const reissued = await this.issueReview(cart, pricing.totalCents);
      if (!reissued.ok) return reissued;
      return fail(
        "PRICE_CHANGED",
        `The total changed from ${formatCents(review.totalCents)} to ${formatCents(pricing.totalCents)}. The order was not placed; confirm the new total first.`,
      );
    }

    const order = buildOrder(cart, menu, settings, {
      id: this.newOrderId(),
      customerName,
      pickupNote,
      now: this.now(),
    });
    const committed = await this.repo.commitOrder(order, cart.id, cart.version);
    if (!committed.ok) {
      const latest = await this.getCart(cartId);
      return latest.orderId ? this.existingOrder(latest) : committed;
    }
    return ok({ order, cart: { ...cart, orderId: order.id } });
  }

  private async issueReview(cart: Cart, totalCents: number): Promise<Result<{ cart: Cart; totalCents: number }>> {
    const version = cart.version + 1;
    const token = createHash("sha256").update(`${cart.id}:${version}:${totalCents}`).digest("hex").slice(0, 16);
    const next: Cart = { ...cart, version, review: { token, totalCents, cartVersion: version }, updatedAt: this.now().toISOString() };
    const saved = await this.repo.putCart(next, expectedVersion(cart));
    return saved.ok ? ok({ cart: next, totalCents }) : saved;
  }

  private async existingOrder(cart: Cart): Promise<Result<{ order: Order; cart: Cart }>> {
    const order = cart.orderId ? await this.repo.getOrder(cart.orderId) : undefined;
    return order ? ok({ order, cart }) : fail("NOT_FOUND", "The submitted order could not be loaded.");
  }

  private shopBlocked(settings: RestaurantSettings): DomainError | undefined {
    const status = openStatus(settings, this.now());
    if (status.open) return undefined;
    return status.reason === "PAUSED"
      ? { code: "ORDERS_PAUSED", message: "The restaurant has paused new orders right now." }
      : { code: "SHOP_CLOSED", message: "The restaurant is closed for pickup orders right now." };
  }

  /** Writes a changed cart: bumps version, clears review, conditional on the version we read. */
  private async save(before: Cart, after: Cart): Promise<Result<Cart>> {
    const next: Cart = { ...after, version: before.version + 1, review: undefined, updatedAt: this.now().toISOString() };
    const saved = await this.repo.putCart(next, expectedVersion(before));
    return saved.ok ? ok(next) : saved;
  }
}

/** A cart that was never stored has version 0; every stored cart has version >= 1. */
const expectedVersion = (cart: Cart): number | null => (cart.version === 0 ? null : cart.version);

/** Drops combo-slot fields when a burger is not (or no longer) a combo. */
function normalizeLine(line: CartLine): CartLine {
  if (line.format === "COMBO") return line;
  if (line.format === "SINGLE") {
    const copy = { ...line };
    for (const f of COMBO_SLOT_FIELDS) delete copy[f];
    return copy;
  }
  return line;
}

function checkOrderable(cart: Cart, menu: Menu): Result<void> {
  if (cart.lines.length === 0) return fail("CART_EMPTY", "The cart is empty.");
  for (const line of cart.lines) {
    const valid = validateLine(line, menu);
    // Lines were valid when added; failing now means the menu changed (sold out, hidden, removed).
    if (!valid.ok) return fail("ITEM_UNAVAILABLE", `Line ${line.lineId}: ${valid.error.message}`);
    if (missingFields(line, valid.value).length > 0) return fail("CART_INCOMPLETE", `Line ${line.lineId} still needs options.`);
  }
  return ok(undefined);
}

function buildOrder(
  cart: Cart,
  menu: Menu,
  settings: RestaurantSettings,
  meta: { id: string; customerName: string; pickupNote?: string; now: Date },
): Order {
  const pricing = priceCart(cart, menu);
  const name = (id: string) => menu.items.find((i) => i.id === id)?.name ?? id;
  const lines: OrderLine[] = pricing.lines.map(({ line, price }) => {
    if (!price.priced) throw new Error(`Unpriced line ${line.lineId} reached buildOrder`);
    const item = menu.items.find((i) => i.id === line.itemId);
    if (!item) throw new Error(`Unknown item ${line.itemId} reached buildOrder`);
    const options: OrderLine["options"] = {};
    if (isBurger(item)) {
      options.format = line.format;
      options.spicy = line.spicy;
      if (line.format === "COMBO" && line.sideId && line.sideSize && line.drinkId && line.drinkSize) {
        options.side = { itemId: line.sideId, name: name(line.sideId), size: line.sideSize };
        options.drink = { itemId: line.drinkId, name: name(line.drinkId), size: line.drinkSize };
      }
    } else if (isSized(item)) {
      options.size = line.size;
    }
    return {
      itemId: item.id,
      itemName: item.name,
      description: price.description,
      options,
      quantity: line.quantity,
      unitCents: price.unitCents,
      lineCents: price.lineCents,
    };
  });
  const t = meta.now.toISOString();
  return {
    id: meta.id,
    cartId: cart.id,
    lines,
    totalCents: pricing.totalCents,
    customerName: meta.customerName,
    pickupNote: meta.pickupNote,
    pickupInfo: settings.pickupInfo,
    status: "PENDING",
    createdAt: t,
    updatedAt: t,
  };
}

const alreadySubmitted = () => fail("ALREADY_SUBMITTED", "This order was already placed; it can't be changed here.");

function defaultOrderId(): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return `PL-${[...bytes].map((b) => alphabet[b % alphabet.length]).join("")}`;
}
