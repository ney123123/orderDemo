import { DynamoDBClient, type DynamoDBClientConfig } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
  type QueryCommandInput,
} from "@aws-sdk/lib-dynamodb";
import { CartSchema, type Cart } from "../../domain/cart/schema";
import { fail, ok, type Result } from "../../domain/errors";
import { seedMenu } from "../../domain/menu/seed";
import { MenuSchema, type Menu } from "../../domain/menu/schema";
import { OrderSchema, OrderStatusSchema, type Order, type OrderStatus } from "../../domain/order/schema";
import { RestaurantSettingsSchema, seedSettings, type RestaurantSettings } from "../../domain/settings/schema";
import type { ConversationSession, OrderFilter, Repository } from "../repository";

/**
 * Single-table design (§8): pk = MENU | SETTINGS | CART#<id> | SESSION#<contactId> | ORDER#<id>.
 * GSI `byStatus` (gsi1pk = STATUS#<status>, gsi1sk = createdAt) serves the admin order queue.
 * `ttl` (epoch seconds) lets DynamoDB expire CARTREF#/SESSION# items; reads also check expiry themselves,
 * because TTL deletion can lag by hours.
 */
export const GSI_BY_STATUS = "byStatus";

const KEY = {
  menu: "MENU",
  settings: "SETTINGS",
  cart: (id: string) => `CART#${id}`,
  session: (contactId: string) => `SESSION#${contactId}`,
  cartSession: (cartId: string) => `CARTSESSION#${cartId}`,
  counter: (key: string) => `COUNTER#${key}`,
  cartRef: (ref: string) => `CARTREF#${ref}`,
  order: (id: string) => `ORDER#${id}`,
  status: (s: OrderStatus) => `STATUS#${s}`,
};
const META = ["pk", "gsi1pk", "gsi1sk", "ttl"] as const;
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

export interface DynamoRepositoryOptions {
  tableName: string;
  client?: DynamoDBClientConfig;
}

export class DynamoRepository implements Repository {
  private readonly db: DynamoDBDocumentClient;
  private readonly table: string;

  constructor(opts: DynamoRepositoryOptions) {
    this.table = opts.tableName;
    this.db = DynamoDBDocumentClient.from(new DynamoDBClient(opts.client ?? {}), {
      marshallOptions: { removeUndefinedValues: true },
    });
  }

  async getMenu(): Promise<Menu> {
    return this.getOrSeed(KEY.menu, seedMenu, MenuSchema.parse);
  }

  saveMenu(menu: Menu, expectedUpdatedAt: string): Promise<Result<void>> {
    return this.putIf({ pk: KEY.menu, ...menu }, "#u = :u", { "#u": "updatedAt" }, { ":u": expectedUpdatedAt }, "The menu was changed by someone else. Reload and try again.");
  }

  async getSettings(): Promise<RestaurantSettings> {
    return this.getOrSeed(KEY.settings, seedSettings, RestaurantSettingsSchema.parse);
  }

  saveSettings(settings: RestaurantSettings, expectedUpdatedAt: string): Promise<Result<void>> {
    return this.putIf({ pk: KEY.settings, ...settings }, "#u = :u", { "#u": "updatedAt" }, { ":u": expectedUpdatedAt }, "The settings were changed by someone else. Reload and try again.");
  }

  async getCart(cartId: string): Promise<Cart | undefined> {
    const item = await this.get(KEY.cart(cartId));
    return item && CartSchema.parse(item);
  }

  putCart(cart: Cart, expectedVersion: number | null): Promise<Result<void>> {
    const message = "The cart changed at the same time. Please try again.";
    const item = { pk: KEY.cart(cart.id), ...cart };
    return expectedVersion === null
      ? this.putIf(item, "attribute_not_exists(pk)", undefined, undefined, message)
      : this.putIf(item, "#v = :v AND attribute_not_exists(orderId)", { "#v": "version" }, { ":v": expectedVersion }, message);
  }

  async putCartRef(ref: string, cartId: string, expiresAt: Date): Promise<void> {
    const ttl = Math.ceil(expiresAt.getTime() / 1000);
    await this.db.send(new PutCommand({ TableName: this.table, Item: { pk: KEY.cartRef(ref), cartId, ttl } }));
  }

  async getCartRef(ref: string, now: Date): Promise<string | undefined> {
    const res = await this.db.send(new GetCommand({ TableName: this.table, Key: { pk: KEY.cartRef(ref) }, ConsistentRead: true }));
    const item = res.Item as { cartId?: string; ttl?: number } | undefined;
    return item?.cartId && (item.ttl ?? 0) * 1000 > now.getTime() ? item.cartId : undefined;
  }

  async getSession(contactId: string): Promise<ConversationSession | undefined> {
    const item = await this.get(KEY.session(contactId));
    return item as ConversationSession | undefined;
  }

  async putSession(session: ConversationSession): Promise<void> {
    const ttl = Math.floor(Date.parse(session.createdAt) / 1000) + SESSION_TTL_SECONDS;
    await this.db.send(new PutCommand({ TableName: this.table, Item: { pk: KEY.session(session.contactId), ...session, ttl } }));
  }

  async getCartSession(cartId: string): Promise<ConversationSession | undefined> {
    const item = await this.get(KEY.cartSession(cartId));
    return item as ConversationSession | undefined;
  }

  async putCartSession(session: ConversationSession): Promise<void> {
    const ttl = Math.floor(Date.parse(session.createdAt) / 1000) + SESSION_TTL_SECONDS;
    await this.db.send(new PutCommand({ TableName: this.table, Item: { pk: KEY.cartSession(session.cartId), ...session, ttl } }));
  }

  async incrementCounter(key: string, expiresAt: Date): Promise<number> {
    const res = await this.db.send(
      new UpdateCommand({
        TableName: this.table,
        Key: { pk: KEY.counter(key) },
        UpdateExpression: "ADD #n :one SET #ttl = :ttl",
        ExpressionAttributeNames: { "#n": "n", "#ttl": "ttl" },
        ExpressionAttributeValues: { ":one": 1, ":ttl": Math.ceil(expiresAt.getTime() / 1000) },
        ReturnValues: "UPDATED_NEW",
      }),
    );
    return Number(res.Attributes?.n);
  }

  /** §9 step 4: one transaction creates the order and marks the cart as submitted. */
  async commitOrder(order: Order, cartId: string, expectedCartVersion: number): Promise<Result<void>> {
    try {
      await this.db.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Put: {
                TableName: this.table,
                Item: this.orderItem(order),
                ConditionExpression: "attribute_not_exists(pk)",
              },
            },
            {
              Update: {
                TableName: this.table,
                Key: { pk: KEY.cart(cartId) },
                UpdateExpression: "SET orderId = :o",
                ConditionExpression: "#v = :v AND attribute_not_exists(orderId)",
                ExpressionAttributeNames: { "#v": "version" },
                ExpressionAttributeValues: { ":o": order.id, ":v": expectedCartVersion },
              },
            },
          ],
        }),
      );
      return ok(undefined);
    } catch (e) {
      if (isNamed(e, "TransactionCanceledException")) return fail("CONFLICT", "The cart changed or was already submitted.");
      throw e;
    }
  }

  async getOrder(orderId: string): Promise<Order | undefined> {
    const item = await this.get(KEY.order(orderId));
    return item && OrderSchema.parse(item);
  }

  async listOrders(filter: OrderFilter = {}): Promise<Order[]> {
    const statuses = filter.status ? [filter.status] : OrderStatusSchema.options;
    const lists = await Promise.all(statuses.map((s) => this.queryStatus(s, filter.since)));
    return lists.flat().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  putOrder(order: Order, expectedUpdatedAt: string): Promise<Result<void>> {
    return this.putIf(this.orderItem(order), "#u = :u", { "#u": "updatedAt" }, { ":u": expectedUpdatedAt }, "The order changed at the same time. Please reload.", "NOT_FOUND_IF_MISSING");
  }

  private orderItem(order: Order) {
    return { pk: KEY.order(order.id), gsi1pk: KEY.status(order.status), gsi1sk: order.createdAt, ...order };
  }

  private async queryStatus(status: OrderStatus, since?: string): Promise<Order[]> {
    const orders: Order[] = [];
    let start: QueryCommandInput["ExclusiveStartKey"];
    do {
      const page = await this.db.send(
        new QueryCommand({
          TableName: this.table,
          IndexName: GSI_BY_STATUS,
          KeyConditionExpression: since ? "gsi1pk = :s AND gsi1sk >= :since" : "gsi1pk = :s",
          ExpressionAttributeValues: since ? { ":s": KEY.status(status), ":since": since } : { ":s": KEY.status(status) },
          ScanIndexForward: false,
          ExclusiveStartKey: start,
        }),
      );
      for (const item of page.Items ?? []) orders.push(OrderSchema.parse(strip(item)));
      start = page.LastEvaluatedKey;
    } while (start);
    return orders;
  }

  private async get(pk: string): Promise<Record<string, unknown> | undefined> {
    const res = await this.db.send(new GetCommand({ TableName: this.table, Key: { pk }, ConsistentRead: true }));
    return res.Item && strip(res.Item);
  }

  private async getOrSeed<T>(pk: string, seed: () => T, parse: (v: unknown) => T): Promise<T> {
    const item = await this.get(pk);
    if (item) return parse(item);
    const value = seed();
    // Two first readers may race; the loser's put fails its condition and both continue with the seed.
    await this.putIf({ pk, ...(value as object) }, "attribute_not_exists(pk)", undefined, undefined, "");
    const stored = await this.get(pk);
    return parse(stored ?? value);
  }

  private async putIf(
    item: Record<string, unknown>,
    condition: string,
    names: Record<string, string> | undefined,
    values: Record<string, unknown> | undefined,
    conflictMessage: string,
    missing?: "NOT_FOUND_IF_MISSING",
  ): Promise<Result<void>> {
    try {
      await this.db.send(
        new PutCommand({
          TableName: this.table,
          Item: item,
          ConditionExpression: missing ? `attribute_exists(pk) AND ${condition}` : condition,
          ExpressionAttributeNames: names,
          ExpressionAttributeValues: values,
        }),
      );
      return ok(undefined);
    } catch (e) {
      if (!isNamed(e, "ConditionalCheckFailedException")) throw e;
      if (missing && !(await this.get(item.pk as string))) return fail("NOT_FOUND", "Order not found.");
      return fail("CONFLICT", conflictMessage);
    }
  }
}

function strip(item: Record<string, unknown>): Record<string, unknown> {
  const copy = { ...item };
  for (const k of META) delete copy[k];
  return copy;
}

const isNamed = (e: unknown, name: string) => e instanceof Error && e.name === name;
