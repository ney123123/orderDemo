import type { MissingField } from "../cart/lines";
import type { Cart } from "../cart/schema";
import type { DomainError } from "../errors";
import { formatCents } from "../money";
import { availableSizes, comboSlotOptionsText, isBurger, isSized, sizeLabel } from "../menu/queries";
import type { Category, Menu, MenuItem } from "../menu/schema";
import { CATEGORY_LABELS } from "../menu/schema";
import type { Order } from "../order/schema";
import { priceCart, priceText } from "../pricing/priceLine";
import { hoursText, openStatus } from "../settings/hours";
import type { RestaurantSettings } from "../settings/schema";
import { deriveState, type State } from "../stateMachine/deriveState";

/** Template text per state plus the shared header, loaded from prompts/states/*.md. */
export type StateTemplates = Record<State | "_header", string>;

export interface StateBlockInput {
  cart: Cart;
  menu: Menu;
  settings: RestaurantSettings;
  now: Date;
  templates: StateTemplates;
  /** Outcome of the tool call that produced this block, if it failed. */
  notice?: DomainError;
  /** The placed order, when the cart has one. */
  order?: Order;
  statusUrlBase: string;
}

/** §5.2: the one function that turns cart + menu into the instruction the model sees for the current step. */
export function renderStateBlock(input: StateBlockInput): { state: State; text: string } {
  const { cart, menu, settings, templates } = input;
  const derived = deriveState(cart, menu);
  const pricing = priceCart(cart, menu);
  const shop = openStatus(settings, input.now);

  const header = fill(templates._header, {
    state: derived.state,
    restaurant: settings.name,
    shopNotice: shop.open
      ? ""
      : `THE SHOP IS NOT TAKING ORDERS RIGHT NOW (${shopReason(shop.reason, settings)}). Say this first. You can still answer menu questions, but do not call reviewOrder or submitOrder.\n`,
    notice: input.notice
      ? `LAST ACTION DID NOT GO THROUGH (${input.notice.code}): ${input.notice.message} Explain this to the customer in plain words.\n`
      : "",
    cart: cartText(cart, menu),
  });

  let body: string;
  switch (derived.state) {
    case "GENERAL": {
      const fee = menu.combo.baseFeeCents;
      const up = menu.combo.largeUpgradeCents;
      body = fill(templates.GENERAL, {
        menu: menuText(menu),
        comboFee: formatCents(fee),
        comboFeeOneLarge: formatCents(fee + up),
        comboFeeTwoLarge: formatCents(fee + 2 * up),
      });
      break;
    }
    case "ITEM_CONFIG":
      body = fill(templates.ITEM_CONFIG, {
        lineId: derived.line.lineId,
        line: describe(pricing, derived.line.lineId),
        missing: derived.missing.map(fieldLabel).join(", "),
        question: questions(derived.item, derived.missing, menu),
        patchHint: derived.missing.map(patchHint).join(", "),
      });
      break;
    case "COMBO_CONFIG":
      body = fill(templates.COMBO_CONFIG, {
        lineId: derived.line.lineId,
        line: describe(pricing, derived.line.lineId),
        missing: derived.missing.map(fieldLabel).join(", "),
        sideOptions: comboSlotOptionsText(menu, "SIDE"),
        drinkOptions: comboSlotOptionsText(menu, "DRINK"),
        largeUpgrade: formatCents(menu.combo.largeUpgradeCents),
      });
      break;
    case "CONFIRM":
      body = fill(templates.CONFIRM, {
        total: formatCents(cart.review?.totalCents ?? pricing.totalCents),
        reviewToken: cart.review?.token ?? "",
      });
      break;
    case "SUBMITTED": {
      const orderId = input.order?.id ?? cart.orderId ?? "";
      body = fill(templates.SUBMITTED, {
        orderId,
        total: formatCents(input.order?.totalCents ?? pricing.totalCents),
        customerName: input.order?.customerName ?? "the customer",
        statusUrl: `${input.statusUrlBase.replace(/\/$/, "")}/order/${orderId}`,
        pickupInfo: settings.pickupInfo,
      });
      break;
    }
  }
  return { state: derived.state, text: `${header.trimEnd()}\n\n${body.trimEnd()}\n` };
}

function shopReason(reason: "PAUSED" | "CLOSED" | "NO_PICKUP", settings: RestaurantSettings): string {
  if (reason === "PAUSED") return "new orders are paused";
  if (reason === "NO_PICKUP") return "pickup is not available right now";
  return `closed; hours: ${hoursText(settings)}`;
}

function cartText(cart: Cart, menu: Menu): string {
  if (cart.lines.length === 0) return "(empty)";
  const pricing = priceCart(cart, menu);
  const rows = pricing.lines.map(({ line, price }) => `- ${line.lineId}: ${price.description} | ${priceText(price)}`);
  rows.push(pricing.complete ? `Total: ${formatCents(pricing.totalCents)}` : `Total so far (finished lines only): ${formatCents(pricing.totalCents)}`);
  return rows.join("\n");
}

function menuText(menu: Menu): string {
  const categories: Category[] = ["BURGER", "SIDE", "DRINK"];
  return categories
    .map((category) => {
      const visible = menu.items.filter((i) => i.category === category && i.availability !== "HIDDEN");
      const parts = visible.map((i) => itemText(i));
      return `${CATEGORY_LABELS[category]}: ${parts.join("; ") || "none"}`;
    })
    .join("\n");
}

function itemText(item: MenuItem): string {
  if (item.availability === "SOLD_OUT") return `${item.name} (SOLD OUT today)`;
  if (isBurger(item)) return `${item.name} (id ${item.id}) ${formatCents(item.basePriceCents)}, spicy or not spicy`;
  const sizes = availableSizes(item);
  if (sizes.length === 0) return `${item.name} (SOLD OUT today)`;
  const soldOut = (["REGULAR", "LARGE"] as const).filter((s) => !sizes.includes(s));
  return `${item.name} (id ${item.id}) ${sizes.map((s) => `${sizeLabel(s)} ${formatCents(item.sizes[s].priceCents)}`).join(", ")}${
    soldOut.length ? ` (${soldOut.map(sizeLabel).join(", ")} sold out)` : ""
  }`;
}

function describe(pricing: ReturnType<typeof priceCart>, lineId: string): string {
  return pricing.lines.find((l) => l.line.lineId === lineId)?.price.description ?? lineId;
}

const FIELD_LABELS: Record<MissingField, string> = {
  format: "on its own or as a combo",
  spicy: "spicy or not",
  size: "size",
  side: "which side",
  sideSize: "side size",
  drink: "which drink",
  drinkSize: "drink size",
};
const fieldLabel = (f: MissingField) => FIELD_LABELS[f];

const PATCH_HINTS: Record<MissingField, string> = {
  format: 'format "SINGLE" or "COMBO"',
  spicy: 'spicy "yes" or "no"',
  size: 'size "REGULAR" or "LARGE"',
  side: "sideId",
  sideSize: 'sideSize "REGULAR" or "LARGE"',
  drink: "drinkId",
  drinkSize: 'drinkSize "REGULAR" or "LARGE"',
};
const patchHint = (f: MissingField) => PATCH_HINTS[f];

function questions(item: MenuItem, missing: MissingField[], menu: Menu): string {
  const qs: string[] = [];
  if (missing.includes("format") && isBurger(item)) {
    qs.push(`"On its own (${formatCents(item.basePriceCents)}), or as a combo with a side and a drink (from +${formatCents(menu.combo.baseFeeCents)})?"`);
  }
  if (missing.includes("spicy")) qs.push(`"Would you like it spicy?"`);
  if (missing.includes("size") && isSized(item)) {
    const sizes = availableSizes(item);
    qs.push(
      sizes.length === 2
        ? `"Regular (${formatCents(item.sizes.REGULAR.priceCents)}) or large (${formatCents(item.sizes.LARGE.priceCents)})?"`
        : `"Only ${sizes.map((s) => `${sizeLabel(s)} (${formatCents(item.sizes[s].priceCents)})`).join("")} is available today. Is that OK?"`,
    );
  }
  return qs.join(" / ");
}

/** Fills {{key}} placeholders; a missing key is a template bug, so it throws. */
export function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    const value = values[key];
    if (value === undefined) throw new Error(`State template placeholder {{${key}}} has no value`);
    return value;
  });
}
