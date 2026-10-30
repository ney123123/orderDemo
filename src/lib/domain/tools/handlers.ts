import type { z } from "zod";
import type { Repository } from "../../repositories/repository";
import type { CartService, LineOptions } from "../cart/service";
import type { DomainError, Result } from "../errors";
import { renderStateBlock, type StateTemplates } from "../stateBlock/renderStateBlock";
import type { State } from "../stateMachine/deriveState";
import { AddToCartInput, describeIssues, ReviewOrderInput, SubmitOrderInput, UpdateCartInput } from "./schemas";

/** Who is calling. Resolved server-side from Connect's contact/session ids, never from model arguments (§7). */
export interface ToolContext {
  cartId: string;
}

/** What every tool returns to the AI agent. `stateBlock` repeats the next-step instruction (INSTRUCTION_CHANNEL=both). */
export interface ToolResult {
  ok: boolean;
  state: State;
  error?: DomainError;
  stateBlock: string;
}

export interface ToolDeps {
  service: CartService;
  repo: Repository;
  templates: StateTemplates;
  statusUrlBase: string;
  now?: () => Date;
}

export type ToolName = "addToCart" | "updateCart" | "reviewOrder" | "submitOrder";
export type ToolHandler = (ctx: ToolContext, rawInput: unknown) => Promise<ToolResult>;

/** The current state block for a cart, optionally with the error of the call that produced it. */
export async function renderCurrent(deps: ToolDeps, cartId: string, error?: DomainError): Promise<ToolResult> {
  const now = deps.now ?? (() => new Date());
  const [cart, menu, settings] = await Promise.all([deps.service.getCart(cartId), deps.repo.getMenu(), deps.repo.getSettings()]);
  const order = cart.orderId ? await deps.repo.getOrder(cart.orderId) : undefined;
  const block = renderStateBlock({
    cart,
    menu,
    settings,
    now: now(),
    templates: deps.templates,
    notice: error,
    order,
    statusUrlBase: deps.statusUrlBase,
  });
  return { ok: !error, state: block.state, ...(error ? { error } : {}), stateBlock: block.text };
}

export function createToolHandlers(deps: ToolDeps): Record<ToolName, ToolHandler> {

  /** Validate → act → re-read and render. A failed action still returns the current state block. */
  const tool =
    <S extends z.ZodType>(schema: S, act: (cartId: string, args: z.infer<S>) => Promise<Result<unknown>>): ToolHandler =>
    async (ctx, rawInput) => {
      const parsed = schema.safeParse(rawInput ?? {});
      let error: DomainError | undefined;
      if (!parsed.success) {
        error = { code: "INVALID_INPUT", message: `The tool arguments were not valid (${describeIssues(parsed.error)}).` };
      } else {
        const result = await act(ctx.cartId, parsed.data);
        if (!result.ok) error = result.error;
      }
      return renderCurrent(deps, ctx.cartId, error);
    };

  return {
    addToCart: tool(AddToCartInput, (cartId, { itemId, quantity, ...options }) =>
      deps.service.addLine(cartId, { itemId, quantity: quantity ?? 1, ...definedOnly(options) }),
    ),
    updateCart: tool(UpdateCartInput, (cartId, { lineId, quantity, remove, splitQuantity, ...options }) => {
      const patch = definedOnly(options);
      return deps.service.updateLine(cartId, lineId, {
        patch: Object.keys(patch).length ? patch : undefined,
        quantity,
        remove,
        splitQuantity,
      });
    }),
    reviewOrder: tool(ReviewOrderInput, (cartId) => deps.service.review(cartId)),
    submitOrder: tool(SubmitOrderInput, (cartId, args) =>
      deps.service.submit(cartId, { reviewToken: args.reviewToken, customerName: args.customerName ?? "", pickupNote: args.pickupNote }),
    ),
  };
}

/** Drops keys whose value is undefined so a patch never clears a field by accident. */
function definedOnly(options: Partial<Record<keyof LineOptions, unknown>>): Partial<LineOptions> {
  return Object.fromEntries(Object.entries(options).filter(([, v]) => v !== undefined)) as Partial<LineOptions>;
}
