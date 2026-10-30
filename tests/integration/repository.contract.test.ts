import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createLocalTable } from "../../scripts/create-local-table.mjs";
import { emptyCart, type Cart } from "../../src/lib/domain/cart/schema";
import type { Order } from "../../src/lib/domain/order/schema";
import { DynamoRepository } from "../../src/lib/repositories/dynamo/dynamoRepository";
import { MemoryRepository } from "../../src/lib/repositories/memory/memoryRepository";
import type { Repository } from "../../src/lib/repositories/repository";
import type { Result } from "../../src/lib/domain/errors";
import { awsClient, createTestTables, deleteTestTables } from "./awsTestTables";

const code = (r: Result<unknown>) => (r.ok ? "OK" : r.error.code);

// The same behaviour is required of every Repository. DynamoDB runs only when asked:
//   real AWS (short-lived burger-test-* tables, deleted afterwards):  DYNAMODB_AWS_TEST=1 npm test
//   DynamoDB Local:  docker run -p 8000:8000 amazon/dynamodb-local, then DYNAMODB_ENDPOINT=http://localhost:8000 npm test
const endpoint = process.env.DYNAMODB_ENDPOINT;
const onAws = process.env.DYNAMODB_AWS_TEST === "1";
const TESTS_PER_IMPL = 7; // one fresh table per test below

const impls: [string, () => Promise<Repository>][] = [["memory", async () => new MemoryRepository()]];
if (endpoint) {
  impls.push([
    "dynamo (local)",
    async () => {
      const table = `contract-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      await createLocalTable(endpoint, table);
      return new DynamoRepository({ tableName: table, client: { endpoint, region: "local", credentials: { accessKeyId: "local", secretAccessKey: "local" } } });
    },
  ]);
}

const T0 = "2026-10-29T16:00:00.000Z";
const cart = (id: string, version: number, extra: Partial<Cart> = {}): Cart => ({ ...emptyCart(id, new Date(T0)), version, ...extra });
const order = (id: string, cartId: string, extra: Partial<Order> = {}): Order => ({
  id,
  cartId,
  lines: [{ itemId: "coke", itemName: "Coke", description: "1 × large Coke", options: { size: "LARGE" }, quantity: 1, unitCents: 250, lineCents: 250 }],
  totalCents: 250,
  customerName: "Sam",
  pickupInfo: "Front counter",
  status: "PENDING",
  createdAt: T0,
  updatedAt: T0,
  ...extra,
});

if (onAws) {
  const db = awsClient();
  let created: string[] = [];
  let unused: string[] = [];
  beforeAll(async () => {
    created = await createTestTables(db, TESTS_PER_IMPL);
    unused = [...created];
  }, 240_000);
  afterAll(async () => {
    await deleteTestTables(db, created);
  }, 120_000);
  impls.push([
    "dynamo (AWS)",
    async () => {
      const table = unused.shift();
      if (!table) throw new Error("Not enough AWS test tables; raise TESTS_PER_IMPL");
      return new DynamoRepository({ tableName: table, client: { region: process.env.AWS_REGION ?? "ca-central-1" } });
    },
  ]);
}

describe.each(impls)("Repository contract: %s", (_name, make) => {
  it("seeds menu and settings, and saves them only against the version read", async () => {
    const repo = await make();
    const menu = await repo.getMenu();
    expect(menu.items.map((i) => i.id)).toContain("beef");
    expect((await repo.saveMenu({ ...menu, updatedAt: "2026-10-29T17:00:00.000Z" }, menu.updatedAt)).ok).toBe(true);
    expect((await repo.saveMenu({ ...menu, updatedAt: "2026-10-29T18:00:00.000Z" }, menu.updatedAt)).ok).toBe(false);
    expect((await repo.getMenu()).updatedAt).toBe("2026-10-29T17:00:00.000Z");

    const s = await repo.getSettings();
    expect((await repo.saveSettings({ ...s, acceptingOrders: false, updatedAt: "x2" }, s.updatedAt)).ok).toBe(true);
    expect((await repo.saveSettings({ ...s, updatedAt: "x3" }, s.updatedAt)).ok).toBe(false);
    expect((await repo.getSettings()).acceptingOrders).toBe(false);
  });

  it("writes carts conditionally on version", async () => {
    const repo = await make();
    expect((await repo.putCart(cart("c1", 1), null)).ok).toBe(true);
    expect(code(await repo.putCart(cart("c1", 1), null))).toBe("CONFLICT");
    expect((await repo.putCart(cart("c1", 2), 1)).ok).toBe(true);
    expect(code(await repo.putCart(cart("c1", 3), 1))).toBe("CONFLICT");
    expect((await repo.getCart("c1"))?.version).toBe(2);
    expect(await repo.getCart("nope")).toBeUndefined();
  });

  it("commits an order and the cart link atomically, exactly once", async () => {
    const repo = await make();
    await repo.putCart(cart("c1", 1), null);
    expect((await repo.commitOrder(order("PL-1", "c1"), "c1", 2)).ok).toBe(false); // wrong version
    expect(await repo.getOrder("PL-1")).toBeUndefined(); // nothing half-written

    const [a, b] = await Promise.all([repo.commitOrder(order("PL-1", "c1"), "c1", 1), repo.commitOrder(order("PL-2", "c1"), "c1", 1)]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    const linked = (await repo.getCart("c1"))?.orderId;
    expect(["PL-1", "PL-2"]).toContain(linked);
    expect(await repo.getOrder(linked === "PL-1" ? "PL-2" : "PL-1")).toBeUndefined();

    // A late cart write (same version) must not erase the order link.
    expect((await repo.putCart(cart("c1", 2), 1)).ok).toBe(false);
    expect((await repo.getCart("c1"))?.orderId).toBe(linked);
  });

  it("lists orders newest first, by status and since, and updates them conditionally", async () => {
    const repo = await make();
    for (const [i, t] of ["2026-10-28T10:00:00.000Z", "2026-10-29T10:00:00.000Z", "2026-10-29T12:00:00.000Z"].entries()) {
      await repo.putCart(cart(`c${i}`, 1), null);
      await repo.commitOrder(order(`PL-${i}`, `c${i}`, { createdAt: t, updatedAt: t }), `c${i}`, 1);
    }
    expect((await repo.listOrders()).map((o) => o.id)).toEqual(["PL-2", "PL-1", "PL-0"]);
    expect((await repo.listOrders({ since: "2026-10-29T00:00:00.000Z" })).map((o) => o.id)).toEqual(["PL-2", "PL-1"]);

    const o = (await repo.getOrder("PL-1"))!;
    const next = { ...o, status: "ACCEPTED" as const, updatedAt: "2026-10-29T13:00:00.000Z" };
    expect((await repo.putOrder(next, o.updatedAt)).ok).toBe(true);
    expect(code(await repo.putOrder({ ...next, status: "REJECTED" }, o.updatedAt))).toBe("CONFLICT");
    expect(code(await repo.putOrder(order("PL-404", "x"), T0))).toBe("NOT_FOUND");
    expect((await repo.listOrders({ status: "ACCEPTED" })).map((x) => x.id)).toEqual(["PL-1"]);
    expect((await repo.listOrders({ status: "PENDING" })).map((x) => x.id)).toEqual(["PL-2", "PL-0"]);
  });

  it("stores contact → cart sessions", async () => {
    const repo = await make();
    await repo.putSession({ contactId: "ct-1", cartId: "c1", createdAt: T0 });
    expect(await repo.getSession("ct-1")).toEqual({ contactId: "ct-1", cartId: "c1", createdAt: T0 });
    await repo.putCartSession({ contactId: "ct-1", cartId: "c1", createdAt: T0, channel: "VOICE" });
    expect(await repo.getCartSession("c1")).toEqual({ contactId: "ct-1", cartId: "c1", createdAt: T0, channel: "VOICE" });
    expect(await repo.getCartSession("c2")).toBeUndefined();
  });

  it("counts atomically per key", async () => {
    const repo = await make();
    const expires = new Date("2026-10-31T00:00:00Z");
    const counts = await Promise.all([1, 2, 3].map(() => repo.incrementCounter("chats#2026-10-29", expires)));
    expect(counts.sort()).toEqual([1, 2, 3]);
    expect(await repo.incrementCounter("chats#2026-10-30", expires)).toBe(1);
  });

  it("resolves cart refs until they expire", async () => {
    const repo = await make();
    await repo.putCartRef("ref-1", "c1", new Date("2026-10-29T17:00:00Z"));
    expect(await repo.getCartRef("ref-1", new Date("2026-10-29T16:59:00Z"))).toBe("c1");
    expect(await repo.getCartRef("ref-1", new Date("2026-10-29T17:00:01Z"))).toBeUndefined();
    expect(await repo.getCartRef("nope", new Date(T0))).toBeUndefined();
  });
});
