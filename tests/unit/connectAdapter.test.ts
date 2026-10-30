import { describe, expect, it } from "vitest";
import { createConnectAdapter, gatewayEvent, type ConnectEvent, type SessionTarget } from "../../src/lib/connect/adapter/handler";
import { CartService } from "../../src/lib/domain/cart/service";
import { createToolHandlers, renderCurrent } from "../../src/lib/domain/tools/handlers";
import { loadStateTemplates } from "../../src/lib/prompts/loadStateTemplates";
import { MemoryRepository } from "../../src/lib/repositories/memory/memoryRepository";
import { OPEN_NOW } from "../helpers";

const CONTACT = "11111111-2222-4333-8444-555555555555";
const OTHER = "99999999-2222-4333-8444-555555555555";
const ids = { contactId: CONTACT, sessionId: "sess-1", assistantId: "asst-1" };

function setup() {
  const repo = new MemoryRepository();
  const now = () => OPEN_NOW;
  const service = new CartService({ repo, now });
  const toolDeps = { service, repo, templates: loadStateTemplates(), statusUrlBase: "https://shop.test", now };
  const writes: { target: SessionTarget; block: string }[] = [];
  const logs: Record<string, unknown>[] = [];
  let failWrites = false;
  const handle = createConnectAdapter({
    repo,
    tools: createToolHandlers(toolDeps),
    currentState: (cartId) => renderCurrent(toolDeps, cartId),
    sessionData: {
      async writeOrderState(target, block) {
        if (failWrites) throw new Error("throttled");
        writes.push({ target, block });
      },
    },
    now,
    log: (e) => logs.push(e),
  });
  const tool = (tool: string, args: Record<string, string> = {}, identity: typeof ids = ids) =>
    handle({ Name: "ContactFlowEvent", Details: { ContactData: { ContactId: identity.contactId }, Parameters: { tool, ...identity, ...args } } });
  return { repo, service, handle, tool, writes, logs, failWrites: () => (failWrites = true) };
}

describe("Connect tool adapter", () => {
  it("returns a flat string map and writes the same state block to the AI session", async () => {
    const t = setup();
    const r = await t.tool("addToCart", { itemId: "beef" });
    for (const v of Object.values(r)) expect(typeof v).toBe("string");
    expect(r).toMatchObject({ ok: "true", state: "ITEM_CONFIG", errorCode: "" });
    expect(t.writes).toEqual([{ target: ids, block: r.stateBlock }]);
  });

  it("links the chat to the website cart through a valid cartRef, only on first contact", async () => {
    const t = setup();
    await t.service.addLine("web-cart", { itemId: "coke", quantity: 1, size: "LARGE" });
    await t.repo.putCartRef("r".repeat(22), "web-cart", new Date(OPEN_NOW.getTime() + 3600_000));

    const init = await t.handle({ Details: { ContactData: { ContactId: CONTACT }, Parameters: { action: "init", cartRef: "r".repeat(22) } } });
    expect(init).toMatchObject({ ok: "true", state: "GENERAL" });
    expect(init.stateBlock).toContain("Coke");
    expect(t.writes[0]!.target).toEqual({ contactId: CONTACT, assistantId: undefined, sessionId: undefined });
    expect(t.logs.at(-1)).toMatchObject({ msg: "session init", linkedWebCart: true });
    // The website can now find this contact's transcript from its own cart.
    expect(await t.repo.getCartSession("web-cart")).toMatchObject({ contactId: CONTACT, cartId: "web-cart" });

    await t.tool("addToCart", { itemId: "fries", size: "REGULAR" });
    expect((await t.service.getCart("web-cart")).lines).toHaveLength(2);
  });

  it("gives a chat without a valid cartRef its own fresh cart", async () => {
    const t = setup();
    await t.service.addLine("web-cart", { itemId: "coke", quantity: 1, size: "LARGE" });
    await t.handle({ Details: { ContactData: { ContactId: CONTACT }, Parameters: { action: "init", cartRef: "not valid!" } } });
    expect(t.logs.at(-1)).toMatchObject({ linkedWebCart: false });
    const r = await t.tool("reviewOrder");
    expect(r.errorCode).toBe("CART_EMPTY");
    expect((await t.service.getCart("web-cart")).lines).toHaveLength(1);
    expect(await t.repo.getCartSession("web-cart")).toBeUndefined();
  });

  it("ignores identity or cart fields smuggled into model args (§13 #13)", async () => {
    const t = setup();
    await t.tool("addToCart", { itemId: "coke", size: "LARGE" }, { ...ids, contactId: OTHER });
    const victim = (await t.repo.getSession(OTHER))!.cartId;
    // The model tries to address the other contact's cart through extra args: they are not tool inputs.
    const r = await t.tool("updateCart", { lineId: "L1", remove: "yes", cartId: victim, cartRef: "x".repeat(22) });
    expect(r.errorCode).toBe("UNKNOWN_LINE");
    expect((await t.service.getCart(victim)).lines).toHaveLength(1);
  });

  it("refuses events without a contact identity or with an unknown tool", async () => {
    const t = setup();
    expect(await t.handle({ Details: { Parameters: { tool: "addToCart", itemId: "beef" } } })).toMatchObject({ ok: "false", errorCode: "INVALID_INPUT" });
    expect(await t.tool("setPrice", { itemId: "beef" })).toMatchObject({ ok: "false", errorCode: "INVALID_INPUT" });
    expect(t.writes).toHaveLength(0);
  });

  it("still answers with the state block when UpdateSessionData fails", async () => {
    const t = setup();
    t.failWrites();
    const r = await t.tool("addToCart", { itemId: "beef" });
    expect(r.ok).toBe("true");
    expect(r.stateBlock).toContain("STEP: ITEM_CONFIG");
    expect(t.logs.some((l) => l.msg === "UpdateSessionData failed")).toBe(true);
  });

  it("never logs tool args such as the customer's name", async () => {
    const t = setup();
    await t.tool("addToCart", { itemId: "fries", size: "REGULAR" });
    const block = (await t.tool("reviewOrder")).stateBlock ?? "";
    const token = /reviewToken "([^"]+)"/.exec(block)![1]!;
    const r = await t.tool("submitOrder", { reviewToken: token, customerName: "Zebediah Unique" });
    expect(r).toMatchObject({ ok: "true", state: "SUBMITTED" });
    expect(JSON.stringify(t.logs)).not.toContain("Zebediah");
    expect(JSON.stringify(t.logs)).not.toContain(token);
  });

  it("runs AgentCore Gateway tool calls (prefixed name, alias, no init path) through the same handler", async () => {
    const t = setup();
    const add = await t.handle(gatewayEvent({ contactId: CONTACT, itemId: "beef", format: "COMBO", spicy: "yes" }, "burger___addToCart"));
    expect(add).toMatchObject({ ok: "true", state: "COMBO_CONFIG" });
    const combo = await t.handle(gatewayEvent({ contactId: CONTACT, lineId: "L1", sideId: "fries", sideSize: "LARGE", drinkId: "coke_zero", drinkSize: "LARGE" }, "burger___chooseComboItems"));
    expect(combo).toMatchObject({ ok: "true", state: "GENERAL" });
    expect(t.logs.at(-1)).toMatchObject({ msg: "tool", tool: "updateCart", ok: true });

    const sneaky = await t.handle(gatewayEvent({ contactId: CONTACT, action: "init", cartRef: "r".repeat(22) }, "burger___reviewOrder"));
    expect(t.logs.at(-1)).toMatchObject({ msg: "tool", tool: "reviewOrder" });
    expect(sneaky.state).toBe("CONFIRM");
  });

  it("tags every state block with the channel the flow reported at init, so the AI can talk for voice", async () => {
    const t = setup();
    const init = await t.handle({ Details: { ContactData: { ContactId: CONTACT }, Parameters: { action: "init", cartRef: "", channel: "VOICE" } } });
    expect(init.stateBlock!.split("\n")[0]).toBe("CHANNEL: VOICE");
    const add = await t.handle(gatewayEvent({ contactId: CONTACT, itemId: "beef" }, "burger___addToCart"));
    expect(add.stateBlock!.split("\n")[0]).toBe("CHANNEL: VOICE");
    expect(t.writes.at(-1)!.block).toBe(add.stateBlock);
  });

  it("ignores a channel the model tries to set, and adds no tag when the flow sent none", async () => {
    const t = setup();
    await t.handle({ Details: { ContactData: { ContactId: CONTACT }, Parameters: { action: "init", channel: "CHAT" } } });
    const r = await t.handle(gatewayEvent({ contactId: CONTACT, itemId: "beef", channel: "VOICE" }, "burger___addToCart"));
    expect(r.stateBlock!.split("\n")[0]).toBe("CHANNEL: CHAT");

    const untagged = await t.tool("addToCart", { itemId: "beef" }, { ...ids, contactId: OTHER });
    expect(untagged.stateBlock).not.toContain("CHANNEL:");
    const odd = await t.handle({ Details: { ContactData: { ContactId: "aaaaaaaa-2222-4333-8444-555555555555" }, Parameters: { action: "init", channel: "PIGEON" } } });
    expect(odd.stateBlock).not.toContain("CHANNEL:");
  });
});
