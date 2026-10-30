import { randomBytes } from "node:crypto";
import type { ToolHandler, ToolName, ToolResult } from "../../domain/tools/handlers";
import type { ConversationSession, Repository } from "../../repositories/repository";

/**
 * Connect Tool Adapter (§10): the only code that knows Connect's Lambda event shape.
 * Two entry points share one Lambda:
 *   - action=init: called by the main contact flow when a chat starts. Links the contact to a cart
 *     (from the widget's signed `cartRef` attribute, else a fresh cart) and writes the first state block.
 *   - tool=<name>: called by an MCP tool (an AgentCore Gateway Lambda target, see gatewayEvent, or a
 *     flow module). Runs the domain tool handler for the contact's cart.
 * Identity (contactId/sessionId/assistantId) comes from Connect: the flow's ContactData or the tool's
 * input overrides ({{$.contactId}} …), never from model-filled fields (§7).
 */

export interface ConnectEvent {
  Name?: string;
  Details?: {
    ContactData?: { ContactId?: string; InitialContactId?: string };
    Parameters?: Record<string, unknown>;
  };
}

/** Connect requires a flat string → string map from a flow Lambda (STRING_MAP validation). */
export type AdapterResponse = Record<string, string>;

export interface SessionTarget {
  contactId: string;
  assistantId?: string;
  sessionId?: string;
}

/** Writes `orderState` into the contact's AI agent session (Q Connect UpdateSessionData). */
export interface SessionDataWriter {
  writeOrderState(target: SessionTarget, orderState: string): Promise<void>;
}

export interface AdapterDeps {
  repo: Repository;
  tools: Record<ToolName, ToolHandler>;
  /** Renders the current block for a cart without changing it (used by init). */
  currentState: (cartId: string) => Promise<Pick<ToolResult, "state" | "stateBlock">>;
  sessionData: SessionDataWriter;
  now?: () => Date;
  log?: (entry: Record<string, unknown>) => void;
}

const TOOLS = new Set<ToolName>(["addToCart", "updateCart", "reviewOrder", "submitOrder"]);
/** Fields Connect fills in; they are stripped before the model-filled args reach the domain. */
const CONNECT_FIELDS = new Set(["tool", "action", "contactId", "sessionId", "assistantId", "cartRef", "channel"]);
const CHANNELS = new Set(["CHAT", "VOICE"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CART_REF = /^[A-Za-z0-9_-]{22,64}$/;

export function createConnectAdapter(deps: AdapterDeps) {
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? ((e) => console.log(JSON.stringify(e)));

  /**
   * The contact's session; created on first use. A cartRef and the channel only count the first time a
   * contact is seen, and both come from the flow (init), never from tool args.
   */
  async function sessionFor(contactId: string, cartRef?: string, channel?: string): Promise<{ session: ConversationSession; linked: boolean }> {
    const existing = await deps.repo.getSession(contactId);
    if (existing) return { session: existing, linked: false };
    const fromRef = cartRef && CART_REF.test(cartRef) ? await deps.repo.getCartRef(cartRef, now()) : undefined;
    const session: ConversationSession = { contactId, cartId: fromRef ?? randomBytes(16).toString("base64url"), createdAt: now().toISOString() };
    if (channel && CHANNELS.has(channel)) session.channel = channel as ConversationSession["channel"];
    await deps.repo.putSession(session);
    if (fromRef !== undefined) await deps.repo.putCartSession(session);
    return { session, linked: fromRef !== undefined };
  }

  /** First line of every block on a known channel, so the prompt's voice rules can apply. */
  const tagged = (session: ConversationSession, stateBlock: string) => (session.channel && stateBlock ? `CHANNEL: ${session.channel}\n${stateBlock}` : stateBlock);

  async function writeState(target: SessionTarget, stateBlock: string, ctx: Record<string, unknown>) {
    try {
      await deps.sessionData.writeOrderState(target, stateBlock);
    } catch (e) {
      // The block is also in the tool result (INSTRUCTION_CHANNEL=both), so the turn still works.
      log({ level: "warn", msg: "UpdateSessionData failed", ...ctx, error: e instanceof Error ? e.name : "unknown" });
    }
  }

  return async function handle(event: ConnectEvent): Promise<AdapterResponse> {
    const started = Date.now();
    const params = event.Details?.Parameters ?? {};
    const str = (k: string) => (typeof params[k] === "string" ? (params[k] as string).trim() : undefined);
    const contactId = str("contactId") || event.Details?.ContactData?.ContactId;
    const target: SessionTarget = { contactId: contactId ?? "", assistantId: str("assistantId") || undefined, sessionId: str("sessionId") || undefined };

    if (!contactId || !UUID.test(contactId)) {
      log({ level: "error", msg: "no contact identity", hasContactData: Boolean(event.Details?.ContactData?.ContactId) });
      return failure("GENERAL", "INVALID_INPUT", "Missing contact identity.");
    }

    if (str("action") === "init") {
      const { session, linked } = await sessionFor(contactId, str("cartRef"), str("channel"));
      const block = await deps.currentState(session.cartId);
      const stateBlock = tagged(session, block.stateBlock);
      await writeState(target, stateBlock, { contactId, action: "init" });
      log({ level: "info", msg: "session init", contactId, linkedWebCart: linked, channel: session.channel ?? null, state: block.state, ms: Date.now() - started });
      return { ok: "true", state: block.state, errorCode: "", errorMessage: "", stateBlock };
    }

    const tool = str("tool") as ToolName | undefined;
    if (!tool || !TOOLS.has(tool)) {
      log({ level: "error", msg: "unknown tool", contactId, tool: tool ?? null });
      return failure("GENERAL", "INVALID_INPUT", "Unknown tool.");
    }

    const args: Record<string, string> = {};
    for (const [k, v] of Object.entries(params)) {
      if (!CONNECT_FIELDS.has(k) && typeof v === "string") args[k] = v;
    }

    const { session } = await sessionFor(contactId);
    const result = await deps.tools[tool]({ cartId: session.cartId }, args);
    const stateBlock = tagged(session, result.stateBlock);
    await writeState(target, stateBlock, { contactId, tool });
    // Correlation id = contactId. Never log args (they can hold the customer's name) or the block.
    log({ level: result.ok ? "info" : "warn", msg: "tool", contactId, tool, ok: result.ok, state: result.state, errorCode: result.error?.code ?? null, ms: Date.now() - started });
    return {
      ok: String(result.ok),
      state: result.state,
      errorCode: result.error?.code ?? "",
      errorMessage: result.error?.message ?? "",
      stateBlock,
    };
  };
}

/** Model-facing tools that run another domain tool (Connect's 10-input limit split updateCart). */
const TOOL_ALIASES: Record<string, ToolName> = { chooseComboItems: "updateCart" };

/**
 * AgentCore Gateway Lambda target: the event is the tool's arguments (including the contactId override)
 * and the tool name, `<target>___<tool>`, arrives in the client context. Maps it onto the flow-module
 * event so both transports share one code path. Only tool calls come this way; `action`, `cartRef`
 * and `channel` are dropped so a model-filled argument can never reach the init path.
 */
export function gatewayEvent(args: Record<string, unknown>, gatewayToolName: string): ConnectEvent {
  const name = gatewayToolName.slice(gatewayToolName.indexOf("___") + 3);
  const { action: _action, cartRef: _cartRef, channel: _channel, ...rest } = args;
  return { Details: { Parameters: { ...rest, tool: TOOL_ALIASES[name] ?? name } } };
}

function failure(state: string, code: string, message: string): AdapterResponse {
  return { ok: "false", state, errorCode: code, errorMessage: message, stateBlock: "" };
}
