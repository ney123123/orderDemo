import { CartService } from "../src/lib/domain/cart/service";
import type { Menu } from "../src/lib/domain/menu/schema";
import type { RestaurantSettings } from "../src/lib/domain/settings/schema";
import { createToolHandlers } from "../src/lib/domain/tools/handlers";
import { loadStateTemplates } from "../src/lib/prompts/loadStateTemplates";
import { MemoryRepository } from "../src/lib/repositories/memory/memoryRepository";

/** Thursday 2026-10-29 12:00 in Toronto (EDT): inside opening hours. */
export const OPEN_NOW = new Date("2026-10-29T16:00:00Z");
/** Wednesday 2026-10-28 23:00 in Toronto: after closing. */
export const CLOSED_NOW = new Date("2026-10-29T03:00:00Z");

export function setup(init: { menu?: Menu; settings?: RestaurantSettings; now?: Date } = {}) {
  const repo = new MemoryRepository(init);
  let clock = init.now ?? OPEN_NOW;
  let orderNo = 0;
  const now = () => clock;
  const service = new CartService({ repo, now, newOrderId: () => `PL-TEST${++orderNo}` });
  const tools = createToolHandlers({ service, repo, templates: loadStateTemplates(), statusUrlBase: "https://example.test/", now });
  const ctx = { cartId: "cart-1" };
  return {
    repo,
    service,
    tools,
    ctx,
    setNow: (d: Date) => (clock = d),
    /** Calls a tool the way the Connect bridge will: string-only arguments. */
    call: (name: keyof typeof tools, args: Record<string, string> = {}) => tools[name](ctx, args),
  };
}
