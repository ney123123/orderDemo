import { randomBytes } from "node:crypto";
import { z } from "zod";
import { FormatSchema, MAX_QUANTITY } from "../domain/cart/schema";
import type { CartService } from "../domain/cart/service";
import { SizeSchema } from "../domain/menu/schema";
import { startOfLocalDay } from "../domain/settings/hours";
import type { ToolHandler, ToolName } from "../domain/tools/handlers";
import { signWidgetToken } from "../connect/widgetToken";
import type { TranscriptSource } from "../connect/transcript/qconnectTranscript";
import type { Repository } from "../repositories/repository";
import { errorResponse, forbidden, json, parseCookies, readJson, sameOrigin, serializeCookie } from "./http";
import { cartView, orderView, publicMenu } from "./views";

export const CART_COOKIE = "cart_id";
export const PAST_CARTS_COOKIE = "past_carts";
const CART_ID = /^[A-Za-z0-9_-]{22}$/;
const MAX_PAST_CARTS = 5;
const COOKIE_MAX_AGE = 30 * 24 * 60 * 60;

const quantity = z.number().int().min(1).max(MAX_QUANTITY);
const id = z.string().trim().min(1).max(40);
const LineOptionsBody = z
  .object({
    format: FormatSchema,
    spicy: z.boolean(),
    sideId: id,
    sideSize: SizeSchema,
    drinkId: id,
    drinkSize: SizeSchema,
    size: SizeSchema,
  })
  .partial()
  .strict();

// The web UI sends typed JSON; the AI tools send strings (tools/schemas.ts). Both end in the same CartService.
export const AddLineBody = LineOptionsBody.extend({ itemId: id, quantity: quantity.default(1) }).strict();
export const UpdateLineBody = z.object({ patch: LineOptionsBody.optional(), quantity: quantity.optional(), splitQuantity: quantity.optional() }).strict();
export const SubmitBody = z
  .object({ reviewToken: z.string().min(1).max(64), customerName: z.string().max(40), pickupNote: z.string().max(200).optional() })
  .strict();
const MockToolBody = z
  .object({ tool: z.enum(["addToCart", "updateCart", "reviewOrder", "submitOrder"]), args: z.record(z.string(), z.string().max(300)) })
  .strict();

export interface CustomerApiDeps {
  service: CartService;
  repo: Repository;
  tools: Record<ToolName, ToolHandler>;
  /** Mock mode (§4): local tool console. Never on in production. */
  mockConsole: boolean;
  secureCookies: boolean;
  allowedOrigins?: string[];
  widget?: { widgetId: string; securityKey: string };
  /** Most chat/call starts (widget tokens) per restaurant day; a public demo URL can't run up the Connect bill. */
  dailyChatLimit?: number;
  /** Connect mode: reads a call's transcript for the page (off when undefined). */
  transcripts?: TranscriptSource;
  now?: () => Date;
}

const CART_REF_SECONDS = 60 * 60;
/** The page stops asking for a transcript this long after the call or chat started. */
const TRANSCRIPT_WINDOW_MS = 60 * 60 * 1000;

/**
 * Customer endpoints. The cart is identified only by an unguessable id in an httpOnly cookie;
 * there is no endpoint that takes a cart id, so one browser can never reach another's cart.
 */
export function createCustomerApi(deps: CustomerApiDeps) {
  const cookie = (name: string, value: string, maxAge = COOKIE_MAX_AGE) =>
    serializeCookie(name, value, { secure: deps.secureCookies, sameSite: "Lax", maxAge });

  /** Reads the cart cookie, or mints a new id (and the cookie to set) when there is none. */
  function session(req: Request) {
    const cookies = parseCookies(req);
    const existing = cookies[CART_COOKIE];
    const cartId = existing && CART_ID.test(existing) ? existing : newCartId();
    const past = (cookies[PAST_CARTS_COOKIE] ?? "").split(",").filter((c) => CART_ID.test(c)).slice(0, MAX_PAST_CARTS);
    return { cartId, past, setCookies: cartId === existing ? [] : [cookie(CART_COOKIE, cartId)] };
  }

  async function respondCart(cartId: string, setCookies: string[], status = 200) {
    const [cart, menu] = await Promise.all([deps.service.getCart(cartId), deps.repo.getMenu()]);
    return json(status, { ok: true, cart: cartView(cart, menu) }, setCookies);
  }

  /** Wraps a state-changing handler: CSRF check, then the session. */
  const mutation =
    <A extends unknown[]>(fn: (req: Request, s: ReturnType<typeof session>, ...args: A) => Promise<Response>) =>
    async (req: Request, ...args: A) =>
      sameOrigin(req, deps.allowedOrigins) ? fn(req, session(req), ...args) : forbidden();

  return {
    async getMenu(): Promise<Response> {
      return json(200, { ok: true, menu: publicMenu(await deps.repo.getMenu()) });
    },

    async getCart(req: Request): Promise<Response> {
      const s = session(req);
      return respondCart(s.cartId, s.setCookies);
    },

    addLine: mutation(async (req, s) => {
      const body = await readJson(req, AddLineBody);
      if (!body.ok) return body.response;
      const r = await deps.service.addLine(s.cartId, body.value);
      return r.ok ? respondCart(s.cartId, s.setCookies, 201) : errorResponse(r.error, s.setCookies);
    }),

    updateLine: mutation(async (req, s, lineId: string) => {
      const body = await readJson(req, UpdateLineBody);
      if (!body.ok) return body.response;
      const r = await deps.service.updateLine(s.cartId, lineId, body.value);
      return r.ok ? respondCart(s.cartId, s.setCookies) : errorResponse(r.error, s.setCookies);
    }),

    removeLine: mutation(async (_req, s, lineId: string) => {
      const r = await deps.service.updateLine(s.cartId, lineId, { remove: true });
      return r.ok ? respondCart(s.cartId, s.setCookies) : errorResponse(r.error, s.setCookies);
    }),

    review: mutation(async (_req, s) => {
      const r = await deps.service.review(s.cartId);
      return r.ok ? respondCart(s.cartId, s.setCookies) : errorResponse(r.error, s.setCookies);
    }),

    submit: mutation(async (req, s) => {
      const body = await readJson(req, SubmitBody);
      if (!body.ok) return body.response;
      const r = await deps.service.submit(s.cartId, body.value);
      if (!r.ok) return errorResponse(r.error, s.setCookies);
      return json(201, { ok: true, order: orderView(r.value.order) }, s.setCookies);
    }),

    /** Starts a fresh cart. The old cart id is kept (httpOnly) so its order stays viewable. */
    newCart: mutation(async (_req, s) => {
      const cartId = newCartId();
      const past = [s.cartId, ...s.past.filter((c) => c !== s.cartId)].slice(0, MAX_PAST_CARTS);
      return respondCart(cartId, [cookie(CART_COOKIE, cartId), cookie(PAST_CARTS_COOKIE, past.join(","))]);
    }),

    /** §4: only the cart session that placed the order may read it. Unknown and foreign ids look the same. */
    async getOrder(req: Request, orderId: string): Promise<Response> {
      const s = session(req);
      const order = /^[A-Z0-9-]{1,20}$/.test(orderId) ? await deps.repo.getOrder(orderId) : undefined;
      if (!order || ![s.cartId, ...s.past].includes(order.cartId)) {
        return json(404, { ok: false, error: { code: "NOT_FOUND", message: "Order not found." } }, s.setCookies);
      }
      return json(200, { ok: true, order: orderView(order) }, s.setCookies);
    },

    /**
     * The transcript of the latest call or chat started from this browser's cart (null when there is none).
     * Same rule as the cart: found only through the cookie, so a browser sees only its own conversation.
     * The text is never logged.
     */
    async getConversation(req: Request): Promise<Response> {
      const s = session(req);
      const now = (deps.now ?? (() => new Date()))();
      const linked = deps.transcripts ? await deps.repo.getCartSession(s.cartId) : undefined;
      if (!deps.transcripts || !linked || now.getTime() - Date.parse(linked.createdAt) > TRANSCRIPT_WINDOW_MS) {
        return json(200, { ok: true, conversation: null }, s.setCookies);
      }
      try {
        const lines = await deps.transcripts.getTranscript(linked.contactId);
        return json(200, { ok: true, conversation: { channel: linked.channel ?? "CHAT", lines } }, s.setCookies);
      } catch (e) {
        // A missed poll only delays the panel; the next one retries. Never log the transcript itself.
        console.warn(JSON.stringify({ level: "warn", msg: "transcript read failed", error: e instanceof Error ? e.name : "unknown" }));
        return json(200, { ok: true, conversation: null }, s.setCookies);
      }
    },

    /**
     * Signed token for the Connect chat widget. It carries a fresh one-hour cartRef (never the cart id),
     * which the adapter's init call resolves to this browser's cart. One ref per chat start.
     */
    widgetToken: mutation(async (_req, s) => {
      if (!deps.widget) return json(404, { ok: false, error: { code: "NOT_FOUND", message: "Chat is not configured." } });
      const now = (deps.now ?? (() => new Date()))();
      if (deps.dailyChatLimit !== undefined) {
        const { timezone } = await deps.repo.getSettings();
        const day = startOfLocalDay(now, timezone).slice(0, 10);
        const n = await deps.repo.incrementCounter(`widget-tokens#${day}`, new Date(now.getTime() + 2 * 86_400_000));
        if (n > deps.dailyChatLimit) {
          return json(429, { ok: false, error: { code: "DAILY_LIMIT", message: "Our chat is busy today. Please order from the menu, or try again tomorrow." } }, s.setCookies);
        }
      }
      const cartRef = randomBytes(24).toString("base64url");
      await deps.repo.putCartRef(cartRef, s.cartId, new Date(now.getTime() + CART_REF_SECONDS * 1000));
      const token = signWidgetToken({ widgetId: deps.widget.widgetId, securityKey: deps.widget.securityKey, attributes: { cartRef }, now });
      return json(200, { ok: true, token }, s.setCookies);
    }),

    /** Mock mode only: calls the AI tool handlers directly with string args, as the Connect adapter will. */
    mockTool: mutation(async (req, s) => {
      if (!deps.mockConsole) return json(404, { ok: false, error: { code: "NOT_FOUND", message: "Not found." } });
      const body = await readJson(req, MockToolBody);
      if (!body.ok) return body.response;
      const result = await deps.tools[body.value.tool]({ cartId: s.cartId }, body.value.args);
      return json(200, { ok: true, result }, s.setCookies);
    }),
  };
}
export type CustomerApi = ReturnType<typeof createCustomerApi>;

const newCartId = () => randomBytes(16).toString("base64url");
