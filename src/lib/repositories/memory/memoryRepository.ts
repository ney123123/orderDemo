import type { Cart } from "../../domain/cart/schema";
import { fail, ok, type Result } from "../../domain/errors";
import { seedMenu } from "../../domain/menu/seed";
import type { Menu } from "../../domain/menu/schema";
import type { Order } from "../../domain/order/schema";
import { seedSettings, type RestaurantSettings } from "../../domain/settings/schema";
import type { ConversationSession, OrderFilter, Repository } from "../repository";

const clone = <T>(v: T): T => structuredClone(v);

/** In-memory repository for unit tests and local mock mode. Not shared across processes. */
export class MemoryRepository implements Repository {
  private menu: Menu;
  private settings: RestaurantSettings;
  private carts = new Map<string, Cart>();
  private sessions = new Map<string, ConversationSession>();
  private cartSessions = new Map<string, ConversationSession>();
  private counters = new Map<string, number>();
  private orders = new Map<string, Order>();
  private cartRefs = new Map<string, { cartId: string; expiresAt: number }>();

  constructor(init: { menu?: Menu; settings?: RestaurantSettings } = {}) {
    this.menu = clone(init.menu ?? seedMenu());
    this.settings = clone(init.settings ?? seedSettings());
  }

  async getMenu() { return clone(this.menu); }
  async saveMenu(menu: Menu, expectedUpdatedAt: string): Promise<Result<void>> {
    if (this.menu.updatedAt !== expectedUpdatedAt) return staleEdit("menu");
    this.menu = clone(menu);
    return ok(undefined);
  }
  async getSettings() { return clone(this.settings); }
  async saveSettings(settings: RestaurantSettings, expectedUpdatedAt: string): Promise<Result<void>> {
    if (this.settings.updatedAt !== expectedUpdatedAt) return staleEdit("settings");
    this.settings = clone(settings);
    return ok(undefined);
  }

  async getCart(cartId: string) {
    const cart = this.carts.get(cartId);
    return cart && clone(cart);
  }

  async putCart(cart: Cart, expectedVersion: number | null): Promise<Result<void>> {
    const current = this.carts.get(cart.id);
    // Submitting doesn't bump the version, so also refuse to overwrite a submitted cart (same as the DynamoDB condition).
    if ((current?.version ?? null) !== expectedVersion || current?.orderId) {
      return fail("CONFLICT", "The cart changed at the same time. Please try again.");
    }
    this.carts.set(cart.id, clone(cart));
    return ok(undefined);
  }

  async putCartRef(ref: string, cartId: string, expiresAt: Date) {
    this.cartRefs.set(ref, { cartId, expiresAt: expiresAt.getTime() });
  }
  async getCartRef(ref: string, now: Date) {
    const r = this.cartRefs.get(ref);
    return r && r.expiresAt > now.getTime() ? r.cartId : undefined;
  }

  async getSession(contactId: string) {
    const s = this.sessions.get(contactId);
    return s && clone(s);
  }
  async putSession(session: ConversationSession) { this.sessions.set(session.contactId, clone(session)); }
  async getCartSession(cartId: string) {
    const s = this.cartSessions.get(cartId);
    return s && clone(s);
  }
  async putCartSession(session: ConversationSession) { this.cartSessions.set(session.cartId, clone(session)); }
  async incrementCounter(key: string, _expiresAt: Date) {
    const n = (this.counters.get(key) ?? 0) + 1;
    this.counters.set(key, n);
    return n;
  }

  async commitOrder(order: Order, cartId: string, expectedCartVersion: number): Promise<Result<void>> {
    const cart = this.carts.get(cartId);
    if (this.orders.has(order.id)) return fail("CONFLICT", "Order id already exists.");
    if (!cart || cart.version !== expectedCartVersion || cart.orderId) return fail("CONFLICT", "The cart changed or was already submitted.");
    this.orders.set(order.id, clone(order));
    this.carts.set(cartId, { ...cart, orderId: order.id });
    return ok(undefined);
  }

  async getOrder(orderId: string) {
    const o = this.orders.get(orderId);
    return o && clone(o);
  }

  async listOrders(filter: OrderFilter = {}) {
    return [...this.orders.values()]
      .filter((o) => (!filter.status || o.status === filter.status) && (!filter.since || o.createdAt >= filter.since))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(clone);
  }

  async putOrder(order: Order, expectedUpdatedAt: string): Promise<Result<void>> {
    const current = this.orders.get(order.id);
    if (!current) return fail("NOT_FOUND", "Order not found.");
    if (current.updatedAt !== expectedUpdatedAt) return fail("CONFLICT", "The order changed at the same time. Please reload.");
    this.orders.set(order.id, clone(order));
    return ok(undefined);
  }
}

const staleEdit = (what: string) => fail("CONFLICT", `The ${what} was changed by someone else. Reload and try again.`);
