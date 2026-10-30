import { z } from "zod";
import type { Repository } from "../../repositories/repository";
import { fail, ok, type Result } from "../errors";
import { AvailabilitySchema, MenuItemSchema, type Menu, type MenuItem } from "../menu/schema";
import { canTransition, OrderStatusSchema, type Order } from "../order/schema";
import { startOfLocalDay } from "../settings/hours";
import { RestaurantSettingsSchema, type RestaurantSettings } from "../settings/schema";

const cents = z.number().int().nonnegative().max(100_000);
const sizePatch = z.object({ priceCents: cents.optional(), availability: AvailabilitySchema.optional() }).strict();

export const MenuItemPatchSchema = z
  .object({
    name: z.string().trim().min(1).max(60).optional(),
    description: z.string().trim().max(300).optional(),
    availability: AvailabilitySchema.optional(),
    basePriceCents: cents.optional(), // burgers only
    sizes: z.object({ REGULAR: sizePatch.optional(), LARGE: sizePatch.optional() }).strict().optional(), // sides/drinks only
  })
  .strict();
export type MenuItemPatch = z.infer<typeof MenuItemPatchSchema>;

export const SettingsPatchSchema = RestaurantSettingsSchema.omit({ updatedAt: true }).partial().strict();
export type SettingsPatch = z.infer<typeof SettingsPatchSchema>;

export const OrderStatusChangeSchema = z.object({ status: OrderStatusSchema, expectedUpdatedAt: z.string() }).strict();

/**
 * Admin-side rules (§11 Phase 2). Every write is conditional on the version the admin saw,
 * so two admins never silently overwrite each other. Prices are only ever stored here,
 * never computed: the cart, state block and snapshots all re-price through priceLine.
 */
export class AdminService {
  constructor(private readonly deps: { repo: Repository; now?: () => Date }) {}

  private now() {
    return (this.deps.now ?? (() => new Date()))();
  }

  async updateMenuItem(itemId: string, patch: MenuItemPatch, expectedUpdatedAt: string): Promise<Result<{ menu: Menu; item: MenuItem }>> {
    const menu = await this.deps.repo.getMenu();
    if (menu.updatedAt !== expectedUpdatedAt) return fail("CONFLICT", "The menu was changed by someone else. Reload and try again.");
    const index = menu.items.findIndex((i) => i.id === itemId);
    const current = menu.items[index];
    if (!current) return fail("NOT_FOUND", `No menu item "${itemId}".`);

    if (current.category === "BURGER" && patch.sizes) return fail("INVALID_INPUT", "Burgers have no sizes.");
    if (current.category !== "BURGER" && patch.basePriceCents !== undefined) {
      return fail("INVALID_INPUT", "Sides and drinks are priced per size.");
    }

    const t = this.now().toISOString();
    const merged: unknown =
      current.category === "BURGER"
        ? { ...current, ...defined(patch), updatedAt: t }
        : {
            ...current,
            ...defined({ ...patch, sizes: undefined }),
            sizes: {
              REGULAR: { ...current.sizes.REGULAR, ...defined(patch.sizes?.REGULAR ?? {}) },
              LARGE: { ...current.sizes.LARGE, ...defined(patch.sizes?.LARGE ?? {}) },
            },
            updatedAt: t,
          };
    const parsed = MenuItemSchema.safeParse(merged);
    if (!parsed.success) return fail("INVALID_INPUT", "That change would make the item invalid.");

    const items = [...menu.items];
    items[index] = parsed.data;
    const next: Menu = { ...menu, items, updatedAt: t };
    const saved = await this.deps.repo.saveMenu(next, expectedUpdatedAt);
    return saved.ok ? ok({ menu: next, item: parsed.data }) : saved;
  }

  async updateSettings(patch: SettingsPatch, expectedUpdatedAt: string): Promise<Result<RestaurantSettings>> {
    const settings = await this.deps.repo.getSettings();
    if (settings.updatedAt !== expectedUpdatedAt) return fail("CONFLICT", "The settings were changed by someone else. Reload and try again.");
    const parsed = RestaurantSettingsSchema.safeParse({ ...settings, ...defined(patch), updatedAt: this.now().toISOString() });
    if (!parsed.success) return fail("INVALID_INPUT", "Those settings are not valid.");
    if (!isTimeZone(parsed.data.timezone)) return fail("INVALID_INPUT", `Unknown time zone "${parsed.data.timezone}".`);
    const saved = await this.deps.repo.saveSettings(parsed.data, expectedUpdatedAt);
    return saved.ok ? ok(parsed.data) : saved;
  }

  async setOrderStatus(orderId: string, change: z.infer<typeof OrderStatusChangeSchema>): Promise<Result<Order>> {
    const order = await this.deps.repo.getOrder(orderId);
    if (!order) return fail("NOT_FOUND", "Order not found.");
    if (order.updatedAt !== change.expectedUpdatedAt) return fail("CONFLICT", "The order changed at the same time. Please reload.");
    if (!canTransition(order.status, change.status)) {
      return fail("INVALID_TRANSITION", `An order can't go from ${order.status} to ${change.status}.`);
    }
    // Keep updatedAt strictly increasing so the optimistic check can't be fooled by two writes in one millisecond.
    const t = new Date(Math.max(this.now().getTime(), Date.parse(order.updatedAt) + 1)).toISOString();
    const next: Order = { ...order, status: change.status, updatedAt: t };
    const saved = await this.deps.repo.putOrder(next, order.updatedAt);
    return saved.ok ? ok(next) : saved;
  }

  async overview() {
    const [settings, menu] = await Promise.all([this.deps.repo.getSettings(), this.deps.repo.getMenu()]);
    const today = await this.deps.repo.listOrders({ since: startOfLocalDay(this.now(), settings.timezone) });
    return { settings, menu, today };
  }
}

function defined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

function isTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
