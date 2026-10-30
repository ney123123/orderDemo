import { describe, expect, it } from "vitest";
import { AdminAuth } from "../../src/lib/auth/adminAuth";
import { hashPassword } from "../../src/lib/auth/password";
import { loadConfig } from "../../src/lib/server/config";
import { ADMIN, app, Browser } from "./httpHelpers";

const fullCombo = { itemId: "beef", format: "COMBO", spicy: true, sideId: "fries", sideSize: "LARGE", drinkId: "coke_zero", drinkSize: "LARGE" };

async function adminBrowser(c: Awaited<ReturnType<typeof app>>) {
  const a = new Browser();
  const r = await a.send(c.adminApi.login(a.req("/api/admin/login", { method: "POST", body: ADMIN })));
  expect(r.status).toBe(200);
  return a;
}

describe("Phase 2: manual order lifecycle through the customer API", () => {
  it("orders from /menu, submits once (a duplicate submit returns the same order), and admin moves it to COMPLETED", async () => {
    const c = await app();
    const b = new Browser();
    const api = c.customerApi;

    let r = await b.send(api.getCart(b.req("/api/cart")));
    expect(r.body.cart).toMatchObject({ lines: [], state: "GENERAL" });
    expect(b.jar.get("cart_id")).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(JSON.stringify(r.body)).not.toContain(b.jar.get("cart_id"));

    r = await b.send(api.addLine(b.req("/api/cart/lines", { method: "POST", body: fullCombo })));
    expect(r.status).toBe(201);
    expect(r.body.cart).toMatchObject({ totalCents: 1000, complete: true, state: "GENERAL" });

    r = await b.send(api.review(b.req("/api/cart/review", { method: "POST" })));
    expect(r.body.cart).toMatchObject({ state: "CONFIRM", review: { totalCents: 1000 } });
    const submit = { reviewToken: r.body.cart.review.token, customerName: "Sam", pickupNote: "No onions" };

    const first = await b.send(api.submit(b.req("/api/cart/submit", { method: "POST", body: submit })));
    const second = await b.send(api.submit(b.req("/api/cart/submit", { method: "POST", body: submit })));
    expect(first.status).toBe(201);
    expect(second.body.order.id).toBe(first.body.order.id);
    const orderId: string = first.body.order.id;

    const admin = await adminBrowser(c);
    let list = await admin.send(c.adminApi.listOrders(admin.req("/api/admin/orders")));
    expect(list.body.orders).toHaveLength(1);
    expect(list.body.orders[0]).toMatchObject({ id: orderId, status: "PENDING", customerName: "Sam", pickupNote: "No onions", totalCents: 1000 });

    let updatedAt: string = list.body.orders[0].updatedAt;
    for (const status of ["ACCEPTED", "PREPARING", "READY", "COMPLETED"]) {
      const u = await admin.send(c.adminApi.updateOrderStatus(admin.req(`/api/admin/orders/${orderId}`, { method: "PATCH", body: { status, expectedUpdatedAt: updatedAt } }), orderId));
      expect(u.body.order?.status, status).toBe(status);
      updatedAt = u.body.order.updatedAt;
    }
    const bad = await admin.send(c.adminApi.updateOrderStatus(admin.req(`/api/admin/orders/${orderId}`, { method: "PATCH", body: { status: "PENDING", expectedUpdatedAt: updatedAt } }), orderId));
    expect(bad).toMatchObject({ status: 422, body: { error: { code: "INVALID_TRANSITION" } } });

    const seen = await b.send(api.getOrder(b.req(`/api/orders/${orderId}`), orderId));
    expect(seen.body.order).toMatchObject({ id: orderId, status: "COMPLETED", totalCents: 1000 });

    // The submitted cart takes no more changes; a new cart starts empty and the old order stays viewable.
    r = await b.send(api.addLine(b.req("/api/cart/lines", { method: "POST", body: { itemId: "coke", size: "LARGE" } })));
    expect(r.body.error?.code).toBe("ALREADY_SUBMITTED");
    r = await b.send(api.newCart(b.req("/api/cart/new", { method: "POST" })));
    expect(r.body.cart.lines).toHaveLength(0);
    expect((await b.send(api.getOrder(b.req(`/api/orders/${orderId}`), orderId))).status).toBe(200);
    list = await admin.send(c.adminApi.listOrders(admin.req("/api/admin/orders?status=COMPLETED")));
    expect(list.body.orders).toHaveLength(1);
  });

  it("rejects invalid web input with a structured error and leaves the cart unchanged", async () => {
    const c = await app();
    const b = new Browser();
    for (const body of [{ itemId: "beef", quantity: 0 }, { itemId: "coke", size: "XL" }, { itemId: "beef", priceCents: 0 }, { itemId: "pizza" }]) {
      const r = await b.send(c.customerApi.addLine(b.req("/api/cart/lines", { method: "POST", body })));
      expect(r.status, JSON.stringify(body)).toBeGreaterThanOrEqual(400);
      expect(r.body.ok).toBe(false);
    }
    expect((await b.send(c.customerApi.getCart(b.req("/api/cart")))).body.cart.lines).toHaveLength(0);
  });
});

describe("Phase 2: access control", () => {
  it("rejects every admin endpoint without a valid admin session", async () => {
    const c = await app();
    const customer = new Browser();
    await customer.send(c.customerApi.getCart(customer.req("/api/cart")));
    const forged = new Browser();
    forged.jar.set("admin_session", "eyJzdWIiOiJ4Iiwicm9sZSI6ImFkbWluIiwiZXhwIjo5OTk5OTk5OTk5fQ.bad");

    for (const who of [customer, forged]) {
      const calls = [
        c.adminApi.overview(who.req("/api/admin")),
        c.adminApi.listOrders(who.req("/api/admin/orders")),
        c.adminApi.getMenu(who.req("/api/admin/menu")),
        c.adminApi.getSettings(who.req("/api/admin/settings")),
        c.adminApi.updateMenuItem(who.req("/api/admin/menu/items/beef", { method: "PATCH", body: { patch: { basePriceCents: 1 }, expectedUpdatedAt: "x" } }), "beef"),
        c.adminApi.updateSettings(who.req("/api/admin/settings", { method: "PATCH", body: { patch: { acceptingOrders: false }, expectedUpdatedAt: "x" } })),
        c.adminApi.updateOrderStatus(who.req("/api/admin/orders/PL-X", { method: "PATCH", body: { status: "ACCEPTED", expectedUpdatedAt: "x" } }), "PL-X"),
      ];
      for (const res of await Promise.all(calls)) expect(res.status).toBe(401);
    }
    expect((await c.repo.getMenu()).items.find((i) => i.id === "beef")).toMatchObject({ basePriceCents: 700 });
  });

  it("refuses wrong passwords, locks out after 5 failures, and refuses cross-site login", async () => {
    const c = await app();
    const b = new Browser();
    const login = (password: string, origin?: string) => b.send(c.adminApi.login(b.req("/api/admin/login", { method: "POST", body: { username: ADMIN.username, password }, origin })));
    expect((await login("nope")).status).toBe(401);
    expect((await login(ADMIN.password, "https://evil.example")).status).toBe(403);
    for (let i = 0; i < 4; i++) await login("nope");
    expect((await login(ADMIN.password)).status).toBe(401); // locked out
    expect(b.jar.has("admin_session")).toBe(false);
  });

  it("does not lock out when lockout is off (local next dev)", async () => {
    const auth = new AdminAuth({ username: ADMIN.username, passwordHash: await hashPassword(ADMIN.password), sessionSecret: "s".repeat(32) }, undefined, false);
    for (let i = 0; i < 6; i++) expect(await auth.login(ADMIN.username, "nope", "client")).toBeUndefined();
    expect(await auth.login(ADMIN.username, ADMIN.password, "client")).toBeTypeOf("string");
  });

  it("sets an httpOnly, SameSite=Strict admin cookie and logout clears it", async () => {
    const c = await app();
    const b = new Browser();
    const r = await b.send(c.adminApi.login(b.req("/api/admin/login", { method: "POST", body: ADMIN })));
    const cookie = r.headers.getSetCookie()[0]!;
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    await b.send(c.adminApi.logout(b.req("/api/admin/logout", { method: "POST" })));
    expect((await b.send(c.adminApi.overview(b.req("/api/admin")))).status).toBe(401);
  });

  it("another browser can't read someone else's order (§13 #15) or cart", async () => {
    const c = await app();
    const a = new Browser();
    await a.send(c.customerApi.addLine(a.req("/api/cart/lines", { method: "POST", body: { itemId: "coke", size: "LARGE" } })));
    const token = (await a.send(c.customerApi.review(a.req("/api/cart/review", { method: "POST" })))).body.cart.review.token;
    const id: string = (await a.send(c.customerApi.submit(a.req("/api/cart/submit", { method: "POST", body: { reviewToken: token, customerName: "A" } })))).body.order.id;

    const other = new Browser();
    expect((await other.send(c.customerApi.getOrder(other.req(`/api/orders/${id}`), id))).status).toBe(404);
    expect((await other.send(c.customerApi.getCart(other.req("/api/cart")))).body.cart.lines).toHaveLength(0);
    // Planting someone's order id in past_carts doesn't help: it holds cart ids, which are never exposed.
    other.jar.set("past_carts", id);
    expect((await other.send(c.customerApi.getOrder(other.req(`/api/orders/${id}`), id))).status).toBe(404);
  });

  it("refuses cross-site cart changes (CSRF)", async () => {
    const c = await app();
    const b = new Browser();
    await b.send(c.customerApi.getCart(b.req("/api/cart")));
    const r = await b.send(c.customerApi.addLine(b.req("/api/cart/lines", { method: "POST", body: { itemId: "coke", size: "LARGE" }, origin: "https://evil.example" })));
    expect(r.status).toBe(403);
    expect((await b.send(c.customerApi.getCart(b.req("/api/cart")))).body.cart.lines).toHaveLength(0);
  });

  it("never enables the mock console in production", () => {
    expect(loadConfig({ NODE_ENV: "production", REPOSITORY: "dynamo", TABLE_NAME: "t", CHAT_MODE: "mock" }).mockConsole).toBe(false);
    expect(() => loadConfig({ NODE_ENV: "production" })).toThrow(/memory/);
  });
});

describe("Phase 2: admin changes reach /menu and the next state block", () => {
  it("price, description, hiding and size availability", async () => {
    const c = await app();
    const admin = await adminBrowser(c);
    const patch = async (itemId: string, p: object) => {
      const menu = (await admin.send(c.adminApi.getMenu(admin.req("/api/admin/menu")))).body.menu;
      return admin.send(c.adminApi.updateMenuItem(admin.req(`/api/admin/menu/items/${itemId}`, { method: "PATCH", body: { patch: p, expectedUpdatedAt: menu.updatedAt } }), itemId));
    };

    expect((await patch("beef", { basePriceCents: 800, description: "Now with pickles." })).status).toBe(200);
    expect((await patch("salad", { availability: "HIDDEN" })).status).toBe(200);
    expect((await patch("coke", { sizes: { LARGE: { availability: "SOLD_OUT" } } })).status).toBe(200);
    expect((await patch("coke", { basePriceCents: 1 })).body.error?.code).toBe("INVALID_INPUT");

    const menu = (await c.customerApi.getMenu().then((r) => r.json())) as any;
    const beef = menu.menu.items.find((i: any) => i.id === "beef");
    expect(beef).toMatchObject({ basePriceCents: 800, description: "Now with pickles." });
    expect(menu.menu.items.map((i: any) => i.id)).not.toContain("salad");

    const b = new Browser();
    const tool = (tool: string, args: Record<string, string>) => b.send(c.customerApi.mockTool(b.req("/api/mock/tool", { method: "POST", body: { tool, args } })));
    let r = await tool("addToCart", { itemId: "beef", format: "SINGLE", spicy: "no" });
    expect(r.body.result.stateBlock).toContain("Beef Burger (id beef) $8.00");
    expect(r.body.result.stateBlock).toContain("Total: $8.00");
    expect(r.body.result.stateBlock).not.toContain("Salad");
    expect(r.body.result.stateBlock).toContain("Coke (id coke) regular $1.50 (large sold out)");
    r = await tool("addToCart", { itemId: "salad", size: "REGULAR" });
    expect(r.body.result.error.code).toBe("UNKNOWN_ITEM");
  });

  it("a stale edit is refused instead of overwriting", async () => {
    const c = await app();
    const admin = await adminBrowser(c);
    const { updatedAt } = (await admin.send(c.adminApi.getMenu(admin.req("/api/admin/menu")))).body.menu;
    const send = (p: object) => admin.send(c.adminApi.updateMenuItem(admin.req("/api/admin/menu/items/beef", { method: "PATCH", body: { patch: p, expectedUpdatedAt: updatedAt } }), "beef"));
    expect((await send({ basePriceCents: 800 })).status).toBe(200);
    expect((await send({ basePriceCents: 900 })).status).toBe(409);
    expect((await c.repo.getMenu()).items.find((i) => i.id === "beef")).toMatchObject({ basePriceCents: 800 });
  });

  it("pausing orders in settings stops review and shows in the state block", async () => {
    const c = await app();
    const admin = await adminBrowser(c);
    const { settings } = (await admin.send(c.adminApi.getSettings(admin.req("/api/admin/settings")))).body;
    const r = await admin.send(c.adminApi.updateSettings(admin.req("/api/admin/settings", { method: "PATCH", body: { patch: { acceptingOrders: false, name: "Patty Lane (test)" }, expectedUpdatedAt: settings.updatedAt } })));
    expect(r.body.settings).toMatchObject({ acceptingOrders: false, name: "Patty Lane (test)" });
    const bad = await admin.send(c.adminApi.updateSettings(admin.req("/api/admin/settings", { method: "PATCH", body: { patch: { timezone: "Mars/Base" }, expectedUpdatedAt: r.body.settings.updatedAt } })));
    expect(bad.body.error?.code).toBe("INVALID_INPUT");

    const b = new Browser();
    await b.send(c.customerApi.addLine(b.req("/api/cart/lines", { method: "POST", body: { itemId: "fries", size: "REGULAR" } })));
    const rev = await b.send(c.customerApi.review(b.req("/api/cart/review", { method: "POST" })));
    expect(rev.body.error?.code).toBe("ORDERS_PAUSED");
    const t = await b.send(c.customerApi.mockTool(b.req("/api/mock/tool", { method: "POST", body: { tool: "reviewOrder", args: {} } })));
    expect(t.body.result.stateBlock).toContain("new orders are paused");
  });
});

describe("config", () => {
  it("a bad admin setting disables admin login with a reason instead of failing the whole site", () => {
    const c = loadConfig({ ADMIN_USERNAME: "owner", ADMIN_PASSWORD_HASH: "16384:8:1:abc:def", SESSION_SECRET: "x".repeat(40) });
    expect(c.admin).toBeUndefined();
    expect(c.adminProblem).toMatch(/starting with "scrypt:"/);
    expect(c.adminProblem).not.toContain("16384:8:1:abc:def");
    expect(loadConfig({}).adminProblem).toMatch(/not set/);
  });

  it("prefers the BURGER_AWS_* settings, because Vercel sets AWS_REGION itself and reserves the AWS key names", () => {
    const vercel = loadConfig({ AWS_REGION: "us-east-1", BURGER_AWS_REGION: "ca-central-1", BURGER_AWS_ACCESS_KEY_ID: "AK", BURGER_AWS_SECRET_ACCESS_KEY: "SK" });
    expect(vercel.region).toBe("ca-central-1");
    expect(vercel.awsCredentials).toEqual({ accessKeyId: "AK", secretAccessKey: "SK" });
    expect(loadConfig({ AWS_REGION: "ca-central-1" }).awsCredentials).toBeUndefined();
    expect(loadConfig({}).dailyChatLimit).toBe(50);
  });
});

describe("Connect widget token", () => {
  it("signs an HS256 token with only a cartRef, which resolves to this browser's cart for one hour", async () => {
    const { createHmac } = await import("node:crypto");
    const { createCustomerApi } = await import("../../src/lib/http/customerApi");
    const c = await app();
    const now = new Date("2026-10-29T16:00:00Z");
    const api = createCustomerApi({ service: c.service, repo: c.repo, tools: c.tools, mockConsole: false, secureCookies: false, widget: { widgetId: "w-1", securityKey: "k".repeat(44) }, now: () => now });
    const b = new Browser();
    await b.send(api.addLine(b.req("/api/cart/lines", { method: "POST", body: { itemId: "coke", size: "LARGE" } })));
    const r = await b.send(api.widgetToken(b.req("/api/connect/widget-token", { method: "POST" })));
    const [h, p, sig] = (r.body.token as string).split(".");
    expect(JSON.parse(Buffer.from(h!, "base64url").toString())).toEqual({ alg: "HS256", typ: "JWT" });
    expect(sig).toBe(createHmac("sha256", "k".repeat(44)).update(`${h}.${p}`).digest("base64url"));
    const claims = JSON.parse(Buffer.from(p!, "base64url").toString());
    expect(claims).toMatchObject({ sub: "w-1", exp: claims.iat + 300 });
    expect(Object.keys(claims.attributes)).toEqual(["cartRef"]);
    expect(r.body.token).not.toContain(b.jar.get("cart_id"));
    const cartId = await c.repo.getCartRef(claims.attributes.cartRef, now);
    expect(cartId).toBe(b.jar.get("cart_id"));
    expect(await c.repo.getCartRef(claims.attributes.cartRef, new Date(now.getTime() + 3601_000))).toBeUndefined();

    expect((await b.send(api.widgetToken(b.req("/api/connect/widget-token", { method: "POST", origin: "https://evil.example" })))).status).toBe(403);
    expect((await b.send(c.customerApi.widgetToken(b.req("/api/connect/widget-token", { method: "POST" })))).status).toBe(404); // not configured
  });
});

describe("Call transcript on the website", () => {
  async function linked(minutesAgo = 1) {
    const { createCustomerApi } = await import("../../src/lib/http/customerApi");
    const c = await app();
    const now = new Date("2026-10-29T16:00:00Z");
    const asked: string[] = [];
    const transcripts = {
      async getTranscript(contactId: string) {
        asked.push(contactId);
        return [{ who: "customer" as const, text: "one beef burger", at: "2026-10-29T15:59:00.000Z" }];
      },
    };
    const api = createCustomerApi({ service: c.service, repo: c.repo, tools: c.tools, mockConsole: false, secureCookies: false, transcripts, now: () => now });
    const owner = new Browser();
    await owner.send(api.getCart(owner.req("/api/cart")));
    const cartId = owner.jar.get("cart_id")!;
    const createdAt = new Date(now.getTime() - minutesAgo * 60_000).toISOString();
    await c.repo.putCartSession({ contactId: "11111111-2222-4333-8444-555555555555", cartId, createdAt, channel: "VOICE" });
    return { api, owner, asked };
  }

  it("returns the linked call's transcript to the browser that owns the cart, and to no one else", async () => {
    const { api, owner, asked } = await linked();
    const r = await owner.send(api.getConversation(owner.req("/api/conversation")));
    expect(r.body).toEqual({ ok: true, conversation: { channel: "VOICE", lines: [{ who: "customer", text: "one beef burger", at: "2026-10-29T15:59:00.000Z" }] } });
    expect(asked).toEqual(["11111111-2222-4333-8444-555555555555"]);

    const stranger = new Browser();
    expect((await stranger.send(api.getConversation(stranger.req("/api/conversation")))).body).toEqual({ ok: true, conversation: null });
  });

  it("stops looking a while after the call started, and is empty when transcripts are off", async () => {
    const old = await linked(90);
    expect((await old.owner.send(old.api.getConversation(old.owner.req("/api/conversation")))).body.conversation).toBeNull();
    expect(old.asked).toEqual([]);

    const c = await app();
    const b = new Browser();
    expect((await b.send(c.customerApi.getConversation(b.req("/api/conversation")))).body).toEqual({ ok: true, conversation: null });
  });
});

describe("Daily chat limit", () => {
  it("hands out at most DAILY_CHAT_LIMIT widget tokens per restaurant day, then 429", async () => {
    const { createCustomerApi } = await import("../../src/lib/http/customerApi");
    const c = await app();
    let now = new Date("2026-10-29T16:00:00Z"); // 12:00 Toronto
    const api = createCustomerApi({ service: c.service, repo: c.repo, tools: c.tools, mockConsole: false, secureCookies: false, widget: { widgetId: "w-1", securityKey: "k".repeat(44) }, dailyChatLimit: 2, now: () => now });
    const b = new Browser();
    const start = () => b.send(api.widgetToken(b.req("/api/connect/widget-token", { method: "POST" })));
    expect((await start()).status).toBe(200);
    expect((await start()).status).toBe(200);
    const third = await start();
    expect(third.status).toBe(429);
    expect(third.body.error.code).toBe("DAILY_LIMIT");
    now = new Date("2026-10-30T16:00:00Z"); // next day in Toronto
    expect((await start()).status).toBe(200);
  });
});
