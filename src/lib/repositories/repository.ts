import type { Cart } from "../domain/cart/schema";
import type { Result } from "../domain/errors";
import type { Menu } from "../domain/menu/schema";
import type { Order, OrderStatus } from "../domain/order/schema";
import type { RestaurantSettings } from "../domain/settings/schema";

/** Maps a Connect contact to the web cart it was started with (§7: identity never comes from the model). */
export interface ConversationSession {
  contactId: string;
  cartId: string;
  createdAt: string;
  /** Connect channel reported by the flow at init (absent for sessions created before this field). */
  channel?: "CHAT" | "VOICE";
}

/**
 * Persistence boundary. The domain depends only on this interface; memory/ (tests, mock mode)
 * and dynamo/ (Phase 2) implement it. Conditional writes mirror DynamoDB semantics.
 */
export interface OrderFilter {
  status?: OrderStatus;
  /** Only orders created at or after this ISO timestamp. */
  since?: string;
}

export interface Repository {
  /** Seeds the fictional menu/settings on first read when nothing is stored yet. */
  getMenu(): Promise<Menu>;
  /** Writes only if the stored menu's `updatedAt` equals `expectedUpdatedAt` (admin edits never overwrite each other). */
  saveMenu(menu: Menu, expectedUpdatedAt: string): Promise<Result<void>>;
  getSettings(): Promise<RestaurantSettings>;
  saveSettings(settings: RestaurantSettings, expectedUpdatedAt: string): Promise<Result<void>>;

  getCart(cartId: string): Promise<Cart | undefined>;
  /** Writes only if the stored version equals `expectedVersion` (`null` = cart must not exist yet). */
  putCart(cart: Cart, expectedVersion: number | null): Promise<Result<void>>;

  /**
   * Short-lived, single-purpose reference to a cart, handed to the chat widget inside its signed JWT
   * (so the browser-readable token never contains the cart id itself). Expired refs read as undefined.
   */
  putCartRef(ref: string, cartId: string, expiresAt: Date): Promise<void>;
  getCartRef(ref: string, now: Date): Promise<string | undefined>;

  getSession(contactId: string): Promise<ConversationSession | undefined>;
  putSession(session: ConversationSession): Promise<void>;
  /** The latest Connect contact started from this web cart (widget cartRef), so the website can show its transcript. */
  getCartSession(cartId: string): Promise<ConversationSession | undefined>;
  putCartSession(session: ConversationSession): Promise<void>;

  /** Atomically adds 1 to a counter and returns the new value. The counter is deleted some time after `expiresAt`. */
  incrementCounter(key: string, expiresAt: Date): Promise<number>;

  /**
   * Atomically: create the order (must not exist) and set `cart.orderId`
   * (cart version must equal `expectedCartVersion` and the cart must have no orderId yet).
   */
  commitOrder(order: Order, cartId: string, expectedCartVersion: number): Promise<Result<void>>;
  getOrder(orderId: string): Promise<Order | undefined>;
  /** Newest first. */
  listOrders(filter?: OrderFilter): Promise<Order[]>;
  /** Writes only if the stored order's `updatedAt` equals `expectedUpdatedAt`. */
  putOrder(order: Order, expectedUpdatedAt: string): Promise<Result<void>>;
}
